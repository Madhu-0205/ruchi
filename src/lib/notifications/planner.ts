// ─────────────────────────────────────────────────────────────
// RUCHI — Delivery planner (server-side attention → messages)
// ─────────────────────────────────────────────────────────────
// Build-order step 4 of docs/NOTIFICATION_LAYER.md: the ONE place
// that turns a real AttentionContext into a sendable PlainMessage
// under the user's preferences, quiet hours, weekly cap and the
// shared suppression contract.
//
// Rules enforced here (all tested):
//  • The engine said "none" → silence. The planner cannot invent
//    a context, ever.
//  • Deep-link parity: the message lands on a Home state that
//    reproduces the context; `expiresAt` (engine copy must still
//    be true at tap time) is derived from the context's own
//    cooldown so stale pushes are dropped, not delivered.
//  • Deliberate v1 exclusion: `incomplete_session` is NEVER
//    delivered cross-device — a paused pan is urgent only
//    in-session; a push for it risks feeling tracked. It stays
//    an in-app surface.
//  • One adapter per delivery: the planner picks by channel
//    preference order and records what it did so the caller can
//    mirror lastShown atomically with the send.

import type { AttentionContext, AttentionType } from "@/lib/context/attention";
import { isSuppressed, type SuppressionState } from "@/lib/context/attention";
import type {
  AdapterPrefs,
  Channel,
  DeliveryAdapter,
  PlainMessage,
} from "./types";

// ── Tunables ─────────────────────────────────────────────────

/**
 * Channel preference order: web push first, then the channels that
 * exist later. The FIRST enabled+available channel wins; RUCHI sends
 * ONE message, never a barrage across channels.
 */
export const CHANNEL_PREFERENCE: Channel[] = [
  "web_push",
  "widget",
  "email",
  "whatsapp",
];

/**
 * Per-type push staleness windows, mirroring the engine's suppression
 * cooldowns: if the context would no longer be shown in-app, a tap on
 * the push must not land on a Home that disagrees with the message.
 * Falls back to 12h (the engine's default cooldown) for new types.
 */
const PUSH_TTL_MS: Partial<Record<AttentionType, number>> = {
  incomplete_session: 30 * 60_000,
  unused_ingredients: 6 * 3_600_000,
  repeat_success: 12 * 3_600_000,
  meal_time: 8 * 3_600_000,
  recent_cooking: 24 * 3_600_000,
  return_visit: 24 * 3_600_000,
  cooking_gap: 48 * 3_600_000,
  quick_win: 6 * 3_600_000,
  budget_win: 12 * 3_600_000,
  protein_fit: 12 * 3_600_000,
};

const DEFAULT_TTL_MS = 12 * 3_600_000;

/** Contexts that must never become a push (v1 product decision). */
const UNDELIVERABLE_TYPES: ReadonlySet<AttentionType> = new Set([
  "incomplete_session", // in-app only; see header
]);

// ── Quiet hours & weekly cap (pure, tested) ──────────────────

/**
 * Is `hour` (user-local) inside the quiet window [start, end)?
 * Wraps midnight: {start:22, end:8} covers 22:00→07:59.
 * start === end means no quiet window.
 */
export function isQuietHour(
  hour: number,
  quiet: { start: number; end: number },
): boolean {
  const s = quiet.start;
  const e = quiet.end;
  if (s === e) return false;
  if (s < e) return hour >= s && hour < e;
  return hour >= s || hour < e; // wraps midnight
}

/** Monday-based week bucket for the weekly cap. */
export function weekKeyOf(now: number): string {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  return String(monday);
}

export interface WeeklySendRecord {
  /** weekKeyOf() → count of messages actually delivered. */
  [weekKey: string]: number;
}

export function weeklyCount(sends: WeeklySendRecord, now: number): number {
  return sends[weekKeyOf(now)] ?? 0;
}

// ── Planner ──────────────────────────────────────────────────

export interface PlanInput {
  /** The engine's already-decided context (or its "none"). */
  ctx: AttentionContext;
  userId: string;
  prefs: AdapterPrefs & {
    quietHours: { start: number; end: number };
    maxPerWeek: number;
  };
  /** Server mirror of the client's attention state. */
  suppression: SuppressionState;
  /** Messages actually delivered, keyed by week (for the cap). */
  weeklySends: WeeklySendRecord;
  now: number;
}

export type PlanOutcome =
  | {
      action: "deliver";
      message: PlainMessage;
      channel: Channel;
      /** Mirror the client-side attention state after delivering. */
      recordShown: { type: AttentionType; recipeId?: string; at: number };
    }
  | { action: "skip"; reason: PlanSkipReason };

export type PlanSkipReason =
  | "engine-none"
  | "undeliverable-type"
  | "channel-off"
  | "no-available-adapter"
  | "quiet-hours"
  | "weekly-cap"
  | "suppressed"
  | "expired";

/**
 * Decide the ONE delivery for this user right now — or, in the
 * majority of runs, silence. Pure except for adapter availability.
 */
export async function planDelivery(
  input: PlanInput,
  adapters: DeliveryAdapter[],
): Promise<PlanOutcome> {
  const { ctx, prefs, suppression, weeklySends, now } = input;

  // 1. The engine's silence is the planner's silence.
  if (ctx.type === "none") return { action: "skip", reason: "engine-none" };

  // 2. Product-level exclusions.
  if (UNDELIVERABLE_TYPES.has(ctx.type)) {
    return { action: "skip", reason: "undeliverable-type" };
  }

  // 3. Shared suppression contract — same function the client runs.
  if (isSuppressed(ctx, suppression, now)) {
    return { action: "skip", reason: "suppressed" };
  }

  // 4. Quiet hours (user-local hour; the cron runs at meal times so
  //    this is normally a no-op — it exists to honor manual changes).
  const hour = new Date(now).getHours();
  if (isQuietHour(hour, prefs.quietHours)) {
    return { action: "skip", reason: "quiet-hours" };
  }

  // 5. Weekly cap — counted from REAL deliveries, not attempts.
  if (weeklyCount(weeklySends, now) >= prefs.maxPerWeek) {
    return { action: "skip", reason: "weekly-cap" };
  }

  // 6. Pick ONE adapter by preference order: enabled first, then
  //    actually available (subscription exists / address verified).
  const enabled = CHANNEL_PREFERENCE.filter((ch) => prefs.channels[ch] === true);
  if (enabled.length === 0) return { action: "skip", reason: "channel-off" };
  for (const channel of enabled) {
    const adapter = adapters.find((a) => a.channel === channel);
    if (!adapter) continue;
    if (!(await adapter.isAvailable(prefs))) continue;
    return buildDelivery(ctx, input.userId, channel, now);
  }
  return { action: "skip", reason: "no-available-adapter" };
}

function buildDelivery(
  ctx: AttentionContext,
  userId: string,
  channel: Channel,
  now: number,
): Extract<PlanOutcome, { action: "deliver" }> {
  const ttl = PUSH_TTL_MS[ctx.type] ?? DEFAULT_TTL_MS;
  return {
    action: "deliver",
    channel,
    message: {
      userId,
      contextType: ctx.type,
      recipeId: ctx.recipeId,
      headline: ctx.headline,
      supportingText: ctx.supportingText,
      deepLink: ctx.recipeId ? `/?recipe=${ctx.recipeId}` : "/",
      // Stale context ≠ notification: the message self-destructs from
      // relevance at exactly the moment Home would stop showing it.
      expiresAt: now + ttl,
    },
    recordShown: { type: ctx.type, recipeId: ctx.recipeId, at: now },
  };
}

/**
 * Which channel should the SERVICE WORKER surface this through — a
 * helper for tests that asserts the planner's one-channel invariant.
 * Not used in production paths.
 */
export function assertSingleChannel(channels: Channel[]): void {
  if (new Set(channels).size > 1) {
    throw new Error("RUCHI delivers at most ONE message per planning run");
  }
}
