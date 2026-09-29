// ─────────────────────────────────────────────────────────────
// RUCHI — POST/DELETE /api/notifications/subscribe
// ─────────────────────────────────────────────────────────────
// Stores/clears the signed-in user's push subscription in their OWN
// notification_prefs row. The route validates only the subscription's
// shape; ownership is enforced by the RLS-scoped browser client —
// the same posture as every other durable-data write.
//
// Opt-in stays explicit: a subscribe from a user with NO prefs row
// fails rather than creating one (the row exists only when the user
// opted in from Profile). DELETE clears the subscription in place.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isValidSubscription } from "@/lib/notifications/web-push";

export const dynamic = "force-dynamic";

async function userScoped(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("Authorization");
  if (!url || !key || !auth) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  const supabase = await userScoped(req);
  if (!supabase) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const subscription = (body as { subscription?: unknown })?.subscription;
  if (!isValidSubscription(subscription)) {
    return NextResponse.json({ error: "bad-subscription" }, { status: 400 });
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // The row must already exist (created at opt-in). Update-only keeps
  // that invariant; the channels.web_push flag also stays as-is.
  const { data, error } = await supabase
    .from("notification_prefs")
    .update({
      web_push_subscription: subscription,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select("user_id");

  if (error) {
    return NextResponse.json({ error: "storage-failed" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    // No prefs row → the user never opted in. Do NOT create one.
    return NextResponse.json({ error: "not-opted-in" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await userScoped(req);
  if (!supabase) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { error } = await supabase
    .from("notification_prefs")
    .update({
      web_push_subscription: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  return error
    ? NextResponse.json({ error: "storage-failed" }, { status: 500 })
    : NextResponse.json({ ok: true });
}
