// Tests for the curated dataset itself. A typo in a help id or a dangling
// ingredient reference is invisible in the UI and fatal for trust — these
// tests make it fail loudly instead.

import { describe, expect, it } from "vitest";
import { computeNutrition, computeCostPerServing } from "@/lib/engine/nutrition";
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

  // ── Production-readiness invariants ─────────────────────────
  // The UI renders engine-computed values; a declared snapshot that drifts
  // from the engine is a lie on screen. These tests keep them locked.

  it("declared nutrition matches the engine for every recipe", () => {
    for (const r of RECIPES) {
      const n = computeNutrition(r, r.servings);
      expect(r.nutritionPerServing.calories, `${r.id} calories`).toBe(n.calories);
      expect(r.nutritionPerServing.protein, `${r.id} protein`).toBe(n.protein);
      expect(r.nutritionPerServing.carbs, `${r.id} carbs`).toBe(n.carbs);
      expect(r.nutritionPerServing.fat, `${r.id} fat`).toBe(n.fat);
    }
  });

  it("tags are derived, not decorative", () => {
    for (const r of RECIPES) {
      const n = computeNutrition(r, r.servings);
      const cost = computeCostPerServing(r, r.servings);
      expect(r.tags.includes("high-protein"), `${r.id} high-protein (${n.protein}g)`).toBe(n.protein >= 20);
      expect(r.tags.includes("budget"), `${r.id} budget (₹${cost})`).toBe(cost <= 35);
      expect(r.tags.includes("quick"), `${r.id} quick (${r.timeMin}min)`).toBe(r.timeMin <= 20);
    }
  });

  it("per-serving estimates stay in honest ranges", () => {
    for (const r of RECIPES) {
      const n = computeNutrition(r, r.servings);
      const cost = computeCostPerServing(r, r.servings);
      // 67 kcal masala-chaas is honest — a drink, not a meal
      expect(n.calories, `${r.id} kcal`).toBeGreaterThanOrEqual(60);
      expect(n.calories, `${r.id} kcal`).toBeLessThanOrEqual(950);
      expect(n.protein, `${r.id} protein`).toBeGreaterThanOrEqual(2);
      expect(cost, `${r.id} cost`).toBeGreaterThanOrEqual(10);
      expect(cost, `${r.id} cost`).toBeLessThanOrEqual(220);
    }
  });

  it("pressure-cooker steps carry a steam-release safety note", () => {
    for (const r of RECIPES) {
      for (const s of r.steps) {
        if (/pressure-cook|pressure cook|\bwhistle/i.test(`${s.title} ${s.text}`)) {
          expect(
            s.safety,
            `${r.id}/${s.id} must warn about pressure release`,
          ).toBeDefined();
          expect(s.safety?.length ?? 0).toBeGreaterThan(20);
        }
      }
    }
  });

  it("shallow-fry steps warn about water-in-oil spatter", () => {
    for (const r of RECIPES) {
      for (const s of r.steps) {
        if (/shallow-fry|shallow fry/i.test(`${s.title} ${s.text}`)) {
          expect(s.safety, `${r.id}/${s.id} must warn about spatter`).toBeDefined();
        }
      }
    }
  });
});
