// ─────────────────────────────────────────────────────────────
// RUCHI — POST /api/account/delete (server-only)
// ─────────────────────────────────────────────────────────────
// Permanently deletes the authenticated user's Supabase Auth account and,
// via Postgres ON DELETE CASCADE, every user-owned record in the RUCHI
// schema: profiles, completed_meals, cooking_streaks, cooking_completions,
// notification_prefs, notification_send_log, notification_ledger,
// beta_feedback.
//
// Security posture:
//  - The target user id is NEVER taken from the request body or URL.
//    It is always derived from the verified Supabase session Bearer.
//  - The deletion uses the Supabase Auth Admin API through the shared
//    service-role client (lib/auth/api-auth), which is the only credential
//    that can delete auth users. The publishable/anon key client cannot.
//  - Supabase Storage is not used by this application (verified by codebase
//    inspection), so there are no stored objects to clean up here. If
//    storage is added later, this route must be extended to remove the
//    owner's objects BEFORE deleting the account.
//  - Responses are generic: no provider error text, no enumeration of
//    whether an email exists, no technical auth detail.
//
// Two failure modes this route is deliberately built not to repeat:
//  1. `auth-js`'s admin methods RETURN `{ data, error }` for API errors
//     rather than throwing (only transport failures throw). Ignoring the
//     returned `error` makes a failed deletion report success — the worst
//     possible outcome for an irreversible action.
//  2. Supabase's auth gateway requires the `apikey` header as well as the
//     Authorization Bearer. A hand-rolled client that sets only the Bearer
//     is rejected with 401 before GoTrue ever sees the request. The shared
//     service-role client sets both.
//
// WARNING: this action is irreversible. There is no soft delete and no
// recovery path.

import { NextResponse } from "next/server";
import { authenticateRequest, createServiceRoleClient } from "@/lib/auth/api-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Result of the privileged delete: ok, or the HTTP status to answer with. */
type DeleteOutcome = { ok: true } | { ok: false; status: number };

/**
 * Delete the auth user with the service-role credential. Idempotent from
 * the caller's perspective: a user that is already gone counts as success,
 * because the requested end state (no account) holds.
 */
async function deleteAuthAccount(userId: string): Promise<DeleteOutcome> {
  const supabase = createServiceRoleClient();
  if (!supabase) return { ok: false, status: 503 };

  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (!error) return { ok: true };

    const status = typeof error.status === "number" ? error.status : undefined;
    const message = (error.message ?? "").toLowerCase();
    const code = String((error as { code?: string | number }).code ?? "").toLowerCase();

    // Already gone: the account is not there to delete, which is the state
    // the user asked for. Safe to report success.
    if (
      status === 404 ||
      code.includes("not_found") ||
      message.includes("not found")
    ) {
      return { ok: true };
    }

    // The service-role credential was rejected or lacks permission: a
    // server misconfiguration the user cannot act on.
    if (status === 401 || status === 403) return { ok: false, status: 503 };

    if (status === 429 || code.includes("rate_limit")) {
      return { ok: false, status: 429 };
    }

    return { ok: false, status: 502 };
  } catch {
    // Transport-level failure (DNS, TLS, timeout, aborted fetch).
    return { ok: false, status: 504 };
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: auth.status });
  }

  // The only authorized caller deletes their own account. The userId comes
  // from the verified session, not from any client-controlled parameter.
  const result = await deleteAuthAccount(auth.user.id);

  if (result.ok) return NextResponse.json({ ok: true });

  return NextResponse.json(
    { error: "Couldn't complete account deletion. Please try again in a moment." },
    { status: result.status },
  );
}

// No GET/other methods — account deletion is an explicit destructive action.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}
