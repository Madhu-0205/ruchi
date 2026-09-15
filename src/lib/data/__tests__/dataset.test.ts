// Tests for the curated dataset itself. A typo in a help id or a dangling
// ingredient reference is invisible in the UI and fatal for trust — these
// tests make it fail loudly instead.

import { describe, expect, it } from "vitest";
import { INGREDIENTS, findIngredient, isAssumedPantry, ASSUMED_PANTRY } from "@/lib/data/ingredients";
import { getRecipe, RECIPES, RECIPE_COUNT } from "@/lib/data/recipes";
import { HELP_LIBRARY } from "@/lib/data/help";

describe("ingredient catalog", () => {
  it("has unique ids", () => {
    const ids = INGREDIENTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every ingredient has aliases (search depends on them)", () => {
    for (const ing of INGREDIENTS) {
      expect(ing.aliases.length).toBeGreaterThan(0);
      // water is free and salt has no calories — both legitimate zeros
      if (ing.id !== "water") {
        expect(ing.costPer100).toBeGreaterThan(0);
      }
      if (ing.id !== "water" && ing.id !== "salt") {
        expect(ing.nutritionPer100.kcal).toBeGreaterThan(0);
      }
      expect(ing.nutritionPer100.protein).toBeGreaterThanOrEqual(0);
    }
  });

  it("count-based staples carry an avg piece weight", () => {
    expect(findIngredient("egg")?.avgPieceG).toBeGreaterThan(0);
    expect(findIngredient("onion")?.avgPieceG).toBeGreaterThan(0);
  });

  it("assumed pantry refers to real ingredients", () => {
    for (const id of ASSUMED_PANTRY) {
      expect(findIngredient(id), `pantry id ${id} must exist in the catalog`).toBeDefined();
    }
    expect(isAssumedPantry("salt")).toBe(true);
    expect(isAssumedPantry("paneer")).toBe(false);
  });
});

describe("recipe dataset", () => {
  it("ships at least 24 validated recipes", () => {
    expect(RECIPE_COUNT).toBeGreaterThanOrEqual(24);
    expect(RECIPES.length).toBe(RECIPE_COUNT);
  });

  it("has unique recipe ids", () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every ingredient reference resolves", () => {
    for (const r of RECIPES) {
      for (const ri of r.ingredients) {
        expect(
          findIngredient(ri.ingredientId),
          `${r.id} references unknown ingredient ${ri.ingredientId}`,
        ).toBeDefined();
      }
    }
  });

  it("every recipe is written for the 2-serving baseline", () => {
    // Step-text scaling and formatQuantity both assume this baseline.
    for (const r of RECIPES) expect(r.servings).toBe(2);
  });

  it("every step has a look-for cue — the core product promise", () => {
    for (const r of RECIPES) {
      expect(r.steps.length).toBeGreaterThan(0);
      for (const s of r.steps) {
        expect(s.lookFor.trim().length).toBeGreaterThan(0);
        expect(s.title.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("every helpId exists in the help library", () => {
    for (const r of RECIPES) {
      for (const s of r.steps) {
        for (const id of s.helpIds ?? []) {
          expect(HELP_LIBRARY[id], `${r.id}/${s.id} references unknown help id "${id}"`).toBeDefined();
        }
      }
    }
  });

  it("substitutions reference known ingredients", () => {
    for (const r of RECIPES) {
      for (const sub of r.substitutions) {
        expect(findIngredient(sub.missingId), `${r.id} substitution ${sub.missingId}`).toBeDefined();
        if (sub.useId) expect(findIngredient(sub.useId)).toBeDefined();
      }
    }
  });

  it("nutrition and delivery data are present and sane", () => {
    for (const r of RECIPES) {
      expect(r.nutritionPerServing.protein).toBeGreaterThan(0);
      expect(r.nutritionPerServing.calories).toBeGreaterThan(50);
      expect(r.deliveryCompare.cost).toBeGreaterThan(0);
      expect(r.deliveryCompare.name.length).toBeGreaterThan(0);
    }
  });

  it("high-protein dishes genuinely are high protein", () => {
    for (const r of RECIPES) {
      if (r.tags.includes("high-protein")) {
        expect(r.nutritionPerServing.protein).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("getRecipe resolves by id", () => {
    expect(getRecipe("paneer-egg-bhurji")?.name).toBe("Paneer Egg Bhurji");
    expect(getRecipe("does-not-exist")).toBeUndefined();
  });
});
