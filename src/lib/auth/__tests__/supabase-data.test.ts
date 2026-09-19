// ─────────────────────────────────────────────────────────────
// RUCHI — Supabase durable-data tests (mocked supabase-js client)
// ─────────────────────────────────────────────────────────────
// Verifies the mapping layer: MealHistoryEntry ⇄ completed_meals rows,
// profile ⇄ UserPreferences, streak RPC usage. Ownership is enforced by
// RLS in the real database — these tests confirm the client never sends
// another user's id and never writes streak numbers itself.

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    user: { id: "user-1" } as { id: string } | null,
    rows: {
      profiles: [] as Record<string, unknown>[],
      completed_meals: [] as Record<string, unknown>[],
      cooking_streaks: [] as Record<string, unknown>[],
      beta_feedback: [] as Record<string, unknown>[],
    },
    rpcCalls: [] as { fn: string; args: unknown }[],
    failNextRpc: false,
  };
  const client = {
    from: (table: string) => ({
      select: (_: string) => ({
        eq: (_col: string, _v: string) => ({
          maybeSingle: async () => ({
            data: h.state.rows[table as keyof typeof h.state.rows][0] ?? null,
            error: null,
          }),
          order: (_o: string, _dir: unknown) => ({
            limit: async (_n: number) => ({
              data: h.state.rows[table as keyof typeof h.state.rows],
              error: null,
            }),
          }),
          single: async () => ({
            data: h.state.rows[table as keyof typeof h.state.rows][0] ?? null,
            error: null,
          }),
        }),
        order: (_o: string, _dir: unknown) => ({
          limit: async (_n: number) => ({
            data: h.state.rows[table as keyof typeof h.state.rows],
            error: null,
          }),
        }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        const rows = h.state.rows[table as keyof typeof h.state.rows];
        const i = rows.findIndex((r) => r.id === row.id);
        if (i >= 0) rows[i] = { ...rows[i], ...row };
        else rows.push(row);
        return { error: null };
      },
      insert: async (rows: Record<string, unknown>[]) => {
        h.state.rows[table as keyof typeof h.state.rows].push(...rows);
        return { error: null };
      },
    }),
    rpc: async (fn: string, args: unknown) => {
      h.state.rpcCalls.push({ fn, args });
      if (h.state.failNextRpc) {
        h.state.failNextRpc = false;
        return { error: { message: "rpc failed" } };
      }
      return { error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: h.state.user }, error: null }),
    },
  };
  return { state, client };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => h.client),
}));

import { resetSupabaseForTests } from "../supabase";
import {
  fetchCompletedMeals,
  fetchProfile,
  fetchStreak,
  insertBetaFeedback,
  insertCompletedMeals,
  recordStreakDay,
  upsertProfile,
} from "../supabase-data";

const mealEntry = (over: Partial<Parameters<typeof insertCompletedMeals>[0][number]> = {}) => ({
  id: "local-1",
  recipeId: "paneer-egg-bhurji",
  recipeName: "Paneer Egg Bhurji",
  cookedAt: new Date(2026, 8, 16, 21).getTime(),
  servings: 2,
  proteinG: 38,
  calories: 520,
  cost: 82,
  deliveryCompareCost: 303,
  ...over,
});

beforeAll(() => {
  vi.stubGlobal("window", {} as unknown as Window & typeof globalThis);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  resetSupabaseForTests();
  h.state.user = { id: "user-1" };
  h.state.rows.profiles = [];
  h.state.rows.completed_meals = [];
  h.state.rows.cooking_streaks = [];
  h.state.rpcCalls = [];
  h.state.failNextRpc = false;
});

describe("completed meals mapping", () => {
  it("inserts store entries as RLS-scoped rows with app-computed values", async () => {
    const r = await insertCompletedMeals([mealEntry()]);
    expect(r.ok).toBe(true);
    const row = h.state.rows.completed_meals[0]!;
    expect(row.user_id).toBe("user-1"); // own id only — RLS would reject others
    expect(row.recipe_id).toBe("paneer-egg-bhurji");
    expect(row.local_date).toBe("2026-09-16");
    expect(row.protein_g).toBe(38);
    expect(row.savings_inr).toBe(221); // 303 - 82, app-computed
  });

  it("fetchCompletedMeals maps rows back to store shape", async () => {
    h.state.rows.completed_meals = [
      {
        id: "srv-1",
        recipe_id: "egg-fried-rice",
        recipe_name: "Egg Fried Rice",
        completed_at: new Date(2026, 8, 15, 20).toISOString(),
        local_date: "2026-09-15",
        servings: 1,
        protein_g: 29,
        calories: 480,
        cost_inr: 61,
        savings_inr: 139,
      },
    ];
    const r = await fetchCompletedMeals();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0]!.recipeId).toBe("egg-fried-rice");
      expect(r.data[0]!.deliveryCompareCost).toBe(200); // 61 + 139
    }
  });
});

describe("profile", () => {
  it("upserts prefs into the schema's columns + extras", async () => {
    const r = await upsertProfile({
      displayName: "Madhu",
      prefs: {
        diet: "eggetarian",
        allergies: ["peanut"],
        fitnessGoal: "high-protein",
        skill: "comfortable",
        defaultServings: 2,
        budget: 100,
        cuisines: ["Indian"],
        equipment: ["stove", "kadai"],
      },
    });
    expect(r.ok).toBe(true);
    const row = h.state.rows.profiles[0]!;
    expect(row.id).toBe("user-1");
    expect(row.display_name).toBe("Madhu");
    expect(row.diet_preference).toBe("eggetarian");
    expect(row.cooking_skill).toBe("comfortable");
    expect(row.budget_preference).toBe(100);
    expect((row.extras as { allergies: string[] }).allergies).toEqual(["peanut"]);
  });

  it("fetchProfile maps back to UserPreferences", async () => {
    h.state.rows.profiles = [
      {
        id: "user-1",
        display_name: "Madhu",
        diet_preference: "vegetarian",
        cooking_skill: "confident",
        fitness_goal: "weight-loss",
        default_servings: 2,
        budget_preference: 150,
        extras: { allergies: ["peanut"], cuisines: ["Indian"], equipment: ["oven"] },
        updated_at: new Date(2026, 8, 16).toISOString(),
      },
    ];
    const r = await fetchProfile();
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      expect(r.data.displayName).toBe("Madhu");
      expect(r.data.prefs?.diet).toBe("vegetarian");
      expect(r.data.prefs?.equipment).toEqual(["oven"]);
    }
  });

  it("fetchProfile returns null row when the user has none", async () => {
    const r = await fetchProfile();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeNull();
  });
});

describe("streak RPC", () => {
  it("sends ONLY a local calendar date — never a streak number", async () => {
    await recordStreakDay(new Date(2026, 8, 16, 21).getTime());
    expect(h.state.rpcCalls).toHaveLength(1);
    expect(h.state.rpcCalls[0]!.fn).toBe("record_completed_meal_day");
    expect(h.state.rpcCalls[0]!.args).toEqual({ p_local_date: "2026-09-16" });
  });

  it("propagates RPC failure as a sync error", async () => {
    h.state.failNextRpc = true;
    const r = await recordStreakDay(Date.now());
    expect(r.ok).toBe(false);
  });

  it("fetchStreak reads the server-computed row", async () => {
    h.state.rows.cooking_streaks = [
      { user_id: "user-1", current_streak: 3, longest_streak: 7, last_completed_local_date: "2026-09-16" },
    ];
    const r = await fetchStreak();
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      expect(r.data.current).toBe(3);
      expect(r.data.longest).toBe(7);
      expect(r.data.lastCompletedLocalDate).toBe("2026-09-16");
    }  });
});

describe("beta feedback", () => {
  it("inserts with the SIGNED-IN user's id only — client cannot choose ownership", async () => {
    h.state.rows.beta_feedback = [];
    const r = await insertBetaFeedback("recipe", "Onion quantity was way off for 2 servings.");
    expect(r.ok).toBe(true);
    expect(h.state.rows.beta_feedback).toHaveLength(1);
    expect(h.state.rows.beta_feedback[0]!.user_id).toBe("user-1");
  });

  it("rejects anonymous use and out-of-range messages before any network call", async () => {
    h.state.rows.beta_feedback = [];
    h.state.user = null;
    expect((await insertBetaFeedback("bug", "Signed out — must fail")).ok).toBe(false);
    h.state.user = { id: "user-1" };
    expect((await insertBetaFeedback("bug", "ab")).ok).toBe(false); // < 3 chars
    expect((await insertBetaFeedback("bug", "x".repeat(1001))).ok).toBe(false);
    expect(h.state.rows.beta_feedback).toHaveLength(0);
  });

  it("propagates insert failure without leaking details", async () => {
    h.state.rows.beta_feedback = [];
    const orig = h.client.from;
    h.client.from = (() => ({
      insert: async () => ({ error: { message: "rls violation" } }),
    })) as unknown as typeof h.client.from;
    const r = await insertBetaFeedback("general", "Network hiccup test message.");
    h.client.from = orig;
    expect(r).toEqual({ ok: false, reason: "error" });
    expect(h.state.rows.beta_feedback).toHaveLength(0);
  });
});
