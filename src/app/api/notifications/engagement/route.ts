// ─────────────────────────────────────────────────────────────
// RUCHI — /api/notifications/engagement  (Notification 2.0)
// ─────────────────────────────────────────────────────────────
// Records the browser-visible moments of a delivered notification:
//   POST /engagement   Authorization: Bearer <supabase access_token>
//   body: { ledger_id: string, actioned?: boolean }
//
// The ONLY write path into notification_ledger is the SECURITY DEFINER
// RPC mark_notification_engaged(uuid, actioned): the ledger grants
// authenticated users SELECT on their own rows and nothing else
// (migration 0006), so no direct table write — here or in the browser —
// could ever pass RLS. This route authenticates the caller's Supabase
// access token (Authorization header) and invokes the same RPC under
// the user's own JWT: auth.uid() inside the RPC is the ownership gate,
// so a foreign or bogus ledger id is a silent no-op.
//
// The signed-in PWA records engagement directly via
// lib/auth/supabase-data.ts (same RPC, browser session). This route
// exists for surfaces without a browser session store (service worker
// push handlers, future native shells).
//
// Scope (spec §16): notification_opened → useful session → meal
// decision → cooking start → cooking completion. The leading edge is
// recorded here; the tail is the app's own analytics.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function userScopedClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // Publishable key + the caller's own access token: every statement runs
  // under the user's JWT, so RLS and the RPC's auth.uid() check apply.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const { ledger_id, actioned } = typeof json === "object" && json !== null && !Array.isArray(json)
    ? (json as { ledger_id?: unknown; actioned?: unknown })
    : {};

  if (typeof ledger_id !== "string" || ledger_id.length === 0) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = userScopedClient(token);
  if (!supabase) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }

  // Rejects foreign/tampered tokens: getUser validates the JWT server-side.
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // RLS-scoped via the RPC: only the caller's own ledger row can be
  // engaged; opened_at wins first-write, actioned_at never un-sets.
  const { error } = await supabase.rpc("mark_notification_engaged", {
    p_ledger_id: ledger_id,
    p_actioned: actioned === true,
  });

  if (error) {
    return NextResponse.json({ error: "storage-failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
