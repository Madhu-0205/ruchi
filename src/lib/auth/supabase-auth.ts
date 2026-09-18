// ─────────────────────────────────────────────────────────────
// RUCHI — Supabase auth service (identity + durable user data)
// ─────────────────────────────────────────────────────────────
// The app-facing auth interface. The store and screens talk only to
// these functions — supabase-js types never leak into the UI. Puter is
// NOT involved here: it stays behind the AI bridge for AI capability
// only. Separation of concerns, enforced by imports.
//
// Behavior when Supabase is not configured (no env vars): every function
// degrades honestly — sign-up/in report "unconfigured", the listener is
// never attached, and identity stays null. The app remains fully usable
// anonymously.

"use client";

import { getSupabase, isSupabaseConfigured } from "./supabase";
import type { Session, User } from "@supabase/supabase-js";

/** The identity shape the app uses — no SDK types leak past this module. */
export interface AccountUser {
  id: string;
  email: string | null;
  /** Display name: profile.display_name, falling back to the email prefix. */
  displayName: string | null;
}

export type AuthFailure =
  | "invalid-credentials"
  | "email-taken"
  | "weak-password"
  | "rate-limited"
  | "network"
  | "unconfigured"
  | "error";

const friendlyMessage: Record<AuthFailure, string> = {
  "invalid-credentials": "That email and password don't match an account.",
  "email-taken": "An account with this email already exists. Try signing in instead.",
  "weak-password": "Choose a stronger password — at least 6 characters.",
  "rate-limited": "Too many attempts just now. Wait a minute and try again.",
  network: "Couldn't reach the account service. Check your connection.",
  unconfigured: "Accounts aren't set up in this build yet.",
  error: "Something went wrong. Try again in a bit.",
};

/** User-facing copy for a failure — never a raw provider/SDK error. */
export function authErrorMessage(kind: AuthFailure): string {
  return friendlyMessage[kind];
}

/** Map a supabase-js error to a stable, user-friendly failure kind. */
function classify(error: { message?: string; status?: number } | null): AuthFailure {
  if (!error) return "error";
  const msg = (error.message ?? "").toLowerCase();
  if (msg.includes("invalid login credentials")) return "invalid-credentials";
  if (msg.includes("already registered") || msg.includes("already exists")) return "email-taken";
  if (msg.includes("password") && (msg.includes("weak") || msg.includes("short") || msg.includes("at least")))
    return "weak-password";
  if (msg.includes("rate limit") || msg.includes("too many") || error.status === 429)
    return "rate-limited";
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed to fetch"))
    return "network";
  return "error";
}

function toAccountUser(u: User | null, displayName?: string | null): AccountUser | null {
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as { display_name?: string; name?: string };
  return {
    id: u.id,
    email: u.email ?? null,
    displayName:
      displayName ?? meta.display_name ?? meta.name ?? (u.email ? u.email.split("@")[0] : null) ?? null,
  };
}

// ── Sign-up / sign-in / sign-out ─────────────────────────────

export type SignUpOutcome =
  | { status: "signed-in"; user: AccountUser }
  | { status: "needs-email-confirmation"; email: string }
  | { status: "failed"; reason: AuthFailure };

export async function signUp(email: string, password: string): Promise<SignUpOutcome> {
  const supabase = getSupabase();
  if (!supabase) return { status: "failed", reason: "unconfigured" };
  let data: Awaited<ReturnType<typeof supabase.auth.signUp>>["data"] = {
    session: null,
    user: null,
  };
  let error: { message?: string; status?: number } | null = null;
  try {
    ({ data, error } = await supabase.auth.signUp({ email, password }));
  } catch (e) {
    // Network failures throw; auth failures come back as `error`.
    error = e as { message?: string; status?: number };
  }
  if (error) return { status: "failed", reason: classify(error) };
  // When email confirmation is on, data.user exists but no session comes back.
  if (data.session && data.user) {
    const user = toAccountUser(data.user);
    return user ? { status: "signed-in", user } : { status: "failed", reason: "error" };
  }
  return { status: "needs-email-confirmation", email };
}

export type SignInOutcome =
  | { status: "signed-in"; user: AccountUser }
  | { status: "failed"; reason: AuthFailure };

export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  const supabase = getSupabase();
  if (!supabase) return { status: "failed", reason: "unconfigured" };
  let user: User | null = null;
  let error: { message?: string; status?: number } | null = null;
  try {
    const res = await supabase.auth.signInWithPassword({ email, password });
    user = res.data.user;
    error = res.error;
  } catch (e) {
    error = e as { message?: string; status?: number };
  }
  if (error || !user) {
    return { status: "failed", reason: error ? classify(error) : "error" };
  }
  const account = toAccountUser(user);
  return account ? { status: "signed-in", user: account } : { status: "failed", reason: "error" };
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // signing out must never throw into the UI
  }
}

// ── Session restoration + change listener ────────────────────

/** Restore an existing session after a page refresh. Null when anonymous. */
export async function currentUser(): Promise<AccountUser | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return toAccountUser(data.session?.user ?? null);
}

export interface AuthSubscription {
  unsubscribe: () => void;
}

/**
 * Subscribe to auth state changes (sign-in, sign-out, token refresh,
 * user switch). Fires once with the current state on attach, so the
 * store initializes from a single code path.
 */
export function onAuthChange(
  handler: (user: AccountUser | null) => void,
): AuthSubscription | null {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
    handler(toAccountUser(session?.user ?? null));
  });
  return { unsubscribe: () => data.subscription.unsubscribe() };
}

/** True when Supabase credentials exist in the build. */
export function authAvailable(): boolean {
  return isSupabaseConfigured();
}
