// ─────────────────────────────────────────────────────────────
// RUCHI — Supabase durable data (profiles, meals, streaks)
// ─────────────────────────────────────────────────────────────
// CRUD over the three user-owned tables. Every call goes through the
// publishable-key client, so RLS (auth.uid() policies) is the security
// boundary — this module adds no authorization of its own.
//
// Values written here (nutrition, cost, savings, streak day keys) are
// produced by the app's deterministic engine — never by an AI model.
// Streak numbers are computed BY THE DATABASE via the RPC; the client
// never sends a streak count anywhere.

"use client";

import { getSupabase } from "./supabase";
import { dayKeyOf } from "@/lib/datetime";
import type { MealHistoryEntry, UserPreferences } from "@/lib/types";

/** Everything the store mirrors for a signed-in user. */
export interface DurableSnapshot {
  name: string;
  prefs: UserPreferences;
  history: MealHistoryEntry[];
  lastCookedAt?: number;
}

export type DataResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unconfigured" | "error" };

function fail<T>(reason: "unconfigured" | "error" = "error"): DataResult<T> {
  return { ok: false, reason };
}

// ── Profile ──────────────────────────────────────────────────

export interface ProfileRow {
  displayName: string | null;
  prefs: UserPreferences | null; // null = server has no prefs yet (keep local)
  updatedAt: number;
}

export async function fetchProfile(): Promise<DataResult<ProfileRow | null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
    .maybeSingle();
  if (error) return fail("error");
  if (!data) return { ok: true, data: null };
  const row = data as Record<string, unknown>;
  const extras = (row.extras ?? {}) as {
    allergies?: string[];
    cuisines?: string[];
    equipment?: string[];
  };
  const prefs: UserPreferences | null = row.diet_preference
    ? {
        diet: row.diet_preference as UserPreferences["diet"],
        allergies: extras.allergies ?? [],
        fitnessGoal: (row.fitness_goal ?? "none") as UserPreferences["fitnessGoal"],
        skill: (row.cooking_skill ?? "beginner") as UserPreferences["skill"],
        defaultServings: (row.default_servings ?? 1) as UserPreferences["defaultServings"],
        budget: (row.budget_preference ?? 100) as UserPreferences["budget"],
        cuisines: extras.cuisines ?? ["Indian"],
        equipment: (extras.equipment ?? ["stove", "pan", "pot"]) as UserPreferences["equipment"],
      }
    : null;
  return {
    ok: true,
    data: {
      displayName: (row.display_name as string) ?? null,
      prefs,
      updatedAt: new Date(row.updated_at as string).getTime(),
    },
  };
}

export async function upsertProfile(patch: {
  displayName?: string | null;
  prefs?: UserPreferences;
}): Promise<DataResult<null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const row: Record<string, unknown> = { id: user.id, updated_at: new Date().toISOString() };
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.prefs) {
    row.diet_preference = patch.prefs.diet;
    row.cooking_skill = patch.prefs.skill;
    row.fitness_goal = patch.prefs.fitnessGoal;
    row.default_servings = patch.prefs.defaultServings;
    row.budget_preference = patch.prefs.budget;
    row.extras = {
      allergies: patch.prefs.allergies,
      cuisines: patch.prefs.cuisines,
      equipment: patch.prefs.equipment,
    };
  }
  const { error } = await supabase.from("profiles").upsert(row);
  return error ? fail("error") : { ok: true, data: null };
}

// ── Beta feedback (controlled beta, signed-in only) ─────────

export type FeedbackTopic =
  | "recipe"
  | "ingredients"
  | "instructions"
  | "bug"
  | "confusing"
  | "general";

/**
 * Append one feedback row. The database (RLS + check constraints) is the
 * authority: only the signed-in user's own id may be attached, topics are
 * whitelisted, and the message must be 3–1000 characters. No other
 * personal data is collected.
 */
export async function insertBetaFeedback(
  topic: FeedbackTopic,
  message: string,
): Promise<DataResult<null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const trimmed = message.trim();
  if (trimmed.length < 3 || trimmed.length > 1000) return fail("error");
  const { error } = await supabase.from("beta_feedback").insert([
    {
      user_id: user.id,
      topic,
      message: trimmed,
    },
  ]);
  return error ? fail("error") : { ok: true, data: null };
}

// ── Completed meals ──────────────────────────────────────────

/** Insert completed meals. Accepts the store's MealHistoryEntry directly. */
export async function insertCompletedMeals(
  entries: MealHistoryEntry[],
): Promise<DataResult<null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const rows = entries.map((e) => ({
    user_id: user.id,
    recipe_id: e.recipeId,
    recipe_name: e.recipeName,
    completed_at: new Date(e.cookedAt).toISOString(),
    local_date: dayKeyOf(e.cookedAt),
    servings: e.servings,
    protein_g: Math.round(e.proteinG),
    calories: Math.round(e.calories),
    cost_inr: Math.round(e.cost),
    savings_inr: Math.round(Math.max(0, e.deliveryCompareCost - e.cost)),
  }));
  const { error } = await supabase.from("completed_meals").insert(rows);
  return error ? fail("error") : { ok: true, data: null };
}

/**
 * Load the user's completed meals, newest first, capped like the local
 * store (200). Returns the store's MealHistoryEntry shape.
 */
export async function fetchCompletedMeals(): Promise<DataResult<MealHistoryEntry[]>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const { data, error } = await supabase
    .from("completed_meals")
    .select("*")
    .order("completed_at", { ascending: false })
    .limit(200);
  if (error) return fail("error");
  const entries: MealHistoryEntry[] = (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    recipeId: String(r.recipe_id),
    recipeName: String(r.recipe_name),
    cookedAt: new Date(r.completed_at as string).getTime(),
    servings: Number(r.servings ?? 1),
    proteinG: Number(r.protein_g ?? 0),
    calories: Number(r.calories ?? 0),
    cost: Number(r.cost_inr ?? 0),
    deliveryCompareCost: Number(r.cost_inr ?? 0) + Number(r.savings_inr ?? 0),
  }));
  return { ok: true, data: entries };
}

// ── Real Cooking Stats (server-authoritative) ───────────────

/** The cooking_stats view row — derived on read from real records. */
export interface CookingStatsRow {
  mealsCooked: number;
  totalSaved: number;
  lastCompletedAt: number | null;
  currentStreak: number;
  longestStreak: number;
}

/**
 * Record one genuinely completed cooking session. Idempotent per
 * session: the server deduplicates on session_id and returns the
 * outcome ('recorded' | 'duplicate'). Savings are derived server-side
 * from the engine's cost estimate + the catalog's delivery comparison —
 * the client never sends a saving, a streak, or another user's id.
 */
export async function recordCookingCompletion(input: {
  sessionToken: string;
  recipeId: string;
  recipeName: string;
  cookedAtMs: number;
  servings: number;
  proteinG: number;
  calories: number;
  costInr: number;
  deliveryCompareInr: number;
}): Promise<DataResult<"recorded" | "duplicate">> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const { data, error } = await supabase.rpc("record_cooking_completion", {
    p_session_token: input.sessionToken,
    p_recipe_id: input.recipeId,
    p_recipe_name: input.recipeName,
    p_completed_at: new Date(input.cookedAtMs).toISOString(),
    p_local_date: dayKeyOf(input.cookedAtMs),
    p_servings: Math.round(input.servings),
    p_protein_g: Math.round(input.proteinG),
    p_calories: Math.round(input.calories),
    p_cost_inr: Math.round(input.costInr),
    p_delivery_compare_inr: Math.round(input.deliveryCompareInr),
  });
  if (error) return fail("error");
  const outcome = typeof data === "string" ? data : "recorded";
  return { ok: true, data: outcome === "duplicate" ? "duplicate" : "recorded" };
}

/** Read the server-derived cooking stats (meals, saved, streaks). */
export async function fetchCookingStats(): Promise<DataResult<CookingStatsRow | null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const { data, error } = await supabase
    .from("cooking_stats")
    .select("*")
    .eq("user_id", user.id) // redundant under the view's RLS, but explicit
    .maybeSingle();
  if (error) return fail("error");
  if (!data) return { ok: true, data: null };
  const row = data as Record<string, unknown>;
  return {
    ok: true,
    data: {
      mealsCooked: Number(row.meals_cooked ?? 0),
      totalSaved: Number(row.total_saved ?? 0),
      lastCompletedAt: row.last_completed_at
        ? new Date(row.last_completed_at as string).getTime()
        : null,
      currentStreak: Number(row.current_streak ?? 0),
      longestStreak: Number(row.longest_streak ?? 0),
    },
  };
}

/**
 * Recent cooked meals from the authoritative completions log (newest
 * first). Used by the Profile stats card; falls back to nothing when
 * unconfigured — the UI already handles empty gracefully.
 */
export async function fetchRecentCookedMeals(
  limit = 8,
): Promise<DataResult<MealHistoryEntry[]>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const { data, error } = await supabase
    .from("cooking_completions")
    .select("*")
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) return fail("error");
  const entries: MealHistoryEntry[] = (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    recipeId: String(r.recipe_id),
    recipeName: String(r.recipe_name),
    cookedAt: new Date(r.completed_at as string).getTime(),
    servings: Number(r.servings ?? 1),
    proteinG: Number(r.protein_g ?? 0),
    calories: Number(r.calories ?? 0),
    cost: Number(r.cost_inr ?? 0),
    deliveryCompareCost:
      Number(r.cost_inr ?? 0) + Number(r.savings_inr ?? 0),
  }));
  return { ok: true, data: entries };
}

// ── Notification prefs (migration 0004 — opt-in only) ────────

export type NotificationChannel = "web_push" | "email" | "whatsapp" | "widget";

/** Client-facing shape of a notification_prefs row. */
export interface NotificationPrefsRow {
  channels: Partial<Record<NotificationChannel, boolean>>;
  quietHours: { start: number; end: number };
  maxPerWeek: number;
  updatedAt: number;
}

/** Server mirror of the attention suppression state (isSuppressed contract). */
export interface AttentionStateMirror {
  lastShown?: { type: string; recipeId?: string; at: number } | null;
  suppressionUntil?: number | null;
}

function mapNotificationPrefs(row: Record<string, unknown>): NotificationPrefsRow {
  const channels = (row.channels ?? {}) as Record<string, unknown>;
  const quiet = (row.quiet_hours ?? {}) as Record<string, unknown>;
  const allowed: NotificationChannel[] = ["web_push", "email", "whatsapp", "widget"];
  const channelFlags: Partial<Record<NotificationChannel, boolean>> = {};
  for (const ch of allowed) {
    if (channels[ch] === true) channelFlags[ch] = true;
  }
  return {
    channels: channelFlags,
    quietHours: {
      start: Number(quiet.start ?? 22),
      end: Number(quiet.end ?? 8),
    },
    maxPerWeek: Number(row.max_per_week ?? 2),
    updatedAt: new Date(row.updated_at as string).getTime(),
  };
}

/**
 * Read the user's notification prefs. Null = never opted in — the app must
 * treat that exactly like all-channels-off (defaults are off).
 */
export async function fetchNotificationPrefs(): Promise<DataResult<NotificationPrefsRow | null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const { data, error } = await supabase
    .from("notification_prefs")
    .select("*")
    .eq("user_id", user.id) // redundant under RLS, but explicit (parity)
    .maybeSingle();
  if (error) return fail("error");
  return { ok: true, data: data ? mapNotificationPrefs(data as Record<string, unknown>) : null };
}

/**
 * Upsert the user's notification prefs. Only the channel flags are
 * client-writable from the UI; quiet hours / caps get their own setter when
 * a settings surface exists. The row is created on first opt-in.
 */
export async function upsertNotificationChannels(
  channels: Partial<Record<NotificationChannel, boolean>>,
): Promise<DataResult<null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  // Only known channels, booleans only — the DB check re-validates.
  const clean: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(channels)) {
    if (
      (["web_push", "email", "whatsapp", "widget"] as string[]).includes(k) &&
      typeof v === "boolean"
    ) {
      clean[k] = v;
    }
  }
  const { error } = await supabase.from("notification_prefs").upsert({
    user_id: user.id,
    channels: clean,
    updated_at: new Date().toISOString(),
  });
  return error ? fail("error") : { ok: true, data: null };
}

/**
 * Push the client's attention suppression state to the server mirror.
 * Fire-and-forget friendly: a failure here never blocks the UI — the
 * client's own state remains authoritative for in-app suppression.
 */
export async function pushAttentionState(
  state: AttentionStateMirror,
): Promise<DataResult<null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const payload: Record<string, unknown> = { attention_state: state };
  // Only touch rows that exist — never create a prefs row as a side effect
  // of suppression bookkeeping (opt-in must stay explicit).
  const { error } = await supabase
    .from("notification_prefs")
    .update(payload)
    .eq("user_id", user.id);
  return error ? fail("error") : { ok: true, data: null };
}

// ── Streak (server-computed via RPC) ─────────────────────────

/**
 * Record a completed-meal day. The ONLY write path for streaks: the
 * database derives current/longest from the local calendar date, so a
 * tampered client cannot inflate a streak. Duplicate same-day calls are
 * no-ops server-side.
 */
export async function recordStreakDay(cookedAtMs: number): Promise<DataResult<null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const { error } = await supabase.rpc("record_completed_meal_day", {
    p_local_date: dayKeyOf(cookedAtMs),
  });
  return error ? fail("error") : { ok: true, data: null };
}

export interface StreakRow {
  current: number;
  longest: number;
  lastCompletedLocalDate: string | null;
}

/** Read the server-side streak (display cross-check / restore). */
export async function fetchStreak(): Promise<DataResult<StreakRow | null>> {
  const supabase = getSupabase();
  if (!supabase) return fail("unconfigured");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return fail("error");
  const { data, error } = await supabase
    .from("cooking_streaks")
    .select("current_streak, longest_streak, last_completed_local_date")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return fail("error");
  if (!data) return { ok: true, data: null };
  const row = data as Record<string, unknown>;
  return {
    ok: true,
    data: {
      current: Number(row.current_streak ?? 0),
      longest: Number(row.longest_streak ?? 0),
      lastCompletedLocalDate: (row.last_completed_local_date as string) ?? null,
    },
  };
}
