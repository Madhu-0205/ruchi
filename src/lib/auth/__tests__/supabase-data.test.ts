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
      cooking_completions: [] as Record<string, unknown>[],
      cooking_stats: [] as Record<string, unknown>[],
      beta_feedback: [] as Record<string, unknown>[],
      notification_prefs: [] as Record<string, unknown>[],
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
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, _v: string) => {
          const rows = h.state.rows[table as keyof typeof h.state.rows] as Record<string, unknown>[];
          let n = 0;
          for (const r of rows) {
            if (r.user_id === _v || r.id === _v) {
              Object.assign(r, patch);
              n++;
            }
          }
          return { data: null, error: null, rowCount: n };
        },
      }),
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
  fetchCookingStats,
  fetchProfile,
  fetchRecentCookedMeals,
  fetchStreak,
  insertBetaFeedback,
  insertCompletedMeals,
  recordCookingCompletion,
  recordStreakDay,
  upsertProfile,
  fetchNotificationPrefs,
  pushAttentionState,
  upsertNotificationChannels,
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
  h.state.rows.cooking_completions = [];
  h.state.rows.cooking_stats = [];
  h.state.rows.notification_prefs = [];
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

describe("real cooking stats — completion records", () => {
  it("sends session token + engine values, NEVER a saving, streak, or foreign user id", async () => {
    const r = await recordCookingCompletion({
      sessionToken: "tok-1",
      recipeId: "paneer-egg-bhurji",
      recipeName: "Paneer Egg Bhurji",
      cookedAtMs: new Date(2026, 8, 16, 21).getTime(),
      servings: 2,
      proteinG: 38,
      calories: 520,
      costInr: 82,
      deliveryCompareInr: 303,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe("recorded");
    const call = h.state.rpcCalls.find((c) => c.fn === "record_cooking_completion");
    expect(call).toBeDefined();
    expect(call!.args).toEqual({
      p_session_token: "tok-1",
      p_recipe_id: "paneer-egg-bhurji",
      p_recipe_name: "Paneer Egg Bhurji",
      p_completed_at: new Date(2026, 8, 16, 21).toISOString(),
      p_local_date: "2026-09-16",
      p_servings: 2,
      p_protein_g: 38,
      p_calories: 520,
      p_cost_inr: 82,
      p_delivery_compare_inr: 303,
    });
    // No savings/streak/user-id arguments ever leave the client.
    expect(Object.keys(call!.args as object)).not.toContain("p_savings_inr");
    expect(Object.keys(call!.args as object)).not.toContain("p_user_id");
    expect(Object.keys(call!.args as object)).not.toContain("p_current_streak");
  });

  it("maps a 'duplicate' RPC reply to the duplicate outcome", async () => {
    const orig = h.client.rpc;
    h.client.rpc = (async () => ({ data: "duplicate", error: null })) as unknown as typeof h.client.rpc;
    const r = await recordCookingCompletion({
      sessionToken: "tok-2",
      recipeId: "egg-rice",
      recipeName: "Egg Rice",
      cookedAtMs: Date.now(),
      servings: 1,
      proteinG: 17,
      calories: 549,
      costInr: 17,
      deliveryCompareInr: 190,
    });
    h.client.rpc = orig;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe("duplicate");
  });

  it("fails honestly when unauthenticated", async () => {
    h.state.user = null;
    const r = await recordCookingCompletion({
      sessionToken: "tok-3",
      recipeId: "egg-rice",
      recipeName: "Egg Rice",
      cookedAtMs: Date.now(),
      servings: 1,
      proteinG: 17,
      calories: 549,
      costInr: 17,
      deliveryCompareInr: 190,
    });
    expect(r.ok).toBe(false);
  });

  it("fetchCookingStats maps the server-derived view row", async () => {
    h.state.rows.cooking_stats = [
      {
        meals_cooked: 5,
        total_saved: 862,
        last_completed_at: new Date(2026, 8, 16, 21).toISOString(),
        current_streak: 2,
        longest_streak: 3,
      },
    ];
    const r = await fetchCookingStats();
    expect(r.ok).toBe(true);
    if (r.ok && r.data) {
      expect(r.data.mealsCooked).toBe(5);
      expect(r.data.totalSaved).toBe(862);
      expect(r.data.currentStreak).toBe(2);
      expect(r.data.longestStreak).toBe(3);
    }
  });

  it("fetchCookingStats returns null data when the user has no records", async () => {
    const r = await fetchCookingStats();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeNull();
  });

  it("fetchRecentCookedMeals maps completion rows to store shape", async () => {
    h.state.rows.cooking_completions = [
      {
        id: "c-1",
        recipe_id: "egg-fried-rice",
        recipe_name: "Egg Fried Rice",
        completed_at: new Date(2026, 8, 15, 20).toISOString(),
        servings: 1,
        protein_g: 29,
        calories: 480,
        cost_inr: 61,
        savings_inr: 139,
      },
    ];
    const r = await fetchRecentCookedMeals();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0]!.recipeId).toBe("egg-fried-rice");
      expect(r.data[0]!.deliveryCompareCost).toBe(200); // 61 + 139
    }
  });
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

// ── Notification prefs (migration 0004) ──────────────────────

describe("notification prefs", () => {
  it("fetchNotificationPrefs returns null when the user never opted in", async () => {
    const r = await fetchNotificationPrefs();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeNull(); // defaults OFF — the app must treat this as all-channels-off
  });

  it("upsertNotificationChannels stores only known channels as booleans", async () => {
    const r = await upsertNotificationChannels({ web_push: true, sms: true } as never);
    expect(r.ok).toBe(true);
    const row = h.state.rows.notification_prefs[0]!;
    expect(row.user_id).toBe("user-1"); // own id only
    expect(row.channels).toEqual({ web_push: true }); // "sms" stripped client-side
  });

  it("fetchNotificationPrefs maps channels/quiet/cap and drops unknown flags", async () => {
    h.state.rows.notification_prefs = [
      {
        user_id: "user-1",
        channels: { web_push: true, email: false, sms: true },
        quiet_hours: { start: 21, end: 9 },
        max_per_week: 3,
        updated_at: new Date(2026, 8, 25, 10).toISOString(),
      },
    ];
    const r = await fetchNotificationPrefs();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data!.channels).toEqual({ web_push: true }); // unknown keys dropped
      expect(r.data!.quietHours).toEqual({ start: 21, end: 9 });
      expect(r.data!.maxPerWeek).toBe(3);
    }
  });

  it("pushAttentionState updates the mirror but never creates a row (opt-in stays explicit)", async () => {
    const mirror = { lastShown: { type: "unused_ingredients", recipeId: "egg-rice", at: 1790000000000 } };
    const rNoRow = await pushAttentionState(mirror);
    expect(rNoRow.ok).toBe(true);
    expect(h.state.rows.notification_prefs).toHaveLength(0); // no side-effect opt-in

    h.state.rows.notification_prefs = [
      { user_id: "user-1", channels: { web_push: true }, attention_state: {} },
    ];
    await pushAttentionState(mirror);
    expect(h.state.rows.notification_prefs[0]!.attention_state).toEqual(mirror);
  });

  it("pushAttentionState propagates failure as { ok: false }", async () => {
    h.state.rows.notification_prefs = [
      { user_id: "user-1", channels: {}, attention_state: {} },
    ];
    const orig = h.client.from;
    h.client.from = (() => ({
      update: () => ({
        eq: async () => ({ data: null, error: { message: "rls" }, rowCount: 0 }),
      }),
    })) as unknown as typeof h.client.from;
    const r = await pushAttentionState({ lastShown: null });
    h.client.from = orig;
    expect(r).toEqual({ ok: false, reason: "error" });
  });
});
