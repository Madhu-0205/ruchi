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
    resetImpl: undefined as unknown as (email: string) => Promise<unknown>,
    updateUserImpl: undefined as unknown as (attrs: { password?: string }) => Promise<unknown>,
    exchangeImpl: undefined as unknown as (code: string) => Promise<unknown>,
    lastResetRedirect: undefined as unknown as string | undefined,
    lastUpdatedPassword: undefined as unknown as string | undefined,
    authHandlers: [] as ((event: string, session: unknown) => void)[],
  };
  const client = {
    auth: {
      signUp: (email: string, password: string) => h.state.signUpImpl(email, password),
      signInWithPassword: (email: string, password: string) => h.state.signInImpl(email, password),
      resetPasswordForEmail: (email: string, opts: { redirectTo?: string }) => {
        h.state.lastResetRedirect = opts?.redirectTo;
        return h.state.resetImpl(email);
      },
      updateUser: (attrs: { password?: string }) => {
        h.state.lastUpdatedPassword = attrs.password;
        return h.state.updateUserImpl(attrs);
      },
      exchangeCodeForSession: (code: string) => h.state.exchangeImpl(code),
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
  completePasswordReset,
  consumeRecoveryRedirect,
  currentUser,
  onAuthChange,
  passwordResetRedirectUrl,
  requestPasswordReset,
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

describe("password reset", () => {
  it("requestPasswordReset: sent with redirect on success", async () => {
    const outcome = await requestPasswordReset("a@b.c");
    expect(outcome).toEqual({ status: "sent", email: "a@b.c" });
    expect(h.state.lastResetRedirect).toBe("https://ruchi.test/");
  });

  it("requestPasswordReset honors NEXT_PUBLIC_PASSWORD_RESET_REDIRECT", () => {
    vi.stubEnv("NEXT_PUBLIC_PASSWORD_RESET_REDIRECT", "https://beta.ruchi.app/");
    expect(passwordResetRedirectUrl()).toBe("https://beta.ruchi.app/");
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  });

  it("requestPasswordReset maps failure + never leaks email enumeration", async () => {
    h.state.resetImpl = async () => {
      throw { message: "Too many requests", status: 429 };
    };
    const outcome = await requestPasswordReset("a@b.c");
    expect(outcome).toEqual({ status: "failed", reason: "rate-limited" });
    expect(authErrorMessage("rate-limited")).not.toContain("a@b.c");
  });

  it("requestPasswordReset degrades honestly when unconfigured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    resetSupabaseForTests();
    expect(await requestPasswordReset("a@b.c")).toEqual({
      status: "failed",
      reason: "unconfigured",
    });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    resetSupabaseForTests();
  });

  it("completePasswordReset: updated on success", async () => {
    const outcome = await completePasswordReset("new-secret-9");
    expect(outcome).toEqual({ status: "updated" });
    expect(h.state.lastUpdatedPassword).toBe("new-secret-9");
  });

  it("completePasswordReset maps weak + reuse errors", async () => {
    h.state.updateUserImpl = async () => {
      throw { message: "Password should be at least 6 characters", status: 422 };
    };
    expect(await completePasswordReset("123")).toEqual({
      status: "failed",
      reason: "weak-password",
    });
    h.state.updateUserImpl = async () => {
      throw { message: "New password should be different from the old password.", status: 422 };
    };
    expect(await completePasswordReset("old-one")).toEqual({
      status: "failed",
      reason: "password-reuse",
    });
    expect(authErrorMessage("password-reuse")).toBe("Pick a password you haven't used before.");
  });

  it("completePasswordReset maps network failures", async () => {
    h.state.updateUserImpl = async () => {
      throw { message: "Failed to fetch", status: 0 };
    };
    expect(await completePasswordReset("x".repeat(10))).toEqual({
      status: "failed",
      reason: "network",
    });
  });

  it("consumeRecoveryRedirect: PKCE style (?code=) is detected and scrubbed", async () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: {
        origin: "https://ruchi.test",
        pathname: "/",
        href: "https://ruchi.test/?code=abc&type=recovery",
        search: "?code=abc&type=recovery",
        hash: "",
      },
      history: { replaceState },
    } as unknown as Window & typeof globalThis);
    const { recovery } = consumeRecoveryRedirect();
    expect(recovery).toBe(true);
    // Scrub happens after the code exchange settles (success OR failure).
    await vi.waitFor(() => expect(replaceState).toHaveBeenCalled());
  });

  it("consumeRecoveryRedirect: implicit style (#access_token + type=recovery) is detected and scrubbed", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://ruchi.test",
        pathname: "/",
        href: "https://ruchi.test/#access_token=xyz&type=recovery",
        search: "",
        hash: "#access_token=xyz&type=recovery",
      },
      history: { replaceState: vi.fn() },
    } as unknown as Window & typeof globalThis);
    const { recovery } = consumeRecoveryRedirect();
    expect(recovery).toBe(true);
    // Scrubbed to the bare path immediately — no token lingers in the URL.
    expect(
      (window.history as unknown as { replaceState: ReturnType<typeof vi.fn> }).replaceState,
    ).toHaveBeenCalledWith(null, "", "/");
  });

  it("consumeRecoveryRedirect: normal URLs are untouched", () => {
    const { recovery, email } = consumeRecoveryRedirect();
    expect(recovery).toBe(false);
    expect(email).toBeNull();
    expect((window.history as unknown as { replaceState: ReturnType<typeof vi.fn> }).replaceState).not.toHaveBeenCalled();
  });

  it("completePasswordReset degrades honestly when unconfigured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    resetSupabaseForTests();
    expect(await completePasswordReset("whatever1")).toEqual({
      status: "failed",
      reason: "unconfigured",
    });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    resetSupabaseForTests();
  });
});

beforeEach(() => {
  resetSupabaseForTests(); // fresh client per test (env read is cached)
  h.state.session = null;
  h.state.authHandlers = [];
  h.state.signUpImpl = async () => ({});
  h.state.signInImpl = async () => ({});
  h.state.resetImpl = async () => ({ data: {}, error: null });
  h.state.updateUserImpl = async () => ({ data: { user: {} }, error: null });
  h.state.exchangeImpl = async () => ({ data: { session: h.state.session }, error: null });
  h.state.lastResetRedirect = undefined;
  h.state.lastUpdatedPassword = undefined;
  // The service reads window.location / window.history (not bare globals).
  vi.stubGlobal("window", {
    location: {
      origin: "https://ruchi.test",
      pathname: "/",
      href: "https://ruchi.test/",
      search: "",
      hash: "",
    },
    history: { replaceState: vi.fn() },
  } as unknown as Window & typeof globalThis);
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
