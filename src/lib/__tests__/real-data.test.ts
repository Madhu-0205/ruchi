// ─────────────────────────────────────────────────────────────
// RUCHI — Real-data regression suite
// ─────────────────────────────────────────────────────────────
// Encodes the product's non-negotiable: a number renders ONLY when a
// real record supports it. Each rule exists because the UI could once
// show it wrong (₹0 saved, 0-day streaks, invented ordinals):
//  • a fresh user has NO statistics anywhere — the empty state is the
//    luxury state (Home strips/Profile cards are guarded by
//    mealsCooked > 0, streak >= 1, saved > 0);
//  • savings render only when the comparison is defensible, and are
//    always labeled "estimated";
//  • meal ordinals come from real completion counts — first meal is
//    #1, never fabricated;
//  • duplicate completions cannot inflate anything (session-token
//    contract, server-authoritative stats);
//  • Recently cooked flows ONLY from real completions;
//  • the Context Engine stays quiet when history can't support a claim.
// UI rendering guards are asserted through these pure contracts:
// the screens render `streak >= 1`, `saved > 0`, `recentCooked.length > 0`
// — a zero here must mean silence, never a printed 0.

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
  fetchCompletedMeals: async () => ({ ok: true, data: [] }),
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

import { setSessionTokenForTests, useRuchi, weeklyProgress, streak } from "../store/index";
import {
  defensibleSavings,
  completionStreakLine,
  mealNumberLine,
  homeHeadline,
  keptInPocket,
} from "@/lib/personality";
import { evaluateAttention } from "@/lib/context/attention";

const DAY = 86_400_000;
const NOW = new Date("2026-09-30T19:30:00").getTime();

const meal = {
  recipeId: "paneer-egg-bhurji",
  recipeName: "Paneer Egg Bhurji",
  servings: 1,
  proteinG: 38,
  calories: 520,
  cost: 82,
  deliveryCompareCost: 303,
};
const flush = () => new Promise((r) => setTimeout(r, 20));
const signIn = async () => {
  await useRuchi.getState().signIn("a@b.c", "pw");
};

beforeEach(() => {
  setSessionTokenForTests(null);
  h.state.completionCalls = [];
  h.state.completionOutcome = { ok: true, data: "recorded" };
  h.state.statsAfter = null;
  h.state.recentAfter = [];
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

describe("real-data: savings only when defensible", () => {
  it("no comparison data (missing delivery price) → no savings, never ₹0", () => {
    expect(defensibleSavings(35, 0)).toBeNull();
  });

  it("cooking costs as much or more than ordering → no savings claim", () => {
    expect(defensibleSavings(190, 190)).toBeNull();
    expect(defensibleSavings(210, 190)).toBeNull();
  });

  it("real comparison with a positive gap → the saving, always a positive number", () => {
    expect(defensibleSavings(35, 90)).toBe(55);
    expect(defensibleSavings(0, 90)).toBe(90);
  });

  it("aggregate savings copy reads as earned, never as a balance", () => {
    // keptInPocket is only ever fed the server's real aggregate.
    expect(keptInPocket(2845)).toContain("kept in your pocket");
  });
});

describe("real-data: streak speaks only when real", () => {
  it("zero streak → silence, never '0 day streak'", () => {
    expect(completionStreakLine(0)).toBeNull();
  });

  it("one and two day streaks speak plainly, no exclamation inflation", () => {
    expect(completionStreakLine(1)).toBe("Day one.");
    expect(completionStreakLine(2)).toBe("2 days in a row.");
  });
});

describe("real-data: meal ordinals come from real counts", () => {
  it("first meal gets its own milestone", () => {
    expect(mealNumberLine(1)).toBe("Your first RUCHI meal.");
  });

  it("a real count renders as the real ordinal — nothing invented", () => {
    expect(mealNumberLine(19)).toBe("That's meal #19.");
    expect(mealNumberLine(2)).toBe("That's meal #2.");
    expect(mealNumberLine(7)).toBe("That's meal #7.");
  });
});

describe("real-data: fresh user sees no fake statistics", () => {
  it("empty history + no server stats → every metric guard is at silence", () => {
    const s = useRuchi.getState();

    // The rendering guards (HomeScreen, ProfileScreen) require:
    //   cloudStats.mealsCooked > 0, currentStreak >= 1, totalSaved > 0,
    //   recentCooked.length > 0 — a fresh user trips ALL of them.
    expect(s.cloudStats).toBeNull(); // stats strip: hidden
    expect(s.recentCooked).toEqual([]); // Recently cooked: hidden
    expect(s.history).toEqual([]); // history list: empty state, no numbers
    expect(weeklyProgress(s).meals).toBe(0); // week card: meals row stays, others hidden
    expect(weeklyProgress(s).saved).toBe(0); // → guarded by > 0
    expect(streak(s)).toBe(0); // → guarded by >= 1
  });

  it("the fresh-kitchen headline promises, it never counts", () => {
    const headline = homeHeadline(0, 0);
    expect(headline).toBe("Your kitchen has\ndinner covered.");
    expect(/\d/.test(headline)).toBe(false); // no numbers in empty states
  });
});

describe("real-data: duplicate completion cannot inflate", () => {
  it("double-clicked completion carries ONE session token → one record's worth of intent", async () => {
    await signIn();
    useRuchi.getState().beginCookingSession();
    useRuchi.getState().logCookedMeal({ ...meal });
    useRuchi.getState().logCookedMeal({ ...meal }); // retry/double-click
    await flush();
    expect(h.state.completionCalls).toHaveLength(2);
    expect(h.state.completionCalls[0]!.token).toBe(h.state.completionCalls[1]!.token);
  });

  it("a 'duplicate' verdict keeps the session token alive — no inflation, still deduped", async () => {
    await signIn();
    useRuchi.getState().beginCookingSession();
    h.state.completionOutcome = { ok: true, data: "duplicate" };
    useRuchi.getState().logCookedMeal({ ...meal });
    await flush();
    // The server rejected the duplicate; the token survives so the SAME
    // cook can never become two records, and stats stay un-inflated.
    expect(useRuchi.getState().cookingSessionToken).not.toBeNull();
    expect(useRuchi.getState().cloudStats).toBeNull();
  });

  it("first meal = #1, second meal = #2 — counts refreshed from the server", async () => {
    await signIn();
    useRuchi.getState().beginCookingSession();
    useRuchi.getState().logCookedMeal({ ...meal });
    await flush();
    expect(useRuchi.getState().history).toHaveLength(1); // #1

    h.state.statsAfter = {
      mealsCooked: 1,
      totalSaved: 221,
      currentStreak: 1,
      longestStreak: 1,
      lastCompletedAt: Date.now(),
    };
    useRuchi.getState().beginCookingSession();
    useRuchi.getState().logCookedMeal({ ...meal, recipeId: "egg-rice" });
    await flush();
    expect(useRuchi.getState().history).toHaveLength(2); // #2
    expect(useRuchi.getState().cloudStats?.mealsCooked).toBe(1);
  });

  it("Recently cooked flows only from real completion records", async () => {
    const completed: MealHistoryEntry = {
      id: "srv-1",
      recipeId: "egg-rice",
      recipeName: "Egg Rice",
      cookedAt: NOW - DAY,
      servings: 1,
      proteinG: 18,
      calories: 699,
      cost: 19,
      deliveryCompareCost: 190,
    };
    h.state.recentAfter = [completed];
    await signIn();
    useRuchi.getState().beginCookingSession();
    useRuchi.getState().logCookedMeal({ ...meal });
    await flush();
    // Exactly the server's completed list — no scans, views or selections.
    expect(useRuchi.getState().recentCooked).toEqual([completed]);
  });

  it("stats are user-scoped: sign-out clears them, so no cross-user leakage", async () => {
    await signIn();
    useRuchi.setState({
      cloudStats: { mealsCooked: 9, totalSaved: 1000, currentStreak: 4, longestStreak: 6, lastCompletedAt: Date.now() },
      recentCooked: [{ ...meal, id: "x", cookedAt: NOW }],
    });
    useRuchi.getState().signOut();
    expect(useRuchi.getState().cloudStats).toBeNull();
    expect(useRuchi.getState().recentCooked).toEqual([]);
    expect(useRuchi.getState().account).toBeNull();
  });
});

describe("real-data: Context Engine never fabricates history", () => {
  it("no history → silence (type none), not an invented claim", () => {
    const ctx = evaluateAttention(
      {
        now: NOW,
        inventoryIds: [],
        diet: "non-vegetarian",
        history: [],
        pausedSession: null,
        lastShown: null,
      },
      null,
      null,
    );
    expect(ctx.type).toBe("none");
  });

  it("any surfaced context carries real evidence and a reason", () => {
    const history = [
      {
        id: "h1",
        recipeId: "paneer-egg-bhurji",
        recipeName: "Paneer Egg Bhurji",
        cookedAt: NOW - 2 * DAY,
        servings: 1,
        proteinG: 38,
        calories: 520,
        cost: 82,
        deliveryCompareCost: 303,
      },
    ];
    const ctx = evaluateAttention(
      {
        now: NOW,
        inventoryIds: ["egg", "paneer"],
        diet: "non-vegetarian",
        history,
        pausedSession: null,
        lastShown: null,
      },
      null,
      null,
    );
    // If the engine speaks, its evidence line references the real record —
    // it cannot cite a count that history doesn't contain.
    if (ctx.type !== "none" && ctx.supportingText) {
      const mentionsCount = /\b\d+\s+(meals|times)\b/i.test(ctx.supportingText);
      if (mentionsCount) {
        expect(ctx.supportingText).toContain("Paneer Egg Bhurji");
      }
    }
    expect(ctx.reason.length).toBeGreaterThan(0); // every claim has a reason
  });
});
