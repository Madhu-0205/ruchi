// ─────────────────────────────────────────────────────────────
// RUCHI — Puter.js bridge (the ONLY module that imports the SDK)
// ─────────────────────────────────────────────────────────────
// Puter is the AI gateway between RUCHI and every provider. No OpenAI /
// Anthropic / Google keys exist in this codebase; auth is handled by
// Puter's browser flow (popup sign-in on first AI use) — the app never
// holds credentials.

// Client-only: the browser SDK must never be evaluated on the server.
"use client";

import type { ChatMessage, ChatOptions, ChatResponse } from "@heyputer/puter.js";
import { AI_PROVIDER, TEXT_TIMEOUT_MS, VISION_TIMEOUT_MS } from "./config";
import { authStateSnapshot, logAiEvent } from "./observability";

type PuterAi = {
  chat: (
    messages: ChatMessage[],
    options?: ChatOptions,
  ) => Promise<ChatResponse | AsyncIterable<unknown>>;
  listModels: () => Promise<
    { id: string; aliases?: string[]; modalities?: { input?: string[] } }[]
  >;
};

type PuterAuth = {
  signIn: (options?: {
    attempt_temp_user_creation?: boolean;
    request_auth?: boolean;
  }) => Promise<unknown>;
  isSignedIn: () => boolean;
  getUser: () => Promise<PuterUser | null>;
  signOut: () => void;
};

/** The bits of the Puter user we actually use. */
export interface PuterUser {
  username: string;
  uuid?: string;
  email?: string;
  is_temp?: boolean;
}

type PuterKv = {
  set: (key: string, value: string) => Promise<boolean>;
  get: (key: string) => Promise<string | null | undefined>;
};

type PuterClient = { ai: PuterAi; auth: PuterAuth; kv?: PuterKv };

let cached: PuterClient | null = null;
let loadPromise: Promise<PuterClient | null> | null = null;

// ── Auth-failure latch ──────────────────────────────────────
// In environments where Puter's sign-in popup can't complete (embedded
// webviews, blocked popups), every AI call would re-open the consent
// dialog and burn its full timeout. After repeated timeout-aborts while
// the session is unsigned, go quiet for a while: callers fall back to the
// deterministic paths instantly. Any success resets the streak, so healthy
// environments are never latched.
let unsignedTimeoutStreak = 0;
let latchUntil = 0;
const LATCH_AFTER = 2;
const LATCH_COOLDOWN_MS = 10 * 60_000;

/**
 * Lazily import the browser SDK. Returns null on SSR, when the package is
 * absent, or when the provider is disabled — callers treat null as
 * "AI unavailable" and use the deterministic fallbacks.
 */
export async function loadPuter(): Promise<PuterClient | null> {
  if (typeof window === "undefined") return null;
  if (AI_PROVIDER === "none") return null;
  if (cached) return cached;
  if (!loadPromise) {
    loadPromise = import("@heyputer/puter.js")
      .then((mod) => {
        const client = ((mod as { puter?: unknown }).puter ??
          (mod as { default?: unknown }).default) as PuterClient | undefined;
        if (!client?.ai) throw new Error("puter.js loaded without ai module");
        cached = client;
        logAiEvent("sdk_loaded", { provider: "puter" });
        return client;
      })
      .catch((err) => {
        logAiEvent("fallback_triggered", {
          stage: "sdk-load-failed",
          error: messageOf(err),
        });
        return null;
      });
  }
  return loadPromise;
}

/** Clear the cached client (used by tests and provider resets). */
export function resetPuterForTests(): void {
  cached = null;
  loadPromise = null;
  unsignedTimeoutStreak = 0;
  latchUntil = 0;
}

export function isPuterLikelyAvailable(): boolean {
  return AI_PROVIDER !== "none";
}

/**
 * Single chat entry point with timeout + normalization.
 * Resolves to the message text, or null on any failure (auth popup
 * dismissed, model error, network, timeout). Never throws.
 */
export async function puterChat(
  messages: ChatMessage[],
  opts: { model: string; timeoutMs: number; signal?: AbortSignal },
): Promise<string | null> {
  const puter = await loadPuter();
  if (!puter) return null;

  // Latched: auth cannot complete in this environment — don't re-prompt.
  if (Date.now() < latchUntil) return null;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    // Race the SDK call against the abort signal. The SDK's promise may
    // never settle (e.g. its auth popup can't complete in an embedded
    // webview), so the timeout must be able to win the race.
    const chatPromise = (
      puter.ai.chat(messages, {
        model: opts.model,
        normalize: true, // message.content is a string across all vendors
      } satisfies ChatOptions) as Promise<ChatResponse>
    ).catch((err) => {
      if (!controller.signal.aborted) {
        logAiEvent("chat_failure", { reason: "chat-error", error: messageOf(err) });
      }
      return null;
    });
    const abortPromise = new Promise<null>((resolve) => {
      if (controller.signal.aborted) resolve(null);
      else
        controller.signal.addEventListener("abort", () => resolve(null), {
          once: true,
        });
    });

    const res = await Promise.race([chatPromise, abortPromise]);

    if (!res || controller.signal.aborted) return null;
    const content = res?.message?.content;
    if (typeof content === "string") {
      unsignedTimeoutStreak = 0; // success — healthy environment
      return content;
    }
    if (Array.isArray(content)) {
      // vendor-native shapes: join text blocks
      const text = content
        .map((c) =>
          typeof c === "string"
            ? c
            : ((c as { text?: string }).text ?? ""),
        )
        .join("");
      return text || null;
    }
    return null;
  } catch (err) {
    if (!controller.signal.aborted) {
      logAiEvent("chat_failure", { reason: "chat-error", error: messageOf(err) });
    }
    return null;
  } finally {
    // Timeout-abort with an unsigned session = the sign-in flow could not
    // complete. Two in a row → latch the AI layer for a cooldown window.
    if (timedOut && !opts.signal?.aborted && !puter.auth?.isSignedIn?.()) {
      unsignedTimeoutStreak++;
      if (unsignedTimeoutStreak >= LATCH_AFTER) {
        latchUntil = Date.now() + LATCH_COOLDOWN_MS;
        logAiEvent("fallback_triggered", {
          stage: "auth-latch",
          cooldownMs: LATCH_COOLDOWN_MS,
        });
      }
    }
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

// ── Auth + cloud KV (used by lib/auth) ──────────────────────
// Typed narrowly on purpose: auth is a capability of the provider layer,
// not a product dependency. The app talks to lib/auth's interface only.
//
// Known SDK behavior (verified against @heyputer/puter.js 2.x source):
// - `auth.signIn()` opens a popup to puter.com; if the browser blocks the
//   popup it rejects with `{ error: "popup_blocked" }` — otherwise the
//   promise stays pending until the popup postMessages a token back, or is
//   closed (`auth_window_closed`). It does NOT reject on its own timeout.
// - The sign-in page renders entirely from puter.com's own GUI bundle; a
//   blank popup means puter.com failed to render (stale session / CDN /
//   extension), NOT an app-side problem.

const AUTH_TIMEOUT_MS = 100_000; // popup sign-in is human-paced; no artificial rush

/** Classification of the last failed sign-in — drives honest UI copy. */
export type AuthFailureKind = "blocked" | "cancelled" | "stalled" | "error";
let lastAuthFailure: AuthFailureKind | null = null;

/** Why the most recent sign-in attempt failed (null = none/success). Dev diagnostics. */
export function lastAuthFailureKind(): AuthFailureKind | null {
  return lastAuthFailure;
}

export async function puterSignIn(opts?: {
  attempt_temp_user_creation?: boolean;
  request_auth?: boolean;
}): Promise<PuterUser | null> {
  lastAuthFailure = null;
  const puter = await loadPuter();
  if (!puter?.auth) {
    logAiEvent("auth_failure", { reason: "no-sdk" });
    lastAuthFailure = "error";
    return null;
  }
  const startedAt = Date.now();
  logAiEvent("auth_start", { ...authStateSnapshot() });
  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("auth-timeout")),
      AUTH_TIMEOUT_MS,
    );
    const timeoutPromise = new Promise<null>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(null), { once: true });
    });
    const signedInBefore = Boolean(puter.auth?.isSignedIn?.());
    const outcome = await Promise.race([
      puter.auth
        .signIn(opts)
        .then(() => "resolved" as const)
        .catch((err: unknown) => ({ error: messageOf(err) })),
      timeoutPromise,
    ]);
    clearTimeout(timer);

    if (outcome === null) {
      // Popup flow timed out without settling (no token, no close event).
      lastAuthFailure = "stalled";
      logAiEvent("auth_timeout", {
        ms: Date.now() - startedAt,
        signedInBefore,
        ...authStateSnapshot(),
      });
      return null; // honest failure — no session was established
    }

    if (typeof outcome === "object" && "error" in outcome) {
      const rejected = outcome.error;
      let kind: AuthFailureKind = "error";
      if (rejected.includes("popup_blocked")) kind = "blocked";
      else if (rejected.includes("auth_window_closed") || rejected.includes("cancel"))
        kind = "cancelled";
      lastAuthFailure = kind;
      const isCancel = kind === "cancelled";
      logAiEvent(isCancel ? "auth_cancel" : "auth_failure", {
        error: rejected,
        ms: Date.now() - startedAt,
      });
      return null;
    }

    // Promise resolved: the SDK postMessage handshake completed.
    const user = await puter.auth.getUser();
    if (user?.username) {
      // The user just completed an interactive sign-in — any auth latch
      // from earlier failed attempts no longer applies.
      latchUntil = 0;
      unsignedTimeoutStreak = 0;
      logAiEvent("auth_success", {
        username: user.username,
        isTemp: Boolean(user.is_temp),
        ms: Date.now() - startedAt,
      });
      return user;
    }
    logAiEvent("auth_failure", { reason: "resolved-without-user" });
    lastAuthFailure = "stalled";
    return null;
  } catch (err) {
    logAiEvent("auth_failure", { reason: "exception", error: messageOf(err) });
    lastAuthFailure = "error";
    return null;
  }
}

/**
 * Late-session heal: a popup sign-in may complete AFTER our await gave up
 * (slow human, slow puter.com render). The SDK's token listener runs
 * regardless; give the SDK a short window to settle, and treat an
 * established session as success for the latch/state.
 */
export async function puterAuthStateProbe(): Promise<PuterUser | null> {
  const puter = await loadPuter();
  if (!puter?.auth) return null;
  const signedIn = Boolean(puter.auth?.isSignedIn?.());
  if (!signedIn) return null;
  const user = await puterGetUser();
  if (user?.username) {
    latchUntil = 0;
    unsignedTimeoutStreak = 0;
    logAiEvent("auth_success", { stage: "late-session", username: user.username });
  }
  return user;
}

export function puterIsSignedIn(): boolean {
  return Boolean(cached?.auth?.isSignedIn?.());
}

export async function puterGetUser(): Promise<PuterUser | null> {
  const puter = await loadPuter();
  if (!puter?.auth) return null;
  try {
    // Read-only check: when there is no session, return null rather than
    // letting the SDK open its interactive sign-in prompt.
    if (!puter.auth.isSignedIn?.()) return null;
    return await puter.auth.getUser();
  } catch {
    return null;
  }
}

export function puterSignOut(): void {
  try {
    cached?.auth?.signOut?.();
  } catch {
    // signing out must never throw into the UI
  }
}

/** Store a string in the user's Puter cloud KV. Returns success. */
export async function puterKvSet(key: string, value: string): Promise<boolean> {
  const puter = await loadPuter();
  if (!puter?.kv) return false;
  try {
    return await puter.kv.set(key, value);
  } catch {
    return false;
  }
}

/** Read a string from the user's Puter cloud KV. Null when missing/unavailable. */
export async function puterKvGet(key: string): Promise<string | null> {
  const puter = await loadPuter();
  if (!puter?.kv) return null;
  try {
    return (await puter.kv.get(key)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Check that a model exists and accepts images, using Puter's model
 * catalog. Unknown catalog (offline/failed listing) → permissive: the
 * request itself is the test.
 */
export async function modelSupportsVision(model: string): Promise<boolean> {
  const puter = await loadPuter();
  if (!puter) return false;
  try {
    const models = await puter.ai.listModels();
    const entry = models.find((m) => m.id === model || m.aliases?.includes?.(model));
    if (!entry) return true; // catalog blind spot — let the request decide
    const input = entry.modalities?.input ?? [];
    return input.length === 0 || input.includes("image");
  } catch {
    return true;
  }
}

export function messageOf(err: unknown): string {
  if (typeof err === "string") return err.slice(0, 140);
  if (err instanceof Error) return err.message;
  // The SDK rejects with plain objects like { error: "popup_blocked", msg }
  // — String() would render those as "[object Object]" and lose the code.
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    for (const key of ["error", "code", "message", "msg", "detail"]) {
      const v = o[key];
      if (typeof v === "string" && v) return v.slice(0, 140);
    }
    try {
      return JSON.stringify(err).slice(0, 140);
    } catch {
      return "unknown-error-object";
    }
  }
  return String(err).slice(0, 140);
}

export const TIMEOUTS = { vision: VISION_TIMEOUT_MS, text: TEXT_TIMEOUT_MS };
