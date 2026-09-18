// ─────────────────────────────────────────────────────────────
// RUCHI — Supabase auth service tests (mocked supabase-js client)
// ─────────────────────────────────────────────────────────────
// The mock mirrors the real client surface the service uses: signUp,
// signInWithPassword, signOut, getSession, onAuthStateChange. Failure
// shapes match supabase-js's AuthError ({ message, status }).

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    session: null as unknown,
    signUpImpl: undefined as unknown as (email: string, password: string) => Promise<unknown>,
    signInImpl: undefined as unknown as (email: string, password: string) => Promise<unknown>,
    authHandlers: [] as ((event: string, session: unknown) => void)[],
  };
  const client = {
    auth: {
      signUp: (email: string, password: string) => h.state.signUpImpl(email, password),
      signInWithPassword: (email: string, password: string) => h.state.signInImpl(email, password),
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: h.state.session }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.state.authHandlers.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
  return { state, client };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => h.client),
}));

import { resetSupabaseForTests } from "../supabase";
import {
  authAvailable,
  authErrorMessage,
  currentUser,
  onAuthChange,
  signIn,
  signOut,
  signUp,
} from "../supabase-auth";

const user = (id: string, email: string) => ({ id, email, user_metadata: {} });

beforeAll(() => {
  // The client module is browser-gated (window check); stand in a window.
  vi.stubGlobal("window", {} as unknown as Window & typeof globalThis);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  resetSupabaseForTests(); // fresh client per test (env read is cached)
  h.state.session = null;
  h.state.authHandlers = [];
  h.state.signUpImpl = async () => ({});
  h.state.signInImpl = async () => ({});
});

describe("configuration", () => {
  it("reports unconfigured without env vars", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    resetSupabaseForTests();
    expect(authAvailable()).toBe(false);
    const outcome = await signIn("a@b.c", "pw");
    expect(outcome).toEqual({ status: "failed", reason: "unconfigured" });
    expect(await currentUser()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  });
});

describe("signUp", () => {
  it("returns the user when a session comes back", async () => {
    h.state.signUpImpl = async () => ({
      data: { user: user("u1", "a@b.c"), session: { user: user("u1", "a@b.c") } },
    });
    const outcome = await signUp("a@b.c", "secret123");
    expect(outcome).toEqual({
      status: "signed-in",
      user: { id: "u1", email: "a@b.c", displayName: "a" },
    });
  });

  it("reports needs-email-confirmation when no session is returned", async () => {
    h.state.signUpImpl = async () => ({ data: { user: user("u1", "a@b.c"), session: null } });
    const outcome = await signUp("a@b.c", "secret123");
    expect(outcome).toEqual({ status: "needs-email-confirmation", email: "a@b.c" });
  });

  it("maps duplicate email to email-taken", async () => {
    h.state.signUpImpl = async () => {
      throw { message: "User already registered", status: 422 };
    };
    const outcome = await signUp("a@b.c", "secret123");
    expect(outcome).toEqual({ status: "failed", reason: "email-taken" });
    expect(authErrorMessage("email-taken")).toContain("already exists");
  });

  it("maps weak password", async () => {
    h.state.signUpImpl = async () => {
      throw { message: "Password should be at least 6 characters", status: 400 };
    };
    expect(await signUp("a@b.c", "123")).toEqual({ status: "failed", reason: "weak-password" });
  });
});

describe("signIn", () => {
  it("returns the user on success", async () => {
    h.state.signInImpl = async () => ({ data: { user: user("u1", "a@b.c") }, error: null });
    const outcome = await signIn("a@b.c", "secret123");
    expect(outcome.status).toBe("signed-in");
  });

  it("maps invalid credentials", async () => {
    h.state.signInImpl = async () => {
      throw { message: "Invalid login credentials", status: 400 };
    };
    const outcome = await signIn("a@b.c", "wrong");
    expect(outcome).toEqual({ status: "failed", reason: "invalid-credentials" });
  });

  it("maps rate limiting", async () => {
    h.state.signInImpl = async () => {
      throw { message: "Too many requests", status: 429 };
    };
    expect(await signIn("a@b.c", "pw")).toEqual({ status: "failed", reason: "rate-limited" });
  });

  it("maps network failures", async () => {
    h.state.signInImpl = async () => {
      throw { message: "Failed to fetch", status: 0 };
    };
    expect(await signIn("a@b.c", "pw")).toEqual({ status: "failed", reason: "network" });
  });
});

describe("session + listener", () => {
  it("restores the session via currentUser", async () => {
    h.state.session = { user: user("u1", "a@b.c") };
    expect(await currentUser()).toEqual({
      id: "u1",
      email: "a@b.c",
      displayName: "a",
    });
  });

  it("returns null when anonymous", async () => {
    expect(await currentUser()).toBeNull();
  });

  it("onAuthChange forwards user/null and unsubscribes", async () => {
    const seen: (unknown)[] = [];
    const sub = onAuthChange((u) => seen.push(u));
    expect(sub).not.toBeNull();
    h.state.authHandlers[0]!("SIGNED_IN", { user: user("u1", "a@b.c") });
    h.state.authHandlers[0]!("SIGNED_OUT", null);
    expect(seen).toHaveLength(2);
    expect((seen[0] as { id: string }).id).toBe("u1");
    expect(seen[1]).toBeNull();
    sub!.unsubscribe();
  });

  it("signOut never throws", async () => {
    h.state.session = { user: user("u1", "a@b.c") };
    await expect(signOut()).resolves.toBeUndefined();
  });
});
