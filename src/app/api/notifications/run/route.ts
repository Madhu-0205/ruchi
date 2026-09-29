// ─────────────────────────────────────────────────────────────
// RUCHI — POST /api/notifications/run  (Vercel Cron target)
// ─────────────────────────────────────────────────────────────
// The ONE scheduled entry point (docs/NOTIFICATION_LAYER.md §4).
// Two daily runs (10:00, 18:00 IST) — deliberately few.
//
// Per user:
//  1. Load REAL data server-side: notification prefs, attention
//     state mirror, completion history (cooking_completions, with
//     completed_meals as legacy fallback).
//  2. Run the SAME pure engine functions the client runs
//     (evaluateAttention + isSuppressed via the planner) — one
//     deterministic answer, zero duplicated suppression logic.
//  3. planDelivery applies quiet hours, weekly cap, channel rules.
//  4. WebPushAdapter delivers; success updates the attention
//     mirror and the weekly-send counter.
//  5. Dead subscriptions (404/410) are pruned.
//
// Engine input in v1 uses server-authoritative data ONLY:
// completion history + attention state. The kitchen inventory is
// client-local, so inventory-dependent contexts (unused_ingredients,
// quick_win, ...) naturally go quiet server-side rather than being
// fabricated — the engine's silence IS the correct behavior.
//
// Security: the route requires CRON_SECRET (Authorization: Bearer
// <secret>, matching Vercel Cron's header). Without it configured
// the route refuses to run. Bounded batch; a long queue resumes
// next cron. No queue infrastructure.
//
// The send-log table is created by migration 0005 (same directory).

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateAttention,
  type AttentionInput,
  type AttentionType,
} from "@/lib/context/attention";
import {
  planDelivery,
  weekKeyOf,
  type WeeklySendRecord,
} from "@/lib/notifications/planner";
import { webPushAdapter } from "@/lib/notifications/web-push";
import type { AttentionStateMirror } from "@/lib/auth/supabase-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Batch ceiling — self-limits; the rest resumes on the next run. */
const BATCH_SIZE = 200;

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
  attention_state: AttentionStateMirror | null;
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
      "user_id, channels, web_push_subscription, quiet_hours, max_per_week, attention_state",
    )
    .contains("channels", { web_push: true })
    .limit(BATCH_SIZE);

  if (optErr) {
    return NextResponse.json({ error: "query-failed" }, { status: 500 });
  }

  const results = { delivered: 0, skipped: 0, pruned: 0, errors: 0 };

  for (const row of (opted ?? []) as OptedInRow[]) {
    try {
      const outcome = await processUser(supabase, row, now);
      if (outcome === "delivered") results.delivered++;
      else if (outcome === "pruned") results.pruned++;
      else results.skipped++;
    } catch {
      results.errors++;
    }
  }

  // The majority outcome is silence — that's the product working.
  return NextResponse.json({ ok: true, now, ...results });
}

type EngineHistoryEntry = AttentionInput["history"][number];

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

async function processUser(
  supabase: SupabaseClient,
  row: OptedInRow,
  now: number,
): Promise<"delivered" | "pruned" | "skipped"> {
  const history = await fetchHistory(supabase, row.user_id);

  const mirror = row.attention_state ?? {};
  const lastShown = mirror.lastShown
    ? {
        type: mirror.lastShown.type as AttentionType,
        recipeId: mirror.lastShown.recipeId,
        at: mirror.lastShown.at,
      }
    : null;

  // ── Engine input: server-authoritative real data only.
  const input: AttentionInput = {
    now,
    inventoryIds: [], // client-local; inventory contexts stay quiet
    diet: "non-vegetarian", // neutral; unused without inventory
    history,
    pausedSession: null, // in-app surface only (v1 decision)
    lastShown,
  };

  const ctx = evaluateAttention(input, null, null);

  // ── Weekly send counter (real deliveries, from the send log).
  const { data: sendRow } = await supabase
    .from("notification_send_log")
    .select("weeks")
    .eq("user_id", row.user_id)
    .maybeSingle();
  const sends: WeeklySendRecord = ((sendRow?.weeks ?? {}) as WeeklySendRecord) ?? {};

  const plan = await planDelivery(
    {
      ctx,
      userId: row.user_id,
      prefs: {
        channels: (row.channels ?? {}) as Record<string, boolean>,
        webPushSubscription: row.web_push_subscription,
        quietHours: row.quiet_hours ?? { start: 22, end: 8 },
        maxPerWeek: row.max_per_week ?? 2,
      },
      suppression: { lastShown, suppressionUntil: mirror.suppressionUntil ?? null },
      weeklySends: sends,
      now,
    },
    [webPushAdapter],
  );

  if (plan.action === "skip") return "skipped";

  // ── Deliver through the one chosen channel (v1: web push).
  const deliverable = {
    ...plan.message,
    subscription: row.web_push_subscription,
  } as Parameters<typeof webPushAdapter.deliver>[0];
  const result = await webPushAdapter.deliver(deliverable);

  if (!result.ok) {
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
        .eq("user_id", row.user_id);
      return "pruned";
    }
    return "skipped";
  }

  // ── Record: attention mirror + weekly counter (same contract the
  //    client uses; one delivery = one lastShown = one counter tick).
  const week = weekKeyOf(now);
  const newSends: WeeklySendRecord = { ...sends, [week]: (sends[week] ?? 0) + 1 };
  await supabase
    .from("notification_prefs")
    .update({
      attention_state: { lastShown: plan.recordShown, suppressionUntil: null },
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", row.user_id);
  await supabase.from("notification_send_log").upsert({
    user_id: row.user_id,
    weeks: newSends,
    updated_at: new Date().toISOString(),
  });

  return "delivered";
}
