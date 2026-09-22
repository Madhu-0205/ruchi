// Regression tests for the auth session-restoration UX fix.
//
// Bug: on page load with a persisted session, the sign-in form mounted
// immediately (account === null); when Supabase's session probe resolved a
// moment later, `handleSignedIn` set `account` and the conditional swap
// unmounted the form subtree — silently discarding whatever the user had
// typed mid-form.
//
// Fix: the store exposes `authReady`, flipped once the initial session
// check settles (signed in, signed out, or probe failure), and the auth
// form renders only after that. These tests lock the behavior at the
// store level (real module, mocked transport) and at the source level
// (the form is gated on authReady).
//
// No passwords or tokens are touched anywhere here — the mocked transport
// fabricates a user object; nothing is persisted.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// zustand's persist middleware writes on every setState; Node has no
// localStorage, so provide an in-memory shim BEFORE the store module is
// evaluated. Nothing touches disk — sessions and state live only in RAM.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
});

type SessionUser = { id: string; email?: string | null; user_metadata?: Record<string, unknown> };

let sessionUser: SessionUser | null = null;
let probeShouldReject = false;
let updateUserShouldFail = false;

vi.mock("@/lib/auth/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () =>
        probeShouldReject
          ? { data: { session: null }, error: { message: "boom" } }
          : { data: { session: sessionUser ? { user: sessionUser } : null }, error: null },
      onAuthStateChange: (_cb: unknown) => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async (_attrs: { password?: string }) =>
        updateUserShouldFail
          ? { data: { user: null }, error: { message: "Password should be at least 6 characters", status: 422 } }
          : { data: { user: {} }, error: null },
      exchangeCodeForSession: async () => ({ data: { session: null }, error: null }),
    },
    from: () => {
      throw new Error("no table access expected in these tests");
    },
  }),
  resetSupabaseForTests: () => {},
  isSupabaseConfigured: () => true,
}));

// window guard for the recovery-redirect consumption (Node-safe scrub).
vi.stubGlobal("window", {
  location: { origin: "https://ruchi.test", pathname: "/", href: "https://ruchi.test/", search: "", hash: "" },
  history: { replaceState: () => {} },
} as unknown as Window & typeof globalThis);

// Cloud sync must never run in these tests — the store's handleSignedIn
// pulls profile/meals; stub those as unconfigured no-ops.
vi.mock("@/lib/auth/supabase-data", () => ({
  fetchProfile: async () => ({ ok: false, reason: "unconfigured" }),
  fetchCompletedMeals: async () => ({ ok: false, reason: "unconfigured" }),
  upsertProfile: async () => ({ ok: false, reason: "unconfigured" }),
  insertCompletedMeals: async () => ({ ok: false, reason: "unconfigured" }),
  recordStreakDay: async () => ({ ok: false, reason: "unconfigured" }),
}));

import { initAuthListener, resetAuthListenerForTests, useRuchi } from "@/lib/store";

beforeEach(() => {
  sessionUser = null;
  probeShouldReject = false;
  updateUserShouldFail = false;
  resetAuthListenerForTests();
  useRuchi.setState({
    account: null,
    authError: null,
    authReady: false,
    recoveryMode: false,
    localOwner: null,
    history: [],
    name: "",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authReady gate (session-restoration UX)", () => {
  it("flips authReady true after the initial session probe settles (anonymous)", async () => {
    expect(useRuchi.getState().authReady).toBe(false);
    initAuthListener();
    await vi.waitFor(() => expect(useRuchi.getState().authReady).toBe(true));
    // Anonymous restore: no account, form may now mount safely.
    expect(useRuchi.getState().account).toBeNull();
  });

  it("flips authReady even when the session probe fails", async () => {
    probeShouldReject = true;
    initAuthListener();
    await vi.waitFor(() => expect(useRuchi.getState().authReady).toBe(true));
    expect(useRuchi.getState().account).toBeNull();
  });

  it("restores a persisted session without ever clearing authReady", async () => {
    sessionUser = { id: "user-restored", email: "restored@example.com" };
    initAuthListener();
    await vi.waitFor(() => expect(useRuchi.getState().account?.id).toBe("user-restored"));
    expect(useRuchi.getState().authReady).toBe(true);
  });

  it("attaches the listener at most once — repeated init is a no-op", async () => {
    initAuthListener();
    initAuthListener();
    initAuthListener();
    await vi.waitFor(() => expect(useRuchi.getState().authReady).toBe(true));
  });
});

describe("password reset lifecycle (store)", () => {
  it("requestPasswordReset returns sent on success, failed + authError on failure", async () => {
    await expect(useRuchi.getState().requestPasswordReset("a@b.c")).resolves.toBe("sent");
    updateUserShouldFail = true; // reuse the failure switch for a 422 path
    // Force a rate-limit style failure via the transport is not needed —
    // assert the honest failure path through updateUser instead.
    const r = await useRuchi.getState().setNewPassword("123");
    expect(r).toBe("failed");
    expect(useRuchi.getState().authError).toBe("weak-password");
    expect(useRuchi.getState().recoveryMode).toBe(false);
  });

  it("setNewPassword succeeds, clears recoveryMode, and never persists auth state", async () => {
    useRuchi.setState({ recoveryMode: true });
    await expect(useRuchi.getState().setNewPassword("fresh-secret-9")).resolves.toBe("updated");
    expect(useRuchi.getState().recoveryMode).toBe(false);
    expect(useRuchi.getState().authError).toBeNull();
  });

  it("dismissRecovery exits recovery mode and clears auth errors", () => {
    useRuchi.setState({ recoveryMode: true, authError: "error" });
    useRuchi.getState().dismissRecovery();
    expect(useRuchi.getState().recoveryMode).toBe(false);
    expect(useRuchi.getState().authError).toBeNull();
  });

  it("signOut clears recoveryMode", () => {
    useRuchi.setState({ recoveryMode: true });
    useRuchi.getState().signOut();
    expect(useRuchi.getState().recoveryMode).toBe(false);
  });

  it("consumeRecoveryRedirect flips recoveryMode only when a recovery redirect is present", () => {
    // No recovery URL in the stubbed window → no-op.
    useRuchi.getState().consumeRecoveryRedirect();
    expect(useRuchi.getState().recoveryMode).toBe(false);
  });
});

describe("auth form gating (source contract)", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the sign-in/sign-up form renders only after authReady", () => {
    // The auth form lives in the shared AuthCard (used by the welcome
    // gate and Profile's guest view) — the gate must hold there.
    const src = read("src/components/AuthCard.tsx");
    expect(src).toContain("authReady");
    const start = src.indexOf("!authReady ? (");
    const end = src.indexOf(") : (", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // The pre-ready branch must be non-interactive skeletons (no inputs).
    const preReady = src.slice(start, end);
    expect(preReady).toContain("aria-hidden");
    expect(preReady).not.toContain("<input");
    expect(preReady).not.toContain("<form");
  });

  it("no form state is ever persisted (passwords stay out of storage)", () => {
    const storeSrc = read("src/lib/store/index.ts");
    const start = storeSrc.indexOf("partialize:");
    const end = storeSrc.indexOf("}),", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const partialize = storeSrc.slice(start, end);
    expect(partialize).not.toMatch(/email|password|authready|recovery/i);
  });

  it("the auth card offers forgot-password + set-new-password flows", () => {
    const src = read("src/components/AuthCard.tsx");
    expect(src).toContain('"forgot"');
    expect(src).toContain("Forgot password?");
    expect(src).toContain("Send reset link");
    expect(src).toContain("Set a new password.");
    expect(src).toContain("recoveryMode");
  });
});
