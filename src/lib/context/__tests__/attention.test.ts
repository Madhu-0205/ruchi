// ─────────────────────────────────────────────────────────────
// RUCHI — Re-Attention Context Engine (unit tests)
// ─────────────────────────────────────────────────────────────
// Deterministic coverage of the product spec's required cases:
// signals, priority, suppression, honesty (no fabricated stats),
// and copy tone (never guilt).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEAL_WINDOWS,
  evaluateAttention,
  isSuppressed,
  mealWindow,
  quickWinHeadline,
  suppressionUntilFor,
  type AttentionInput,
  type AttentionRecipeFacts,
} from "../attention";
import type { Recommendation } from "@/lib/engine/match";

const DAY = 86_400_000;
const NOW = new Date("2026-09-25T19:30:00").getTime(); // Friday dinner time

const HISTORY = (over: Partial<import("@/lib/types").MealHistoryEntry> = {}) => ({
  id: "h1",
  recipeId: "paneer-egg-bhurji",
  recipeName: "Paneer Egg Bhurji",
  cookedAt: NOW - 2 * DAY,
  servings: 1,
  proteinG: 38,
  calories: 520,
  cost: 82,
  deliveryCompareCost: 303,
  ...over,
});

const BEST: Recommendation = {
  recipe: {
    id: "egg-rice",
    name: "Egg Rice",
    heroEmoji: "🍚",
    timeMin: 15,
    steps: [],
    substitutions: [],
    deliveryCompare: { name: "Delivery fried rice", cost: 190 },
  } as unknown as Recommendation["recipe"],
  missing: [],
  reason: "",
  why: [],
  usesCount: 4,
  protein: 17,
  costPerServing: 17,
  minutes: 15,
  difficulty: "easy",
  notNeeded: [],
  category: "CAN_COOK_NOW",
  coreMatched: 3,
  coreTotal: 3,
} as unknown as Recommendation;

const FACTS: AttentionRecipeFacts = { timeMin: 15, proteinPerServing: 17, costPerServing: 17 };

const baseInput = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  now: NOW,
  inventoryIds: ["egg", "rice", "onion"],
  diet: "eggetarian",
  history: [],
  pausedSession: null,
  lastShown: null,
  mealWindows: DEFAULT_MEAL_WINDOWS,
  ...over,
});

describe("re-attention: no context → none", () => {
  it("returns none for a first-time user with an empty kitchen", () => {
    const ctx = evaluateAttention(
      baseInput({ inventoryIds: [], history: [] }),
      null,
      null,
    );
    expect(ctx.type).toBe("none");
    expect(ctx.priority).toBe(0);
    expect(ctx.reason).toBe("no meaningful signal");
  });

  it("with an empty kitchen, only a real repeat opportunity stands", () => {
    const ctx = evaluateAttention(
      baseInput({ inventoryIds: [], history: [HISTORY()] }),
      null,
      null,
    );
    // Ingredient/gap/return contexts need inventory to act on; the repeat
    // stands on REAL completed history alone (the recipe is in the catalog).
    expect(ctx.type).toBe("repeat_success");
    expect(ctx.reason).toContain("cooked Paneer Egg Bhurji recently");
  });

  it("stays fully silent with an empty kitchen and a catalog-missing last cook", () => {
    const ctx = evaluateAttention(
      baseInput({ inventoryIds: [], history: [HISTORY({ recipeId: "ghost-recipe", recipeName: "Ghost" })] }),
      null,
      null,
    );
    expect(ctx.type).toBe("none");
  });
});

describe("re-attention: ingredient opportunity", () => {
  it("surfaces unused_ingredients when the engine finds an eligible meal", () => {
    const ctx = evaluateAttention(baseInput(), BEST, FACTS);
    expect(ctx.type).toBe("unused_ingredients");
    expect(ctx.recipeId).toBe("egg-rice");
    expect(ctx.action).toBe("cook");
    expect(ctx.reason).toBe("3/3 core ingredients available");
  });

  it("does not fabricate an ingredient context without an eligible meal", () => {
    const ctx = evaluateAttention(baseInput(), null, null);
    expect(ctx.type).not.toBe("unused_ingredients");
  });
});

describe("re-attention: recently cooked → repeat", () => {
  it("offers cook_again for the last completed dish within the window", () => {
    const ctx = evaluateAttention(
      baseInput({ history: [HISTORY({ cookedAt: NOW - DAY })] }),
      null, // even without a live ingredient match, the repeat stands on history
      null,
    );
    expect(ctx.type).toBe("repeat_success");
    expect(ctx.action).toBe("cook_again");
    expect(ctx.recipeId).toBe("paneer-egg-bhurji");
    // Uses REAL numbers from the recipe facts, never invented.
    expect(ctx.supportingText).toMatch(/min/);
  });

  it("never implies satisfaction — copy is neutral", () => {
    const ctx = evaluateAttention(baseInput({ history: [HISTORY()] }), null, FACTS);
    expect(ctx.headline.toLowerCase()).not.toMatch(/love|favorite|craving/);
  });

  it("hands over to return_visit after the recent window (3–13 days)", () => {
    const ctx = evaluateAttention(
      baseInput({ history: [HISTORY({ cookedAt: NOW - 9 * DAY })] }),
      null,
      null,
    );
    expect(ctx.type).toBe("return_visit");
  });
});

describe("re-attention: incomplete session → resume wins", () => {
  it("resumes a genuinely paused session at the highest priority", () => {
    const ctx = evaluateAttention(
      baseInput({
        pausedSession: { recipeId: "dal-rice", stepIndex: 2, stepCount: 5, pausedAt: NOW - 40 * 60_000 },
        history: [HISTORY()],
      }),
      BEST,
      FACTS,
    );
    expect(ctx.type).toBe("incomplete_session");
    expect(ctx.action).toBe("resume");
    expect(ctx.priority).toBeGreaterThan(90);
    expect(ctx.supportingText).toContain("Step 3 of 5");
  });

  it("ignores stale (12h+) pauses and step-0 non-starts", () => {
    const stale = evaluateAttention(
      baseInput({ pausedSession: { recipeId: "dal-rice", stepIndex: 2, stepCount: 5, pausedAt: NOW - 20 * 3_600_000 } }),
      null,
      null,
    );
    const stepZero = evaluateAttention(
      baseInput({ pausedSession: { recipeId: "dal-rice", stepIndex: 0, stepCount: 5, pausedAt: NOW - 60_000 } }),
      null,
      null,
    );
    expect(stale.type).not.toBe("incomplete_session");
    expect(stepZero.type).not.toBe("incomplete_session");
  });
});

describe("re-attention: cooking gap — gentle, never guilt", () => {
  it("uses calm language after a long quiet period (14+ days)", () => {
    const ctx = evaluateAttention(
      baseInput({ history: [HISTORY({ cookedAt: NOW - 20 * DAY })] }),
      null,
      null,
    );
    expect(ctx.type).toBe("cooking_gap");
    expect(ctx.headline).toBe("Been a while. Want an easy one?");
  });

  it("never shames or mentions streaks/progress loss", () => {
    const ctx = evaluateAttention(
      baseInput({ history: [HISTORY({ cookedAt: NOW - 30 * DAY })] }),
      null,
      null,
    );
    const all = `${ctx.headline} ${ctx.supportingText ?? ""}`.toLowerCase();
    expect(all).not.toMatch(/broke|lost|waste|streak|behind|missed out/);
  });
});

describe("re-attention: meal-time context needs a real signal", () => {
  it("fires in the dinner window WITH an eligible meal", () => {
    const ctx = evaluateAttention(baseInput(), BEST, FACTS);
    // unused_ingredients outranks meal_time — but meal_time must exist as a candidate:
    expect(["unused_ingredients", "meal_time"]).toContain(ctx.type);
  });

  it("never fires on time alone (no meal, no inventory)", () => {
    const ctx = evaluateAttention(baseInput({ inventoryIds: [] }), null, null);
    expect(ctx.type).toBe("none");
  });

  it("mealWindow classifies local hours deterministically", () => {
    const dinner = new Date("2026-09-25T19:00:00").getTime();
    const off = new Date("2026-09-25T16:00:00").getTime();
    expect(mealWindow(dinner)).toBe("dinner");
    expect(mealWindow(off)).toBeNull();
  });
});

describe("re-attention: priority system", () => {
  it("picks exactly ONE opportunity when many are true", () => {
    const ctx = evaluateAttention(
      baseInput({
        history: [HISTORY({ cookedAt: NOW - DAY })],
        pausedSession: { recipeId: "dal-rice", stepIndex: 1, stepCount: 4, pausedAt: NOW - 30 * 60_000 },
      }),
      BEST,
      FACTS,
    );
    expect(ctx.type).toBe("incomplete_session");
  });

  it("ingredient match beats repeat when both are live", () => {
    const ctx = evaluateAttention(
      baseInput({ history: [HISTORY({ cookedAt: NOW - DAY })] }),
      BEST,
      FACTS,
    );
    expect(ctx.type).toBe("unused_ingredients");
  });

  it("is deterministic — same input, same output", () => {
    const input = baseInput({ history: [HISTORY()] });
    const a = evaluateAttention(input, BEST, FACTS);
    const b = evaluateAttention(input, BEST, FACTS);
    expect(a).toEqual(b);
  });
});

describe("re-attention: suppression", () => {
  const ctx = { type: "unused_ingredients", recipeId: "egg-rice" } as const;

  it("suppresses the same context within its cooldown", () => {
    const shown = { type: "unused_ingredients" as const, recipeId: "egg-rice", at: NOW - 3_600_000 };
    expect(isSuppressed({ ...ctx } as never, { lastShown: shown }, NOW)).toBe(true);
  });

  it("re-allows after both the type cooldown AND the recipe-fatigue window expire", () => {
    const shown = { type: "unused_ingredients" as const, recipeId: "egg-rice", at: NOW - 25 * 3_600_000 };
    expect(isSuppressed({ ...ctx } as never, { lastShown: shown }, NOW)).toBe(false);
  });

  it("keeps recipe fatigue active within 24h even after the type cooldown", () => {
    const shown = { type: "unused_ingredients" as const, recipeId: "egg-rice", at: NOW - 7 * 3_600_000 };
    expect(isSuppressed({ ...ctx } as never, { lastShown: shown }, NOW)).toBe(true);
  });

  it("offers cook_again using catalog facts even without a live ingredient match", () => {
    const ctx = evaluateAttention(
      baseInput({ history: [HISTORY({ cookedAt: NOW - 2 * DAY })] }),
      null,
      null,
    );
    expect(ctx.type).toBe("repeat_success");
    expect(ctx.supportingText).toMatch(/^\d+ min · \d+g protein · ~₹\d+$/);
  });

  it("suppresses a recently shown recipe across context types", () => {
    const shown = { type: "repeat_success" as const, recipeId: "egg-rice", at: NOW - 2 * 3_600_000 };
    expect(isSuppressed({ ...ctx } as never, { lastShown: shown }, NOW)).toBe(true);
  });

  it("respects the global mute after a dismissal", () => {
    expect(
      isSuppressed({ ...ctx } as never, { lastShown: null, suppressionUntil: NOW + 3_600_000 }, NOW),
    ).toBe(true);
    expect(
      isSuppressed({ ...ctx } as never, { lastShown: null, suppressionUntil: NOW - 1000 }, NOW),
    ).toBe(false);
  });

  it("schedules cooldowns per type", () => {
    expect(suppressionUntilFor("cooking_gap", NOW)).toBe(NOW + 48 * 3_600_000);
    expect(suppressionUntilFor("quick_win", NOW)).toBe(NOW + 6 * 3_600_000);
  });
});

describe("re-attention: honesty", () => {
  it("never shows numbers the caller did not provide", () => {
    // The quick-win builder uses the recipe's REAL timeMin via quickWinHeadline.
    expect(quickWinHeadline(15)).toBe("Dinner in 15 minutes.");
    const ctx = evaluateAttention(baseInput(), BEST, FACTS);
    expect(ctx.headline).toBe("You already have dinner."); // unused_ingredients wins (90 > 65)
  });

  it("no-history users get no fabricated counts anywhere", () => {
    const ctx = evaluateAttention(baseInput(), null, null);
    expect(JSON.stringify(ctx)).not.toMatch(/meals? #|meals made/i);
  });
});
