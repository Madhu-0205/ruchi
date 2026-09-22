// Tests for the binary diet classification (src/lib/data/diet.ts) and its
// use across discovery/search. The product promise: when a user filters by
// VEG or NON-VEG, the result set must never betray that choice.

import { describe, expect, it } from "vitest";

import { INGREDIENTS } from "@/lib/data/ingredients";
import { RECIPES } from "@/lib/data/recipes";
import { dietTypeOf, validateDietClassification } from "@/lib/data/diet";
import { filterRecipes, searchRecipes } from "@/lib/engine/search";

describe("dietTypeOf — the binary product policy", () => {
  it("maps the 3-way diet enum onto the binary product view", () => {
    const veg = RECIPES.find((r) => r.diet === "veg")!;
    const egg = RECIPES.find((r) => r.diet === "egg")!;
    const nonveg = RECIPES.find((r) => r.diet === "nonveg")!;
    expect(dietTypeOf(veg)).toBe("veg");
    // Documented product policy: egg counts as non-veg in the binary view
    // (common Indian home convention), while `diet: "egg"` keeps
    // eggetarian users precisely served in recommendations.
    expect(dietTypeOf(egg)).toBe("non_veg");
    expect(dietTypeOf(nonveg)).toBe("non_veg");
  });
});

describe("diet consistency — every recipe checked against its ingredients", () => {
  it("the whole catalog passes programmatic classification validation", () => {
    expect(validateDietClassification()).toEqual([]);
  });

  it("veg recipes contain no meat/seafood ingredients", () => {
    const meat = new Set(
      INGREDIENTS.filter((i) =>
        ["chicken-breast", "mutton", "fish", "prawn"].includes(i.id),
      ).map((i) => i.id),
    );
    for (const r of RECIPES.filter((x) => x.diet === "veg")) {
      for (const ing of r.ingredients) {
        expect(meat.has(ing.ingredientId), `${r.id} veg but has ${ing.ingredientId}`).toBe(false);
      }
    }
  });

  it("nonveg recipes each contain a real meat/seafood ingredient", () => {
    const meat = new Set(["chicken-breast", "mutton", "fish", "prawn"]);
    const nonveg = RECIPES.filter((r) => r.diet === "nonveg");
    expect(nonveg.length).toBeGreaterThan(20);
    for (const r of nonveg) {
      const hasMeat = r.ingredients.some((i) => meat.has(i.ingredientId));
      expect(hasMeat, `${r.id} declared nonveg but has no meat/seafood ingredient`).toBe(true);
    }
  });

  it("egg recipes contain egg and no meat/seafood", () => {
    const meat = new Set(["chicken-breast", "mutton", "fish", "prawn"]);
    for (const r of RECIPES.filter((x) => x.diet === "egg")) {
      expect(
        r.ingredients.some((i) => i.ingredientId === "egg"),
        `${r.id} declared egg but has no egg`,
      ).toBe(true);
      for (const ing of r.ingredients) {
        expect(meat.has(ing.ingredientId), `${r.id} egg but has ${ing.ingredientId}`).toBe(false);
      }
    }
  });
});

describe("diet filtering — discovery never betrays the filter", () => {
  it("dietType veg never returns non-veg recipes", () => {
    const results = filterRecipes({ dietType: "veg" });
    expect(results.length).toBeGreaterThan(50);
    for (const r of results) expect(r.diet).toBe("veg");
  });

  it("dietType non_veg includes egg recipes but never veg recipes", () => {
    const results = filterRecipes({ dietType: "non_veg" });
    expect(results.length).toBeGreaterThan(30);
    for (const r of results) expect(r.diet).not.toBe("veg");
    expect(results.some((r) => r.diet === "egg")).toBe(true);
    expect(results.some((r) => r.diet === "nonveg")).toBe(true);
  });

  it("no dietType filter returns everything unchanged", () => {
    expect(filterRecipes({}).length).toBe(RECIPES.length);
    expect(filterRecipes({ dietType: undefined }).length).toBe(RECIPES.length);
  });

  it("diet + time filters compose (VEG + under 30 min)", () => {
    const results = filterRecipes({ dietType: "veg", maxTime: 30 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.diet).toBe("veg");
      expect(r.timeMin).toBeLessThanOrEqual(30);
    }
  });

  it("diet + budget filters compose (NON-VEG budget)", () => {
    const results = filterRecipes({ dietType: "non_veg", maxCost: 200 });
    for (const r of results) {
      expect(r.diet).not.toBe("veg");
    }
    // The composition must not silently degrade to veg-only results
    expect(results.some((r) => r.diet === "nonveg")).toBe(true);
  });

  it("rich 3-way diet filter still works (egg kept distinct)", () => {
    const egg = filterRecipes({ diet: "egg" });
    expect(egg.length).toBeGreaterThan(0);
    for (const r of egg) expect(r.diet).toBe("egg");
  });
});

describe("diet in text search — structural, not just string matching", () => {
  it('"veg" queries return veg recipes', () => {
    const results = searchRecipes("veg breakfast");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.diet).toBe("veg");
  });

  it('"non veg" queries return no veg recipes — even though they contain "veg"', () => {
    for (const q of ["non veg", "nonveg", "non-veg"]) {
      const results = searchRecipes(q);
      expect(results.length, `query: ${q}`).toBeGreaterThan(0);
      for (const r of results) expect(r.diet, `query: ${q}`).not.toBe("veg");
    }
  });

  it("meat queries return non-veg recipes", () => {
    for (const q of ["chicken", "mutton", "fish", "prawn"]) {
      const results = searchRecipes(q);
      expect(results.length, `query: ${q}`).toBeGreaterThan(0);
      for (const r of results) expect(r.diet, `query: ${q}`).not.toBe("veg");
    }
  });

  it("gibberish still returns zero results", () => {
    expect(searchRecipes("xkcdqwertyzxc").length).toBe(0);
  });
});
