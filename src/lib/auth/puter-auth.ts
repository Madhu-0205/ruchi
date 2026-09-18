// ─────────────────────────────────────────────────────────────
// RUCHI — [DEPRECATED] Puter-backed identity + KV persistence
// ─────────────────────────────────────────────────────────────
// SUPERSEDED by Supabase (see supabase-auth.ts / supabase-data.ts):
// RUCHI account identity, profiles, completed meals and streaks now live
// in Supabase Auth + Postgres with row-level security. No production code
// imports this module anymore; kept temporarily for reference and deleted
// in a follow-up cleanup. Puter itself remains the AI layer (lib/ai/*).
//
// Design rules:
// - Anonymous-first: nothing here gates the core loop.
// - Puter is an implementation detail behind this module's interface.
// - Cloud is a MIRROR, never the source of truth. Local (localStorage)
//   state always wins on conflict; cloud fill-in only adds missing data.

"use client";

import {
  puterSignIn,
  puterGetUser,
  puterIsSignedIn,
  puterSignOut,
  puterKvGet,
  puterKvSet,
  lastAuthFailureKind,
  type AuthFailureKind,
} from "@/lib/ai/puter";

const KV_SNAPSHOT_KEY = "ruchi.snapshot.v1";

export interface AccountUser {
  username: string;
  isTemp: boolean; // Puter "temporary" accounts created silently for AI quota
}

export type SignInOutcome =
  | { status: "signed-in"; user: AccountUser }
  | { status: "unavailable"; reason?: AuthFailureKind } // no SDK / offline / provider disabled
  | { status: "dismissed" }; // user closed the popup — not an error

/** Sign in via Puter's browser popup. Must be called from a user gesture. */
export async function signIn(): Promise<SignInOutcome> {
  const user = await puterSignIn({ attempt_temp_user_creation: false, request_auth: true });
  if (!user?.username) {
    return { status: "unavailable", reason: lastAuthFailureKind() ?? undefined };
  }
  return {
    status: "signed-in",
    user: { username: user.username, isTemp: Boolean(user.is_temp) },
  };
}

export function isSignedIn(): boolean {
  return puterIsSignedIn();
}

export async function currentUser(): Promise<AccountUser | null> {
  const u = await puterGetUser();
  if (!u?.username) return null;
  return { username: u.username, isTemp: Boolean(u.is_temp) };
}

export function signOut(): void {
  puterSignOut();
}

/** Persist a snapshot of app state to the user's cloud KV. */
export async function saveSnapshot(snapshot: unknown): Promise<boolean> {
  try {
    return await puterKvSet(KV_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    return false;
  }
}

export type LoadSnapshotResult =
  | { status: "none" } // nothing stored (or cloud unavailable) — keep local
  | { status: "loaded"; snapshot: unknown };

/** Read the cloud snapshot. Null result never overwrites local state. */
export async function loadSnapshot(): Promise<LoadSnapshotResult> {
  const raw = await puterKvGet(KV_SNAPSHOT_KEY);
  if (!raw) return { status: "none" };
  try {
    return { status: "loaded", snapshot: JSON.parse(raw) };
  } catch {
    return { status: "none" }; // corrupt snapshot → ignore, local wins
  }
}
