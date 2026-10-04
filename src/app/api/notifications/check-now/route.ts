// ─────────────────────────────────────────────────────────────
// RUCHI — POST /api/notifications/check-now  (Notification 2.0)
// ─────────────────────────────────────────────────────────────
// The user-initiated version of the daily check. Profile's "Check now"
// action lands here: THE SAME pipeline, policy, ledger and copy as the
// scheduled run — only the scope differs (the caller's own row, not
// the whole opted-in batch).
//
// Auth posture mirrors /api/notifications/engagement: the caller's
// Supabase access token is validated server-side (getUser), then the
// pipeline runs under the SERVICE-ROLE client — processUser writes to
// notification_ledger, which clients can never write to directly
// (migration 0006 RLS). Ownership is guaranteed by selecting ONLY the
// caller's own notification_prefs row, keyed by the validated uid.
//
// Abuse posture: this endpoint cannot spam. The policy layer caps at
// 1/day and 2/week with per-type cooldowns and ledger dedup — a
// "check now" is exactly as rate-limited as the 6 pm cron. Silence
// stays a valid outcome; users who never opted in get an honest no-op
// with zero ledger noise.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  processUser,
  type OptedInRow,
  type UserOutcome,
} from "@/lib/notifications/pipeline";
import { isValidSubscription } from "@/lib/notifications/web-push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type CheckOutcome = UserOutcome | "not_opted_in";

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service-unconfigured" }, { status: 503 });
  }

  // 1. Validate the caller's own token (same posture as engagement).
  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. ONLY the caller's own prefs row — the uid comes from the
  //    validated token, never from the request body.
  const { data: rows } = await supabase
    .from("notification_prefs")
    .select(
      "user_id, channels, web_push_subscription, quiet_hours, max_per_week, type_prefs, paused_session, kitchen_mirror, last_action, attention_state",
    )
    .eq("user_id", user.id)
    .limit(1);

  const row = (rows as OptedInRow[] | null)?.[0];

  // 3. Opted-in means the master flag AND a real subscription. Anything
  //    else is an honest no-op — no suppression rows, no side effects.
  if (!row || row.channels?.web_push !== true || !isValidSubscription(row.web_push_subscription)) {
    return NextResponse.json({ ok: true, outcome: "not_opted_in" satisfies CheckOutcome });
  }

  // 4. The real pipeline, real policy, real ledger — same code path the
  //    cron uses (the E2E simulation drives this exact function).
  try {
    const outcome = await processUser(supabase, row, Date.now());
    return NextResponse.json({ ok: true, outcome });
  } catch {
    return NextResponse.json({ error: "check-failed" }, { status: 500 });
  }
}
