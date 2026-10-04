// ─────────────────────────────────────────────────────────────
// RUCHI — notification cron pipeline (per-user, 2.0)
// ─────────────────────────────────────────────────────────────
// The whole per-user flow of POST /api/notifications/run, extracted
// verbatim so the E2E simulation (supabase/tests/e2e-notifications.mjs)
// can drive THE REAL pipeline — not a re-implementation that could
// drift from production.
//
//   1. Load REAL server data: history (cooking_completions with
//      completed_meals legacy fallback), the real diet preference,
//      and the user's recent LEDGER rows.
//   2. generateOpportunities → deterministic candidates from real
//      signals only (paused session, completions, kitchen mirror,
//      last real action, real taxonomy).
//   3. pickWinner → exactly ONE candidate would ever speak.
//   4. evaluateOpportunity → the centralized WHEN gate. Silence is a
//      valid, recorded outcome.
//   5. pickCopy → tone-guarded, fact-filled copy (never fabricated).
//   6. recordNotification → claim the send slot by dedup key BEFORE
//      any I/O (unique violation ⇒ already sent ⇒ skip).
//   7. The ONE channel adapter delivers (injectable for tests).
//   8. Settle the ledger row + attention mirror.
//
// Everything reaching Supabase goes through the passed client: the
// route passes the real service-role client; the E2E sim passes a
// thin adapter over local Postgres with the SAME RLS/constraint
// semantics, so the idempotency contract is exercised for real.

import type { SupabaseClient } from "@supabase/supabase-js";
import { dayKeyOf } from "@/lib/datetime";
import { weekKeyOf } from "@/lib/notifications/planner";
import { webPushAdapter, isValidSubscription } from "@/lib/notifications/web-push";
import {
  generateOpportunities,
  type ServerSignals,
} from "@/lib/notifications/opportunities";
import {
  evaluateOpportunity,
  pickWinner,
  OPPORTUNITY_TTL_MS,
  type PolicyState,
} from "@/lib/notifications/policy";
import { pickCopy, copySeed } from "@/lib/notifications/copy";
import {
  recordNotification,
  recordSuppression,
  sendRow,
  updateNotificationStatus,
} from "@/lib/notifications/ledger";

/** The product's home timezone: cron times and daily caps are IST. */
const IST_OFFSET_MIN = 330;

export function istHourOf(now: number): number {
  return new Date(now + IST_OFFSET_MIN * 60_000).getUTCHours();
}

export function istDayStartIso(now: number): string {
  const d = new Date(now + IST_OFFSET_MIN * 60_000);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_OFFSET_MIN * 60_000,
  ).toISOString();
}

/** The cron's own clock decides the meal window — never a guessed habit. */
export function mealWindowLabelOf(now: number): ServerSignals["mealWindowLabel"] {
  const h = istHourOf(now);
  if (h >= 6 && h < 10) return "breakfast";
  if (h >= 12 && h < 15) return "lunch";
  if (h >= 18 && h < 22) return "dinner";
  return undefined;
}

// ── Row shapes (what the route's batch select returns) ────────

export interface OptedInRow {
  user_id: string;
  channels: { web_push?: boolean } | null;
  web_push_subscription: unknown | null;
  quiet_hours: { start: number; end: number } | null;
  max_per_week: number | null;
  type_prefs: Record<string, boolean> | null;
  paused_session: {
    recipeId: string;
    stepIndex: number;
    stepCount: number;
    pausedAt: number;
  } | null;
  kitchen_mirror: { ids?: string[]; updatedAt?: number } | null;
  last_action: { kind?: string; recipeId?: string; at?: number } | null;
  attention_state: {
    lastShown?: { type: string; recipeId?: string; at: number } | null;
    suppressionUntil?: number | null;
  } | null;
}

interface LedgerRecentRow {
  opportunity_type: string;
  dedup_key: string | null;
  status: string;
  created_at: string;
  opened_at: string | null;
}

interface CompletionRow {
  recipe_id: string;
  recipe_name: string;
  completed_at: string;
  servings: number | null;
  protein_g: number | null;
  calories: number | null;
  cost_inr: number | null;
  savings_inr: number | null;
}

export type UserOutcome =
  | "delivered"
  | "suppressed"
  | "skipped"
  | "pruned"
  | "failed";

type EngineHistoryEntry = ServerSignals["history"][number];

function toHistoryEntries(rows: CompletionRow[]): EngineHistoryEntry[] {
  return rows.map((r) => ({
    id: `srv-${r.recipe_id}-${r.completed_at}`,
    recipeId: String(r.recipe_id),
    recipeName: String(r.recipe_name),
    cookedAt: new Date(r.completed_at).getTime(),
    servings: Number(r.servings ?? 1),
    proteinG: Number(r.protein_g ?? 0),
    calories: Number(r.calories ?? 0),
    cost: Number(r.cost_inr ?? 0),
    deliveryCompareCost: Number(r.cost_inr ?? 0) + Number(r.savings_inr ?? 0),
  }));
}

export async function fetchHistory(
  supabase: SupabaseClient,
  userId: string,
): Promise<EngineHistoryEntry[]> {
  const select =
    "recipe_id, recipe_name, completed_at, servings, protein_g, calories, cost_inr, savings_inr";
  const { data: completions } = await supabase
    .from("cooking_completions")
    .select(select)
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .limit(20);

  if (completions && completions.length > 0) {
    return toHistoryEntries(completions as CompletionRow[]);
  }

  // Legacy fallback: pre-0003 history keeps counting.
  const { data: legacy } = await supabase
    .from("completed_meals")
    .select(select)
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .limit(20);
  return toHistoryEntries((legacy ?? []) as CompletionRow[]);
}

/**
 * The user's REAL diet preference (profiles.diet_preference, written by
 * the app's own prefs flow). Only this check-constrained vocabulary is
 * accepted; anything else falls back to the neutral eggetarian default
 * — a wrong-but-broad filter, never a fabricated preference.
 */
export async function fetchDiet(
  supabase: SupabaseClient,
  userId: string,
): Promise<ServerSignals["diet"]> {
  const { data } = await supabase
    .from("profiles")
    .select("diet_preference")
    .eq("id", userId)
    .maybeSingle();
  const diet = (data as { diet_preference?: string } | null)?.diet_preference;
  return diet === "vegetarian" || diet === "non-vegetarian" ? diet : "eggetarian";
}

/**
 * The client-recorded last action (scan confirm / recipe view /
 * completion), shape-checked. Unknown kinds or a missing timestamp
 * yield null — the follow-up stays silent rather than guessing.
 */
export function toLastAction(raw: OptedInRow["last_action"]): ServerSignals["lastAction"] {
  if (!raw || typeof raw.at !== "number") return null;
  if (raw.kind !== "scan" && raw.kind !== "view_recipe" && raw.kind !== "start_cooking") {
    return null;
  }
  return {
    kind: raw.kind,
    recipeId: raw.recipeId ? String(raw.recipeId) : undefined,
    at: raw.at,
  };
}

/**
 * Real ledger facts for the policy layer: per-type last-delivery times,
 * today's/this week's REAL delivery counts, last opened time, and the
 * dedup key of the most recent send (the duplicate check's anchor).
 */
export async function loadPolicyLedgerState(
  supabase: SupabaseClient,
  userId: string,
  now: number,
): Promise<LedgerPolicyFacts> {
  const since = new Date(now - 15 * 24 * 3_600_000).toISOString(); // PERSONALITY cooldown span + margin
  const { data: recent } = await supabase
    .from("notification_ledger")
    .select("opportunity_type, dedup_key, status, created_at, opened_at")
    .eq("user_id", userId)
    .eq("status", "sent")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (recent ?? []) as LedgerRecentRow[];
  const lastDeliveredAt: Record<string, number> = {};
  let lastOpenedAt: number | undefined;
  for (const r of rows) {
    const at = new Date(r.created_at).getTime();
    if (!lastDeliveredAt[r.opportunity_type] || at > lastDeliveredAt[r.opportunity_type]!) {
      lastDeliveredAt[r.opportunity_type] = at;
    }
    if (r.opened_at) {
      const opened = new Date(r.opened_at).getTime();
      if (lastOpenedAt === undefined || opened > lastOpenedAt) lastOpenedAt = opened;
    }
  }
  const weekStartIso = new Date(Number(weekKeyOf(now))).toISOString();
  return {
    lastDeliveredAt,
    lastNotificationOpenedAt: lastOpenedAt,
    lastSentDedupKey: rows[0]?.dedup_key ?? null,
    weekSends: rows.filter((r) => r.created_at >= weekStartIso).length,
    daySends: rows.filter((r) => r.created_at >= istDayStartIso(now)).length,
  };
}

export interface LedgerPolicyFacts {
  lastDeliveredAt: Record<string, number>;
  lastNotificationOpenedAt?: number;
  lastSentDedupKey: string | null;
  weekSends: number;
  daySends: number;
}

export async function processUser(
  supabase: SupabaseClient,
  row: OptedInRow,
  now: number,
  adapter: typeof webPushAdapter = webPushAdapter,
): Promise<UserOutcome> {
  const userId = row.user_id;
  const [history, diet] = await Promise.all([
    fetchHistory(supabase, userId),
    fetchDiet(supabase, userId),
  ]);

  // ── Real signals only. The kitchen mirror + last action are the
  //    client-recorded REAL moments (scan confirm / recipe view);
  //    the paused session is the real one the user recorded on exit.
  //    The mirror carries its own updatedAt staleness stamp.
  const kitchen =
    row.kitchen_mirror && Array.isArray(row.kitchen_mirror.ids) && row.kitchen_mirror.ids.length > 0
      ? { ids: row.kitchen_mirror.ids.map(String), updatedAt: Number(row.kitchen_mirror.updatedAt ?? 0) }
      : null;

  const signals: ServerSignals = {
    userId,
    now,
    history,
    pausedSession: row.paused_session ?? null,
    lastCookedDay: history[0] ? dayKeyOf(history[0].cookedAt) : undefined,
    weekKey: weekKeyOf(now),
    lastAction: toLastAction(row.last_action),
    kitchen,
    diet,
    mealWindowLabel: mealWindowLabelOf(now),
  };

  // ── WHICH opportunity (if any) deserves the user's attention.
  const winner = pickWinner(generateOpportunities(signals));
  if (!winner) return "skipped"; // no valid opportunity — silence

  // ── WHEN it may speak (centralized policy, real ledger data).
  const ledgerState = await loadPolicyLedgerState(supabase, userId, now);
  const policyState: PolicyState = {
    userId,
    hasSubscription: isValidSubscription(row.web_push_subscription),
    typePrefs: row.type_prefs ?? {},
    hasActiveSession: false, // server cannot see an in-flight session; never inferred
    lastCookedAt: history[0]?.cookedAt,
    quietHours: row.quiet_hours ?? { start: 22, end: 8 },
    localHour: istHourOf(now),
    dailyCap: 1,
    weeklyCap: row.max_per_week ?? 2,
    daySends: ledgerState.daySends,
    weekSends: ledgerState.weekSends,
    lastDeliveredAt: ledgerState.lastDeliveredAt,
    lastNotificationOpenedAt: ledgerState.lastNotificationOpenedAt,
    lastSentDedupKey: ledgerState.lastSentDedupKey,
  };

  const verdict = evaluateOpportunity(winner, policyState, now);
  if (!verdict.allowed) {
    // "Did not notify" is a successful outcome — recorded once per
    // (day, reason, type) so debugging never costs spam.
    await recordSuppression(supabase, {
      userId,
      opportunityType: winner.type,
      reason: verdict.reason ?? "no_valid_opportunity",
      dayKey: dayKeyOf(now),
    });
    return "suppressed";
  }

  // ── HOW it speaks (tone-guarded copy from proven facts).
  const { filledTitle, filledBody } = pickCopy(winner.type, winner.facts, copySeed(userId, winner));
  if (!filledTitle || !filledBody) return "skipped"; // never send an empty frame

  // ── Claim the send slot (idempotency BEFORE any I/O).
  const claim = await recordNotification(
    supabase,
    sendRow({
      user_id: userId,
      opportunity_type: winner.type,
      dedup_key: winner.dedupKey,
      title: filledTitle,
      body: filledBody,
      destination: winner.destination,
      recipe_id: winner.facts.recipeId ?? null,
    }),
    userId,
  );
  if (claim.existing) return "skipped"; // cron re-run: already sent today

  // ── Deliver through the one chosen channel.
  const deliverable = {
    userId,
    contextType: winner.type,
    recipeId: winner.facts.recipeId,
    headline: filledTitle,
    supportingText: filledBody,
    deepLink: winner.destination,
    expiresAt: now + OPPORTUNITY_TTL_MS[winner.type],
    subscription: row.web_push_subscription,
  } as Parameters<typeof webPushAdapter.deliver>[0];
  const result = await adapter.deliver(deliverable);

  if (!result.ok) {
    await updateNotificationStatus(supabase, claim.id, { status: "failed" }).catch(() => false);
    if (result.reason === "user-unavailable") {
      // Dead subscription → prune so future runs skip the dead row
      // and the channel flag reflects reality.
      await supabase
        .from("notification_prefs")
        .update({
          web_push_subscription: null,
          channels: { ...(row.channels ?? {}), web_push: false },
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      return "pruned";
    }
    return "failed";
  }

  // ── Settle the ledger + mirror attention state (one delivery = one
  //    lastShown; the client's in-app suppression stays in step).
  await updateNotificationStatus(supabase, claim.id, {
    status: "sent",
    deliveredAt: new Date().toISOString(),
  }).catch(() => false);
  await supabase
    .from("notification_prefs")
    .update({
      attention_state: {
        lastShown: {
          type: winner.ctx.type,
          recipeId: winner.facts.recipeId,
          at: now,
        },
        suppressionUntil: null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return "delivered";
}
