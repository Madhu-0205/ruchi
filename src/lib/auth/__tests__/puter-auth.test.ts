import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The auth layer is deliberately thin over the Puter SDK — so these tests
// stub the SDK the same way the real browser session behaves: popup sign-in,
// a session flag, and a remote KV store.
const h = vi.hoisted(() => {
  const kvStore = new Map<string, string>();
  const state = {
    signedIn: false,
    user: null as unknown,
    signInImpl: undefined as unknown as () => Promise<unknown>,
  };
  return { kvStore, state };
});

vi.mock("@heyputer/puter.js", () => ({
  puter: {
    ai: { chat: vi.fn(), listModels: vi.fn(async () => []) },
    auth: {
      signIn: async () => {
        await h.state.signInImpl();
        h.state.signedIn = true;
        return h.state.user;
      },
      isSignedIn: () => h.state.signedIn,
      getUser: async () => h.state.user,
      signOut: () => {
        h.state.signedIn = false;
      },
    },
    kv: {
      set: async (k: string, v: string) => {
        h.kvStore.set(k, v);
        return true;
      },
      get: async (k: string) => h.kvStore.get(k) ?? null,
    },
  },
}));

import { resetPuterForTests } from "@/lib/ai/puter";
import {
  currentUser,
  isSignedIn,
  loadSnapshot,
  saveSnapshot,
  signIn,
  signOut,
} from "../puter-auth";

// The bridge refuses to load the browser SDK without a window (SSR guard).
// These tests run in the node env, so stand in a minimal window — the SDK
// itself is the mock above and never actually evaluates.
beforeAll(() => {
  vi.stubGlobal("window", {} as unknown as Window & typeof globalThis);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetPuterForTests();
  h.kvStore.clear();
  h.state.signedIn = false;
  h.state.user = null;
  h.state.signInImpl = async () => {};
});

describe("signIn", () => {
  it("resolves with the user when the popup flow succeeds", async () => {
    h.state.user = { username: "ana", is_temp: false };
    const outcome = await signIn();
    expect(outcome).toEqual({
      status: "signed-in",
      user: { username: "ana", isTemp: false },
    });
    expect(isSignedIn()).toBe(true);
  });

  it("maps a dismissed popup to unavailable, never throws", async () => {
    h.state.signInImpl = async () => {
      throw new Error("popup closed");
    };
    const outcome = await signIn();
    expect(outcome).toEqual({ status: "unavailable" });
  });

  it("maps a missing SDK to unavailable", async () => {
    // user stays null (getUser resolves null) → unavailable
    h.state.user = null;
    const outcome = await signIn();
    expect(outcome).toEqual({ status: "unavailable" });
  });
});

describe("session", () => {
  it("signOut clears the session", async () => {
    h.state.user = { username: "ana" };
    await signIn();
    expect(isSignedIn()).toBe(true);
    signOut();
    expect(isSignedIn()).toBe(false);
    expect(await currentUser()).toBeNull();
  });

  it("currentUser reports temp accounts", async () => {
    h.state.user = { username: "guest-123", is_temp: true };
    h.state.signedIn = true;
    const u = await currentUser();
    expect(u).toEqual({ username: "guest-123", isTemp: true });
  });
});

describe("cloud snapshot", () => {
  it("roundtrips a snapshot through KV", async () => {
    await saveSnapshot({ name: "Ana", history: [{ id: "m1" }] });
    const res = await loadSnapshot();
    expect(res).toEqual({
      status: "loaded",
      snapshot: { name: "Ana", history: [{ id: "m1" }] },
    });
  });

  it("empty KV → none (local state untouched)", async () => {
    expect(await loadSnapshot()).toEqual({ status: "none" });
  });

  it("corrupt snapshot → none instead of crashing", async () => {
    h.kvStore.set("ruchi.snapshot.v1", "{not json");
    expect(await loadSnapshot()).toEqual({ status: "none" });
  });
});
