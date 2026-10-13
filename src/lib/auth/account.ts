// ─────────────────────────────────────────────────────────────
// RUCHI — client account-deletion helper (browser-only)
// ─────────────────────────────────────────────────────────────
// Calls POST /api/account/delete with the current Supabase session token
// so the server can verify the caller and delete the right account.
//
// Behavior:
//  - Returns { ok: true } on a successful deletion response.
//  - Returns { ok: false, reason: 'unconfigured' } when Supabase is not
//    configured (no env vars / no client).
//  - Returns { ok: false, reason: 'network' } on fetch/transport failures.
//  - Returns { ok: false, reason: 'failed' } on non-200 responses or
//    unparseable outcomes.
//
// The server route already verifies the session and performs the actual
// deletion using the service-role key, so this helper never decides WHO to
// delete — it only forwards the authenticated request and reports the result.

import { getSupabase } from "./supabase";
import { currentSessionAccessToken } from "./supabase-auth";

export type AccountDeletionResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "network" | "failed" };

export async function deleteOwnAccount(): Promise<AccountDeletionResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, reason: "unconfigured" };
  }

  const token = await currentSessionAccessToken();
  if (!token) {
    // No valid session → the server will 401, but we can short-circuit.
    return { ok: false, reason: "failed" };
  }

  try {
    const response = await fetch("/api/account/delete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      credentials: "include",
    });

    if (!response.ok) {
      // The server returns generic error text; we intentionally do not
      // parse/inspect it beyond the status code here.
      return { ok: false, reason: "failed" };
    }

    const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    if (body && body.ok === true) {
      return { ok: true };
    }

    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
