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
