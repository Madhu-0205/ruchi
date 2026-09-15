// Tests for lib/engine/nutrition — all values are estimates, but the
// estimates must be internally consistent and scale sanely with servings.

import { describe, expect, it } from "vitest";
import { computeCost, computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import { getRecipe, RECIPES } from "@/lib/data/recipes";

const bhurji = getRecipe("paneer-egg-bhurji");
const friedRice = getRecipe("egg-fried-rice");

describe("computeNutrition", () => {
  it("lands near the declared values for the hero recipe (estimate tolerance)", () => {
    if (!bhurji) throw new Error("paneer-egg-bhurji missing from dataset");
    const n = computeNutrition(bhurji, 2);
    // declared: 40g protein / 540 kcal per serving
    expect(n.protein).toBeGreaterThan(30);
    expect(n.protein).toBeLessThan(48);
    expect(n.calories).toBeGreaterThan(440);
    expect(n.calories).toBeLessThan(650);
  });

  it("protein per serving is roughly servings-independent", () => {
    if (!bhurji) throw new Error("paneer-egg-bhurji missing from dataset");
    const n1 = computeNutrition(bhurji, 1);
    const n4 = computeNutrition(bhurji, 4);
    expect(Math.abs(n4.protein - n1.protein)).toBeLessThanOrEqual(2);
  });

  it("total protein grows with servings", () => {
    if (!bhurji) throw new Error("paneer-egg-bhurji missing from dataset");
    // 4 servings use ~4× the protein-bearing ingredients
    expect(computeNutrition(bhurji, 4).protein).toBeGreaterThan(0);
  });

  it("never returns negative or absurd values", () => {
    for (const r of RECIPES) {
      const n = computeNutrition(r, 2);
      expect(n.calories).toBeGreaterThan(50);
      expect(n.calories).toBeLessThan(2000);
      expect(n.protein).toBeGreaterThan(0);
      expect(n.fat).toBeGreaterThanOrEqual(0);
      expect(n.carbs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computeCost", () => {
  it("scales roughly linearly with servings", () => {
    if (!friedRice) throw new Error("egg-fried-rice missing from dataset");
    const c1 = computeCost(friedRice, 1);
    const c2 = computeCost(friedRice, 2);
    const c4 = computeCost(friedRice, 4);
    expect(c2).toBeGreaterThanOrEqual(c1);
    expect(c4).toBeGreaterThan(c2);
    // rounding + fixed non-scalable items (oil/spices) keep 2× from being exact
    expect(Math.abs(c2 - c1 * 2)).toBeLessThanOrEqual(8);
  });

  it("per-serving cost matches the total/serving contract", () => {
    for (const r of RECIPES) {
      expect(computeCostPerServing(r, 3)).toBe(Math.round(computeCost(r, 3) / 3));
    }
  });

  it("keeps costs in believable rupee territory", () => {
    for (const r of RECIPES) {
      const perServing = computeCostPerServing(r, 2);
      expect(perServing).toBeGreaterThan(10);
      expect(perServing).toBeLessThan(400);
    }
  });

  it("upholds the product promise: cooking beats delivery for hero dishes", () => {
    if (!bhurji || !friedRice) throw new Error("hero recipes missing");
    expect(computeCostPerServing(bhurji, 2)).toBeLessThan(bhurji.deliveryCompare.cost / 2);
    expect(computeCostPerServing(friedRice, 2)).toBeLessThan(friedRice.deliveryCompare.cost / 2);
  });
});
