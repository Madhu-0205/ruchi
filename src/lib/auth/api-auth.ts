// ─────────────────────────────────────────────────────────────
// RUCHI — server-side API authentication (server-only)
// ─────────────────────────────────────────────────────────────
// The single auth gate for every user-scoped API route. The request's
// Supabase session Bearer is verified against Supabase Auth (the ONLY
// authority) and the route proceeds with the verified user — a
// client-supplied user_id is never trusted for ownership anywhere.
// Ownership itself stays enforced by RLS; this module answers only
// "who is calling?" so no route re-implements it.
//
// Failures return a generic 401 with no provider detail (same posture
// as the app's auth card: honest, non-enumerating, non-technical).

import { createClient } from "@supabase/supabase-js";

/** Shape the routes need: just the verified caller's id. */
export interface AuthedUser {
  id: string;
}

function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Accept both spellings of the publishable key; publishable is canonical.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/** True when Supabase env vars exist server-side. */
export function isSupabaseServerConfigured(): boolean {
  return supabaseEnv() !== null;
}

export type ApiAuthResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; status: 401 };

/**
 * Verify the request's Supabase session Bearer. Returns the verified
 * user, or a 401 the route can return verbatim. Never throws.
 */
export async function authenticateRequest(req: Request): Promise<ApiAuthResult> {
  const env = supabaseEnv();
  if (!env) return { ok: false, status: 401 };

  const auth = req.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401 };
  }

  // Scoped client carrying the caller's token — auth.getUser() verifies
  // the JWT against Supabase Auth server-side (signature + expiry) and
  // returns the canonical user, or errors for tampered/expired tokens.
  const supabase = createClient(env.url, env.key, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await supabase.auth.getUser();
    const user = data?.user;
    if (error || !user) return { ok: false, status: 401 };
    return { ok: true, user: { id: user.id } };
  } catch {
    return { ok: false, status: 401 };
  }
}
