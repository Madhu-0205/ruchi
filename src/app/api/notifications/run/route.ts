// ─────────────────────────────────────────────────────────────
// RUCHI — POST /api/notifications/run  (Vercel Cron target, 2.0)
// ─────────────────────────────────────────────────────────────
// The ONE scheduled entry point (docs/NOTIFICATION_LAYER.md §4).
// Two daily runs (10:00, 18:00 IST) — deliberately few.
//
// Notification Experience 2.0 pipeline, per user:
//   1. Load REAL server data: prefs (channels, quiet hours, caps,
//      per-type opt-outs), paused session, completion history
//      (cooking_completions with completed_meals legacy fallback),
//      and the user's recent LEDGER rows.
//   2. generateOpportunities → deterministic candidates from real
//      signals only (opportunities.ts; the Context Engine's
//      evaluateAttention is reused for the engine-class contexts).
//   3. pickWinner → exactly ONE candidate would ever speak.
//   4. evaluateOpportunity (policy.ts) → the centralized WHEN gate:
//      per-type opt-outs, subscription, active session, recent
//      cook/open, ledger duplicate check, per-class cooldowns,
//      quiet hours, daily/weekly caps, confidence floor. Silence
//      is a valid, recorded outcome ("did not notify" is success).
//   5. pickCopy (copy.ts) → tone-guarded, fact-filled copy; missing
//      facts fall back to honest generic copy.
//   6. recordNotification (ledger.ts) → claim the send slot by
//      dedup key BEFORE any I/O; a 23505 unique violation means
//      this exact notification already went out (idempotent cron
//      re-runs can never double-send).
//   7. webPushAdapter delivers (v2 sends directly through the one
//      adapter: the planner's v1 engine-contract gates — in-app-only
//      resume, engine-none — are superseded by the policy layer).
//   8. updateNotificationStatus settles the ledger row; the
//      attention mirror keeps in-app suppression in step.
//
// Server-authoritative data ONLY: the kitchen mirror is client-local,
// so inventory-dependent contexts stay quiet server-side rather than
// being fabricated. Every personalized statement traces to a real
// record — paused session, completion, or taxonomy shelf.
//
// Security: CRON_SECRET Bearer gate (Vercel Cron header), service-role
// client for ledger/prefs writes (ledger RLS grants clients SELECT on
// their own rows only). Bounded batch; a long queue resumes next cron.
//
// Schema: migration 0006 (notification_ledger, type_prefs,
// paused_session); migration 0005 tables remain for history.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Batch ceiling — self-limits; the rest resumes on the next run. */
const BATCH_SIZE = 200;

/** The product's home timezone: cron times and daily caps are IST. */
const IST_OFFSET_MIN = 330;

function istHourOf(now: number): number {
  return new Date(now + IST_OFFSET_MIN * 60_000).getUTCHours();
}

function istDayStartIso(now: number): string {
  const d = new Date(now + IST_OFFSET_MIN * 60_000);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_OFFSET_MIN * 60_000,
  ).toISOString();
}

/** The cron's own clock decides the meal window — never a guessed habit. */
function mealWindowLabelOf(now: number): ServerSignals["mealWindowLabel"] {
  const h = istHourOf(now);
  if (h >= 6 && h < 10) return "breakfast";
  if (h >= 12 && h < 15) return "lunch";
  if (h >= 18 && h < 22) return "dinner";
  return undefined;
}

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface OptedInRow {
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
  attention_state: {
    lastShown?: { type: string; recipeId?: string; at: number } | null;
    suppressionUntil?: number | null;
  } | null;
}

interface LedgerRecentRow {
  opportunity_type: string;
  dedup_key: string | null;
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

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron-not-configured" }, { status: 503 });
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service-unconfigured" }, { status: 503 });
  }

  const now = Date.now();

  // 1. Opted-in users only, batched. web_push enabled in channels.
  const { data: opted, error: optErr } = await supabase
    .from("notification_prefs")
    .select(
      "user_id, channels, web_push_subscription, quiet_hours, max_per_week, type_prefs, paused_session, attention_state",
    )
    .contains("channels", { web_push: true })
    .limit(BATCH_SIZE);

  if (optErr) {
    return NextResponse.json({ error: "query-failed" }, { status: 500 });
  }

  const results = {
    delivered: 0,
    suppressed: 0,
    skipped: 0,
    pruned: 0,
    failed: 0,
    errors: 0,
  };

  for (const row of (opted ?? []) as OptedInRow[]) {
    try {
      const outcome = await processUser(supabase, row, now);
      results[outcome]++;
    } catch {
      results.errors++;
    }
  }

  // The majority outcome is silence — that's the product working.
  return NextResponse.json({ ok: true, now, ...results });
}

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

async function fetchHistory(
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
 * Real ledger facts for the policy layer: per-type last-delivery times,
 * today's/this week's REAL delivery counts, last opened time, and the
 * dedup key of the most recent send (the duplicate check's anchor).
 * All from rows the service role owns the write path to.
 */
interface LedgerPolicyFacts {
  lastDeliveredAt: Record<string, number>;
  lastNotificationOpenedAt?: number;
  lastSentDedupKey: string | null;
  weekSends: number;
  daySends: number;
}

async function loadPolicyLedgerState(
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

type UserOutcome =
  | "delivered"
  | "suppressed"
  | "skipped"
  | "pruned"
  | "failed";

async function processUser(
  supabase: SupabaseClient,
  row: OptedInRow,
  now: number,
): Promise<UserOutcome> {
  const userId = row.user_id;
  const history = await fetchHistory(supabase, userId);

  // ── Real signals only. lastAction stays null until a client mirror
  //    exists; the kitchen is client-local; the paused session is the
  //    real one the user recorded on exit.
  const signals: ServerSignals = {
    userId,
    now,
    history,
    pausedSession: row.paused_session ?? null,
    lastCookedDay: history[0] ? dayKeyOf(history[0].cookedAt) : undefined,
    weekKey: weekKeyOf(now),
    lastAction: null,
    kitchen: null,
    diet: "non-vegetarian", // neutral; only consulted with a real kitchen
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

  // ── Deliver through the one chosen channel (v2: web push).
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
  const result = await webPushAdapter.deliver(deliverable);

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

// Vercel Cron invokes cron endpoints via HTTP GET (docs/cron-jobs) —
// both methods share THIS handler, so the CRON_SECRET Bearer gate, the
// service-role client and the entire 2.0 pipeline are identical either
// way. POST stays for manual/ops invocation (curl verification).
export const GET = POST;
