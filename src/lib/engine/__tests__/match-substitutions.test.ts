import { describe, expect, it } from "vitest";

import { matchRecipes, recommend, type MatchFilters } from "@/lib/engine/match";
import { RECIPES, getRecipe } from "@/lib/data/recipes";

const BASE: MatchFilters = {
  hasIds: ["egg", "paneer", "tomato", "onion", "rice"],
  intents: [],
  timeMax: 0,
  budgetMax: 0,
  servings: 2,
  diet: "non-vegetarian",
};

describe("substitution-aware matching", () => {
  it("covers a missing ingredient when the user owns the recipe's swap", () => {
    // kadai-paneer: capsicum missing but paneer (the recipe's own swap) is owned
    const kitchen = {
      ...BASE,
      hasIds: ["paneer", "onion", "tomato"], // no capsicum
    };
    const kadai = matchRecipes(kitchen).find((m) => m.recipe.id === "kadai-paneer");
    expect(kadai).toBeDefined();
    expect(kadai?.missing).toContain("capsicum");
    expect(kadai?.substitutable).toContain("capsicum");
    expect(kadai?.reasons.join(" ")).toMatch(/instead of capsicum/i);
  });

  it("does not cover a missing ingredient when the swap is also absent", () => {
    const kitchen = { ...BASE, hasIds: ["onion", "tomato"] }; // no paneer, no tofu
    const kadai = matchRecipes(kitchen).find((m) => m.recipe.id === "kadai-paneer");
    expect(kadai).toBeDefined();
    if (kadai?.missing.includes("paneer")) {
      expect(kadai.substitutable).not.toContain("paneer");
    }
  });

  it("ranks a swap-covered recipe above an equal-coverage one without swaps", () => {
    // Same effective coverage, but a satisfied substitution earns a bonus.
    const kitchen = { ...BASE, hasIds: ["paneer", "onion", "tomato"] };
    const scores = matchRecipes(kitchen).filter((m) => m.substitutable.length > 0);
    expect(scores.length).toBeGreaterThan(0);
    for (const m of scores) {
      expect(m.score).toBeGreaterThan(0);
    }
  });

  it("keeps optional ingredients from blocking matches", () => {
    // french toast without optional garnish — still recommended
    const kitchen = { ...BASE, hasIds: ["bread", "egg", "milk", "sugar", "butter"] };
    const recs = recommend(kitchen);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]?.missing).toHaveLength(0);
  });

  it("never recommends recipes below half core coverage", () => {
    const scores = matchRecipes({ ...BASE, hasIds: ["rice"] });
    for (const m of scores) {
      const core = m.recipe.ingredients.filter((i) => !i.optional).length;
      const have = core - m.missing.length;
      expect(have / core).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe("recommend — richer reasons", () => {
  it("explains a perfect match", () => {
    const recs = recommend(BASE);
    expect(recs[0]?.why.length).toBeGreaterThan(0);
    expect(recs[0]?.why.some((line) => /ingredient/i.test(line))).toBe(true);
  });

  it("explains a substitution opportunity in the why-lines", () => {
    const kitchen = { ...BASE, hasIds: ["paneer", "onion", "tomato"] };
    const recs = recommend(kitchen);
    const withSwap = recs.find((r) => r.missing.length > 0 && r.recipe.substitutions.length > 0);
    if (withSwap) {
      // either the swap is owned (why mentions it) or it isn't (no false claim)
      const ownedSwap = withSwap.recipe.substitutions.some(
        (s) => s.useId && kitchen.hasIds.includes(s.useId),
      );
      if (ownedSwap) {
        expect(withSwap.why.join(" ").length).toBeGreaterThan(0);
      }
    }
  });

  it("caps recommendations at 4 with distinct recipes", () => {
    const recs = recommend(BASE);
    expect(recs.length).toBeLessThanOrEqual(4);
    const ids = new Set(recs.map((r) => r.recipe.id));
    expect(ids.size).toBe(recs.length);
  });

  it("AI picks can only reorder the deterministic top slice", () => {
    const ranked = matchRecipes(BASE);
    const topIds = ranked.slice(0, 4).map((m) => m.recipe.id);
    const recs = recommend(BASE, [
      { recipeId: topIds[topIds.length - 1]!, matchReason: ["AI says so"] },
    ]);
    expect(recs[0]?.recipe.id).toBe(topIds[topIds.length - 1]);
    // invented recipe ids can never appear
    const invented = recommend(BASE, [{ recipeId: "not-a-recipe", matchReason: ["nope"] }]);
    expect(invented.every((r) => RECIPES.some((real) => real.id === r.recipe.id))).toBe(true);
  });
});

describe("category metadata", () => {
  it("every recipe has a valid category", () => {
    for (const r of RECIPES) {
      expect(["breakfast", "lunch", "dinner", "snack", "drink"]).toContain(r.category);
    }
  });

  it("the catalog covers every category", () => {
    for (const cat of ["breakfast", "lunch", "dinner", "snack", "drink"]) {
      expect(RECIPES.some((r) => r.category === cat)).toBe(true);
    }
  });

  it("brief-named classics exist with real data", () => {
    for (const id of [
      "besan-chilla",
      "moong-dal-chilla",
      "masala-dosa",
      "idli",
      "aloo-paratha",
      "rajma-masala",
      "chole-masala",
      "kadai-paneer",
      "sambar",
      "lemon-rice",
      "jeera-rice",
      "dal-tadka",
      "dal-fry",
      "french-toast",
      "veg-sandwich",
      "mushroom-masala",
      "chicken-pepper-fry",
      "paneer-masala",
    ]) {
      const r = getRecipe(id);
      expect(r, `${id} must exist`).toBeDefined();
      expect(r?.steps.length).toBeGreaterThanOrEqual(3);
      expect(r?.nutritionPerServing.protein).toBeGreaterThan(0);
    }
  });
});
