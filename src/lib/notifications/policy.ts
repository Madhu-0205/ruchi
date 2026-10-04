// ─────────────────────────────────────────────────────────────
// RUCHI — notification policy (centralized, server-authoritative)
// ─────────────────────────────────────────────────────────────
// The "WHEN is a notification allowed?" layer. Everything here is
// deterministic and pure; no Math.random, no Date.now() — `now` is
// always supplied by the caller (the cron route).
//
// Spec §5/§6/§7: one place for per-type cooldown classes
// (HIGH_VALUE shorter, NORMAL medium, PERSONALITY long),
// quiet hours, daily/weekly caps, and the enumerated suppression
// reasons. Nothing else in the stack consults frequency.
//
// TUNING BEHAVIOR:
//  • Cooldown values live here — tune them and every consumption
//    site follows.
//  • This module must NOT depend on the db/push modules (pure).

import type { Opportunity } from "@/lib/notifications/opportunities";
import { OPPORTUNITY_ORDER } from "@/lib/notifications/opportunities";
import { isQuietHour } from "@/lib/notifications/planner";

// ── Suppression reasons (spec §15, exhaustive + unambiguous) ──
export type SuppressionReason =
  | "quiet_hours"
  | "recently_notified"
  | "recently_opened"
  | "active_session"
  | "recently_cooked"
  | "no_valid_opportunity"
  | "duplicate"
  | "user_disabled"
  | "daily_cap"
  | "weekly_cap"
  | "low_confidence"
  | "no_subscription";

// ── Cooldown classes (spec §6) ────────────────────────────────
export type CooldownClass = "HIGH_VALUE" | "NORMAL" | "PERSONALITY";

/** Milliseconds of silence per class: HIGH_VALUE shorter, NORMAL medium, PERSONALITY long. */
export const COOLDOWN_MS: Record<CooldownClass, number> = {
  HIGH_VALUE: 3 * 3_600_000,        // 3h — genuine service, not noise
  NORMAL: 12 * 3_600_000,           // 12h — measured
  PERSONALITY: 14 * 24 * 3_600_000, // 14 days — rare by design
};

/** Staleness window per type: a push must not outlive its own context. */
export const OPPORTUNITY_TTL_MS: Record<Opportunity["type"], number> = {
  resume_cooking: 2 * 3_600_000,
  explicit_followup: 6 * 3_600_000,
  ingredient_opportunity: 6 * 3_600_000,
  cook_again: 24 * 3_600_000,
  contextual_meal: 4 * 3_600_000,
  discover_opportunity: 24 * 3_600_000,
  personality: 48 * 3_600_000,
};

// ── Per-opportunity typing (opportunities.ts owns the mapping) ─
export interface OpportunityPolicy {
  cooldownClass: CooldownClass;
  /** Bypass quiet hours? Only when the user explicitly asked for a reminder (spec §7). */
  quietHoursBypass: boolean;
}

export const OPPORTUNITY_POLICY: Record<Opportunity["type"], OpportunityPolicy> = {
  resume_cooking: { cooldownClass: "HIGH_VALUE", quietHoursBypass: false },
  explicit_followup: { cooldownClass: "HIGH_VALUE", quietHoursBypass: false },
  ingredient_opportunity: { cooldownClass: "HIGH_VALUE", quietHoursBypass: false },
  cook_again: { cooldownClass: "NORMAL", quietHoursBypass: false },
  contextual_meal: { cooldownClass: "NORMAL", quietHoursBypass: false },
  discover_opportunity: { cooldownClass: "NORMAL", quietHoursBypass: false },
  personality: { cooldownClass: "PERSONALITY", quietHoursBypass: false },
};

/** Cooldown in ms for a concrete opportunity type. */
export function cooldownFor(type: Opportunity["type"]): number {
  return COOLDOWN_MS[OPPORTUNITY_POLICY[type].cooldownClass];
}

/** Highest-priority opportunity wins; ties break by deterministic type order. */
export function pickWinner(opportunities: Opportunity[]): Opportunity | null {
  if (opportunities.length === 0) return null;
  return (
    opportunities
      .slice()
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          OPPORTUNITY_ORDER.indexOf(a.type) - OPPORTUNITY_ORDER.indexOf(b.type),
      )
      .at(0) ?? null
  );
}

// ── Policy state (all server-authoritative, real data only) ───
export interface PolicyState {
  userId: string;
  // Subscription: real, not presumed.
  hasSubscription: boolean;
  // Per-type opt-outs (notification_prefs.type_prefs). Absent key = ON;
  // an explicit false is the user's recorded no.
  typePrefs: Record<string, boolean>;
  // Global signals.
  hasActiveSession: boolean;
  lastCookedAt?: number;
  lastAppOpenAt?: number;
  quietHours: { start: number; end: number };
  /** User-local hour of THIS evaluation (server supplies it; defaults to server clock). */
  localHour?: number;
  // Caps.
  dailyCap: number;
  weeklyCap: number;
  /** Messages actually DELIVERED today (ledger, real count). */
  daySends?: number;
  /** Messages actually DELIVERED this week (ledger, real count). */
  weekSends: number;
  // Per-type recency: last *delivered* timestamp per opportunity type.
  lastDeliveredAt: Record<string, number>;
  // Last time this user opened any notification (ledger.opened_at).
  lastNotificationOpenedAt?: number;
  /**
   * The dedup key of the user's LAST SENT notification (from the ledger).
   * NOT the current candidate's key — comparing those two is the duplicate
   * check: proposing the exact opportunity that already went out is a dup.
   */
  lastSentDedupKey?: string | null;
}

// ── Evaluation ─────────────────────────────────────────────────
export interface PolicyResult {
  allowed: boolean;
  reason: SuppressionReason | null;
}

// Defaults — overrides live in the DB (the UI writes them).
const DEFAULT_DAILY_CAP = 1;
const DEFAULT_WEEKLY_CAP = 2;
const DEFAULT_LOW_CONFIDENCE = 0.6;
const RECENTLY_COOKED_MS = 2 * 60 * 60 * 1000;
const RECENTLY_OPENED_MS = 15 * 60 * 1000;

function resolvedState(p: PolicyState): PolicyState {
  return {
    ...p,
    dailyCap: p.dailyCap ?? DEFAULT_DAILY_CAP,
    weeklyCap: p.weeklyCap ?? DEFAULT_WEEKLY_CAP,
    daySends: p.daySends ?? 0,
    weekSends: p.weekSends ?? 0,
    lastDeliveredAt: p.lastDeliveredAt ?? {},
  };
}

export function evaluateOpportunity(
  opportunity: Opportunity,
  state: PolicyState,
  now: number,
): PolicyResult {
  const s = resolvedState(state);

  // 1. user opt-out (per-type; the master channels gate runs upstream).
  if (s.typePrefs[opportunity.type] === false) {
    return { allowed: false, reason: "user_disabled" };
  }

  // 2. subscription (no valid delivery channel exists).
  if (!s.hasSubscription) return { allowed: false, reason: "no_subscription" };

  // 3. active cooking session: never interrupt productive work (spec §5).
  if (s.hasActiveSession) return { allowed: false, reason: "active_session" };

  // 4. recently cooked: don't nag right after a real completion.
  if (s.lastCookedAt !== undefined && now - s.lastCookedAt < RECENTLY_COOKED_MS) {
    return { allowed: false, reason: "recently_cooked" };
  }

  // 5. recently opened a notification: give them a moment to act.
  if (
    s.lastNotificationOpenedAt !== undefined &&
    now - s.lastNotificationOpenedAt < RECENTLY_OPENED_MS
  ) {
    return { allowed: false, reason: "recently_opened" };
  }

  // 6. duplicate: the exact opportunity that was already sent is not
  //    re-sent (lastSentDedupKey comes from the server ledger).
  if (s.lastSentDedupKey && s.lastSentDedupKey === opportunity.dedupKey) {
    return { allowed: false, reason: "duplicate" };
  }

  // 7. per-type cooldown (HIGH_VALUE / NORMAL / PERSONALITY).
  const classMs = COOLDOWN_MS[OPPORTUNITY_POLICY[opportunity.type].cooldownClass];
  const last = s.lastDeliveredAt[opportunity.type];
  if (last !== undefined && now - last < classMs) {
    return { allowed: false, reason: "recently_notified" };
  }

  // 8. quiet hours (user's local hour; nothing bypasses — spec §7:
  //    even resume waits unless the user explicitly asked for it, a
  //    surface that does not exist yet).
  const hour = s.localHour ?? new Date(now).getHours();
  if (isQuietHour(hour, s.quietHours)) {
    return { allowed: false, reason: "quiet_hours" };
  }

  // 9. daily cap (real deliveries today, from the ledger).
  if (s.dailyCap > 0 && (s.daySends ?? 0) >= s.dailyCap) {
    return { allowed: false, reason: "daily_cap" };
  }

  // 10. weekly cap (real deliveries this week, from the ledger).
  if (s.weekSends >= s.weeklyCap) {
    return { allowed: false, reason: "weekly_cap" };
  }

  // 11. low-confidence opportunities need enough real data to personalize.
  if (opportunity.confidence < DEFAULT_LOW_CONFIDENCE) {
    return { allowed: false, reason: "low_confidence" };
  }

  return { allowed: true, reason: null };
}
