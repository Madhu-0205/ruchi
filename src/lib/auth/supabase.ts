// ─────────────────────────────────────────────────────────────
// RUCHI — Supabase client (the ONLY module importing supabase-js)
// ─────────────────────────────────────────────────────────────
// Supabase owns RUCHI user identity + durable data (profiles, completed
// meals, streaks). Puter remains the AI layer only. These are separate
// concerns and stay separate: no Supabase call decides AI behavior, and
// no Puter call decides account state.
//
// Browser-only config by design: the publishable (anon) key is public by
// contract and safe in the client. Service-role keys must never appear
// here or anywhere client-side. When env vars are absent the client is
// null and every consumer degrades to anonymous/local behavior — the
// app is fully usable without Supabase.

"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function readEnv(): { url: string; key: string } | null {
  // NEXT_PUBLIC_* are inlined at build time; reading them inside a function
  // keeps SSR bundles honest and makes the "not configured" case explicit.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Accept both spellings of the publishable key; publishable is canonical.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

let client: SupabaseClient | null = null;
let initAttempted = false;

/** The shared browser client, or null when Supabase is not configured. */
export function getSupabase(): SupabaseClient | null {
  if (typeof window === "undefined") return null; // auth is client-only by design
  if (client) return client;
  if (initAttempted) return null;
  const env = readEnv();
  if (!env) {
    initAttempted = true;
    return null;
  }
  initAttempted = true;
  client = createClient(env.url, env.key, {
    auth: {
      // supabase-js stores the session itself (localStorage under the hood
      // by default) — the app must NOT implement its own token storage.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // no OAuth/email-link flows in this app
    },
  });
  return client;
}

/** Test hook: forget the cached client so a new config can take effect. */
export function resetSupabaseForTests(): void {
  client = null;
  initAttempted = false;
}

/** True when Supabase env vars exist — used for honest UI messaging. */
export function isSupabaseConfigured(): boolean {
  return readEnv() !== null;
}
