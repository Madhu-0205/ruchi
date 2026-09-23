// ─────────────────────────────────────────────────────────────
// RUCHI — Supabase auth service (identity + durable user data)
// ─────────────────────────────────────────────────────────────
// The app-facing auth interface. The store and screens talk only to
// these functions — supabase-js types never leak into the UI. The AI
// layer is NOT involved here: authentication is Supabase-only. Separation
// of concerns, enforced by imports.
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
  | "email-not-confirmed"
  | "email-taken"
  | "weak-password"
  | "password-reuse"
  | "rate-limited"
  | "network"
  | "unconfigured"
  | "error";

const friendlyMessage: Record<AuthFailure, string> = {
  "invalid-credentials": "That email and password don't match an account.",
  "email-not-confirmed": "Confirm your email first — the link is in your inbox.",
  "email-taken": "An account with this email already exists. Try signing in instead.",
  "weak-password": "Choose a stronger password — at least 6 characters.",
  "password-reuse": "Pick a password you haven't used before.",
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
function classify(error: {
  message?: string;
  code?: string | number;
  status?: number;
} | null): AuthFailure {
  if (!error) return "error";
  const msg = (error.message ?? "").toLowerCase();
  // supabase-js exposes stable error codes (e.g. "over_email_send_rate_limit")
  // on some paths and human messages on others — match both.
  const code = String(error.code ?? "").toLowerCase();
  if (msg.includes("invalid login credentials")) return "invalid-credentials";
  if (msg.includes("email not confirmed") || msg.includes("not confirmed"))
    return "email-not-confirmed";
  if (msg.includes("already registered") || msg.includes("already exists")) return "email-taken";
  if (msg.includes("password") && (msg.includes("weak") || msg.includes("short") || msg.includes("at least")))
    return "weak-password";
  if (msg.includes("different from the old") || msg.includes("same as the old"))
    return "password-reuse";
  if (
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("too many") ||
    code.includes("rate_limit") ||
    error.status === 429 ||
    code === "429"
  )
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

// ── Password reset ───────────────────────────────────────────

/**
 * The URL users land on after tapping the reset link in the email.
 * Supabase rejects redirects to non-allow-listed URLs, so this must be
 * added to the project's Auth → URL Configuration → Redirect URLs.
 */
export function passwordResetRedirectUrl(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const configured = process.env.NEXT_PUBLIC_PASSWORD_RESET_REDIRECT;
  return configured || (origin ? `${origin}/` : "/");
}

/** Outcome of a reset-link request. `sent` means Supabase accepted it. */
export type ResetRequestOutcome =
  | { status: "sent"; email: string }
  | { status: "failed"; reason: AuthFailure };

/**
 * Request a password-reset email. The response intentionally does not
 * reveal whether the address has an account (same non-enumeration
 * posture as sign-in): the UI confirms only that the request was
 * accepted, never that an email is definitely on its way.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequestOutcome> {
  const supabase = getSupabase();
  if (!supabase) return { status: "failed", reason: "unconfigured" };
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: passwordResetRedirectUrl(),
    });
    if (error) return { status: "failed", reason: classify(error) };
    return { status: "sent", email };
  } catch (e) {
    return { status: "failed", reason: classify(e as { message?: string; status?: number }) };
  }
}

/** Outcome of applying a new password during a recovery session. */
export type PasswordUpdateOutcome =
  | { status: "updated" }
  | { status: "failed"; reason: AuthFailure };

/**
 * Set the new password inside a recovery session (the reset link signs
 * the user in with `PASSWORD_RECOVERY` state; updateUser swaps the
 * password and clears the recovery bit).
 */
export async function completePasswordReset(newPassword: string): Promise<PasswordUpdateOutcome> {
  const supabase = getSupabase();
  if (!supabase) return { status: "failed", reason: "unconfigured" };
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { status: "failed", reason: classify(error) };
    return { status: "updated" };
  } catch (e) {
    return { status: "failed", reason: classify(e as { message?: string; status?: number }) };
  }
}

/**
 * Detect and consume a password-recovery redirect.
 *
 * Supabase delivers recovery links in two styles depending on project
 * config: PKCE (?code=…, default) and legacy implicit (#access_token=…&
 * type=recovery). Both are read ONCE and erased from the address bar
 * immediately — recovery tokens must never linger in history or
 * referrers. Returns what the UI needs: that a recovery session exists,
 * plus the display email when available.
 */
export function consumeRecoveryRedirect(): { recovery: boolean; email: string | null } {
  if (typeof window === "undefined") return { recovery: false, email: null };
  const params = new URLSearchParams(window.location.search);
  let isRecovery = params.get("type") === "recovery";
  if (!isRecovery && window.location.hash.includes("type=recovery")) {
    isRecovery = true;
  }
  if (!isRecovery) return { recovery: false, email: null };

  // Exchange a PKCE code for a session when that style is in use.
  const code = params.get("code");
  if (code) {
    const supabase = getSupabase();
    void supabase?.auth
      .exchangeCodeForSession(code)
      .catch(() => {
        // A dead/used code leaves no session; the set-new-password card
        // will fail honestly on submit instead of pretending.
      })
      .finally(() => {
        window.history.replaceState(null, "", window.location.pathname);
      });
  } else {
    // Legacy implicit style: the SDK absorbs the hash tokens on its own;
    // scrubbing here keeps tokens out of the URL either way.
    window.history.replaceState(null, "", window.location.pathname);
  }

  return { recovery: true, email: null };
}
