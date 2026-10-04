// ─────────────────────────────────────────────────────────────
// RUCHI — POST /api/notifications/run  (Vercel Cron target, 2.0)
// ─────────────────────────────────────────────────────────────
// The ONE scheduled entry point (docs/NOTIFICATION_LAYER.md §4).
// Two daily runs (10:00, 18:00 IST) — deliberately few.
//
// This route is the security + batch shell: CRON_SECRET Bearer gate,
// service-role client, opted-in batch select. The per-user pipeline
// itself (opportunities → winner → policy → copy → ledger claim →
// deliver → settle) lives in lib/notifications/pipeline.ts so the E2E
// simulation can drive THE REAL code against a real Postgres — the
// production behavior and the tested behavior can never drift.
//
// Schema: migration 0006 (notification_ledger, type_prefs,
// paused_session, kitchen_mirror, last_action). Migration 0005 tables
// remain for history.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { processUser, type OptedInRow, type UserOutcome } from "@/lib/notifications/pipeline";

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
      "user_id, channels, web_push_subscription, quiet_hours, max_per_week, type_prefs, paused_session, kitchen_mirror, last_action, attention_state",
    )
    .contains("channels", { web_push: true })
    .limit(BATCH_SIZE);

  if (optErr) {
    return NextResponse.json({ error: "query-failed" }, { status: 500 });
  }

  const results: Record<UserOutcome | "errors", number> = {
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

// Vercel Cron invokes cron endpoints via HTTP GET (docs/cron-jobs) —
// both methods share THIS handler, so the CRON_SECRET Bearer gate, the
// service-role client and the entire 2.0 pipeline are identical either
// way. POST stays for manual/ops invocation (curl verification).
export const GET = POST;
