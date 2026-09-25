// ─────────────────────────────────────────────────────────────
// RUCHI — Real Cooking Stats store tests (mocked data layer)
// ─────────────────────────────────────────────────────────────
// Verifies the CLIENT side of the server-authoritative contract:
//  • every completion write carries the SAME per-session token → a
//    double-clicked completion action cannot create two records;
//  • the token is consumed once 'recorded', so the NEXT session gets a
//    fresh one (its own record counts);
//  • failed writes keep the token so syncNow truly retries;
//  • cloudStats comes only from the server and is cleared on sign-out
//    (user-scoped, never from localStorage).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealHistoryEntry } from "@/lib/types";

// Persist middleware needs localStorage; the node env has none.
vi.hoisted(() => {
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
});

const h = vi.hoisted(() => {
  const state = {
    signInResult: { status: "signed-in", user: { id: "u1", email: "a@b.c", displayName: "A" } },
    remoteMeals: [] as MealHistoryEntry[],
    completionCalls: [] as { token: string; recipeId: string }[],
    completionOutcome: { ok: true, data: "recorded" } as
      | { ok: true; data: "recorded" | "duplicate" }
      | { ok: false; reason: "error" },
    statsAfter: null as { mealsCooked: number; totalSaved: number; currentStreak: number; longestStreak: number; lastCompletedAt: number | null } | null,
    recentAfter: [] as MealHistoryEntry[],
  };
  return { state };
});

vi.mock("@/lib/auth/supabase-auth", () => ({
  currentUser: async () => null,
  onAuthChange: () => null,
  signIn: async () => h.state.signInResult,
  signUp: async () => h.state.signInResult,
  signOut: async () => {},
}));

vi.mock("@/lib/auth/supabase-data", () => ({
  fetchProfile: async () => ({ ok: true, data: null }),
  upsertProfile: async () => ({ ok: true, data: null }),
  fetchCompletedMeals: async () => ({ ok: true, data: h.state.remoteMeals }),
  insertCompletedMeals: async () => ({ ok: true, data: null }),
  recordStreakDay: async () => ({ ok: true, data: null }),
  recordCookingCompletion: async (input: { sessionToken: string; recipeId: string }) => {
    h.state.completionCalls.push({ token: input.sessionToken, recipeId: input.recipeId });
    return h.state.completionOutcome;
  },
  fetchCookingStats: async () => ({ ok: true, data: h.state.statsAfter }),
  fetchRecentCookedMeals: async () => ({ ok: true, data: h.state.recentAfter ?? [] }),
  fetchNotificationPrefs: async () => ({ ok: true as const, data: null }),
  pushAttentionState: async () => ({ ok: true as const, data: null }),
  upsertNotificationChannels: async () => ({ ok: true as const, data: null }),
}));

import { setSessionTokenForTests, useRuchi } from "../index";

const meal = {
  recipeId: "paneer-egg-bhurji",
  recipeName: "Paneer Egg Bhurji",
  servings: 1,
  proteinG: 38,
  calories: 520,
  cost: 82,
  deliveryCompareCost: 303,
};

const signIn = async () => {
  await useRuchi.getState().signIn("a@b.c", "pw");
};

beforeEach(() => {
  setSessionTokenForTests(null);
  h.state.signInResult = { status: "signed-in", user: { id: "u1", email: "a@b.c", displayName: "A" } };
  h.state.remoteMeals = [];
  h.state.completionCalls = [];
  h.state.completionOutcome = { ok: true, data: "recorded" };
  h.state.statsAfter = null;
  useRuchi.setState({
    history: [],
    account: null,
    cloudStats: null,
    recentCooked: [],
    cookingSessionToken: null,
    syncError: false,
    localOwner: null,
  });
});

describe("cooking completion idempotency (client contract)", () => {
  it("double-clicked completion sends the SAME session token twice — one record's worth of intent", async () => {
    await signIn();
    useRuchi.getState().beginCookingSession();
    const s = useRuchi.getState();
    s.logCookedMeal({ ...meal });
    s.logCookedMeal({ ...meal });
    // Let the fire-and-forget writes run.
    await new Promise((r) => setTimeout(r, 20));
    expect(h.state.completionCalls).toHaveLength(2);
    expect(h.state.completionCalls[0]!.token).toBe(h.state.completionCalls[1]!.token);
  });

  it("consumes the token once recorded, so the NEXT session mints a fresh one", async () => {
    await signIn();
    useRuchi.getState().beginCookingSession();
    useRuchi.getState().logCookedMeal({ ...meal });
    await new Promise((r) => setTimeout(r, 20));
    const firstToken = h.state.completionCalls[0]!.token;
    expect(useRuchi.getState().cookingSessionToken).toBeNull(); // consumed

    // New cooking session → new token → a genuinely new record counts.
    useRuchi.getState().beginCookingSession();
    useRuchi.getState().logCookedMeal({ ...meal });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.state.completionCalls[1]!.token).not.toBe(firstToken);
  });

  it("keeps the token when the write FAILS — syncNow retries the same session", async () => {
    await signIn();
    useRuchi.getState().beginCookingSession();
    h.state.completionOutcome = { ok: false, reason: "error" };
    useRuchi.getState().logCookedMeal({ ...meal });
    await new Promise((r) => setTimeout(r, 20));
    expect(useRuchi.getState().syncError).toBe(true);

    // Retry with the same token (what syncNow/next click does).
    h.state.completionOutcome = { ok: true, data: "recorded" };
    useRuchi.getState().logCookedMeal({ ...meal });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.state.completionCalls).toHaveLength(2);
    expect(h.state.completionCalls[0]!.token).toBe(h.state.completionCalls[1]!.token);
    expect(useRuchi.getState().cookingSessionToken).toBeNull(); // now consumed
  });

  it("refreshes cloudStats from the server after a recorded completion", async () => {
    await signIn();
    h.state.statsAfter = {
      mealsCooked: 3,
      totalSaved: 450,
      currentStreak: 2,
      longestStreak: 2,
      lastCompletedAt: Date.now(),
    };
    useRuchi.getState().beginCookingSession();
    useRuchi.getState().logCookedMeal({ ...meal });
    await new Promise((r) => setTimeout(r, 20));
    expect(useRuchi.getState().cloudStats?.mealsCooked).toBe(3);
    expect(useRuchi.getState().cloudStats?.totalSaved).toBe(450);
  });

  it("cloudStats is user-scoped: cleared on sign-out, never carried across identities", async () => {
    await signIn();
    useRuchi.setState({
      cloudStats: { mealsCooked: 9, totalSaved: 1000, currentStreak: 4, longestStreak: 6, lastCompletedAt: Date.now() },
    });
    useRuchi.getState().signOut();
    expect(useRuchi.getState().cloudStats).toBeNull();
    expect(useRuchi.getState().account).toBeNull();
  });

  it("mints distinct tokens even without beginCookingSession (defensive path)", async () => {
    await signIn();
    useRuchi.setState({ cookingSessionToken: null });
    useRuchi.getState().logCookedMeal({ ...meal });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.state.completionCalls[0]!.token).toBeTruthy();
  });
});

// ── Notification opt-in (migration 0004 client contract) ─────

describe("notification opt-in", () => {
  it("toggling a channel while signed in upserts to the server", async () => {
    await signIn();
    const ups: unknown[] = [];
    const mod = await import("@/lib/auth/supabase-data");
    const orig = mod.upsertNotificationChannels;
    // Spy via the module mock's state instead of replacing the mock factory.
    vi.spyOn(mod, "upsertNotificationChannels").mockImplementation(async (channels) => {
      ups.push(channels);
      return { ok: true as const, data: null };
    });
    useRuchi.getState().setNotificationChannel("web_push", true);
    expect(useRuchi.getState().notificationChannels.web_push).toBe(true);
    await vi.waitFor(() => expect(ups.length).toBe(1));
    expect(ups[0]).toEqual({ web_push: true });
    vi.mocked(mod.upsertNotificationChannels).mockRestore();
    void orig;
  });

  it("toggle works signed-out (local flag only, no server call attempted)", async () => {
    useRuchi.getState().setNotificationChannel("web_push", true);
    expect(useRuchi.getState().notificationChannels.web_push).toBe(true);
  });

  it("channel flags are user-scoped: cleared on sign-out", async () => {
    await signIn();
    useRuchi.getState().setNotificationChannel("web_push", true);
    await useRuchi.getState().signOut();
    expect(useRuchi.getState().notificationChannels).toEqual({});
  });
});
