// Tests for the Find-My-Meal product flow contract:
// exactly 3 strong recommendations, a deterministic "RUCHI chooses" pick,
// capped why-lines, and the indian cuisine intent.

import { describe, expect, it } from "vitest";
import {
  RECOMMENDATION_LIMIT,
  chooseForMe,
  matchRecipes,
  recommend,
} from "@/lib/engine/match";
import type { MatchFilters } from "@/lib/engine/match";

const STUDENT: MatchFilters = {
  hasIds: ["egg", "paneer", "tomato", "onion", "rice"],
  intents: ["high-protein", "quick", "budget"],
  timeMax: 20,
  budgetMax: 100,
  servings: 1,
  diet: "eggetarian",
};

const VEGETARIAN: MatchFilters = {
  hasIds: ["paneer", "tomato", "onion", "rice"],
  intents: [],
  timeMax: 0,
  budgetMax: 0,
  servings: 2,
  diet: "vegetarian",
};

describe("Find My Meal — 3-pick contract", () => {
  it("returns exactly RECOMMENDATION_LIMIT (3) picks when the kitchen allows it", () => {
    expect(RECOMMENDATION_LIMIT).toBe(3);
    const recs = recommend(STUDENT);
    expect(recs).toHaveLength(3);
  });

  it("never returns more than 3 even when AI picks overflow the slice", () => {
    const overPicks = ["paneer-egg-bhurji", "egg-fried-rice", "masala-omelette", "dal-rice"].map(
      (recipeId) => ({ recipeId, matchReason: ["AI said so"] }),
    );
    const recs = recommend(STUDENT, overPicks);
    expect(recs.length).toBeLessThanOrEqual(RECOMMENDATION_LIMIT);
  });

  it("keeps why-lines capped at 3 even with verbose AI match reasons", () => {
    const recs = recommend(STUDENT, [
      { recipeId: "paneer-egg-bhurji", matchReason: ["one", "two", "three", "four", "five"] },
    ]);
    for (const r of recs) expect(r.why.length).toBeLessThanOrEqual(RECOMMENDATION_LIMIT);
  });

  it("stays within the contract on a thin eligible set", () => {
    const recs = recommend(VEGETARIAN);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs.length).toBeLessThanOrEqual(RECOMMENDATION_LIMIT);
  });
});

describe("chooseForMe — the deterministic single pick", () => {
  it("agrees with the engine's own first recommendation", () => {
    const best = chooseForMe(STUDENT);
    expect(best).not.toBeNull();
    expect(best?.recipe.id).toBe(recommend(STUDENT)[0]?.recipe.id);
  });

  it("respects the strict eligibility gate (fully owned core ingredients)", () => {
    const best = chooseForMe(STUDENT);
    expect(best?.missing).toHaveLength(0);
  });

  it("returns null only when nothing is eligible — never a near-miss", () => {
    const nothing = chooseForMe({
      hasIds: ["pineapple"],
      intents: [],
      timeMax: 0,
      budgetMax: 0,
      servings: 1,
      diet: "non-vegetarian",
    });
    expect(nothing).toBeNull();
  });

  it("is a pure function of the filters — no AI, no randomness", () => {
    const a = chooseForMe(VEGETARIAN);
    const b = chooseForMe(VEGETARIAN);
    expect(a?.recipe.id).toBe(b?.recipe.id);
  });
});

describe("indian intent", () => {
  it("is accepted by the filter and never breaks matching", () => {
    const scores = matchRecipes({ ...STUDENT, intents: ["indian"] });
    expect(scores.length).toBeGreaterThan(0);
  });

  it("shifts scores toward Indian-cuisine dishes without changing eligibility", () => {
    const base = matchRecipes(STUDENT);
    const indian = matchRecipes({ ...STUDENT, intents: [...STUDENT.intents, "indian"] });
    // Same candidate SET — the intent reorders, never expands or drops.
    expect([...indian.map((m) => m.recipe.id)].sort()).toEqual(
      [...base.map((m) => m.recipe.id)].sort(),
    );
    // And no Indian-cuisine recipe lost ground because of the intent.
    for (const m of base) {
      if (m.recipe.cuisine !== "Indian") continue;
      const after = indian.findIndex((x) => x.recipe.id === m.recipe.id);
      const before = base.findIndex((x) => x.recipe.id === m.recipe.id);
      expect(after).toBeLessThanOrEqual(before);
    }
  });
});
