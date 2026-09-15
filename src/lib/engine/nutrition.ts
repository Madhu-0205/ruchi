// ─────────────────────────────────────────────────────────────
// RUCHI — nutrition + cost estimation
// ─────────────────────────────────────────────────────────────
// Computed from the per-100g reference tables. Always presented as
// estimates in the UI, never medical or financial fact.

import { findIngredient } from "@/lib/data/ingredients";
import type { Ingredient, Nutrition, Recipe, RecipeIngredient } from "@/lib/types";
import { quantityForGrams } from "./units";

function nutritionForQty(
  ri: RecipeIngredient,
  servings: number,
  ing: Ingredient,
): { kcal: number; protein: number; carbs: number; fat: number; fiber: number } {
  const grams = quantityForGrams(ri, servings, ing);
  const f = grams / 100;
  const n = ing.nutritionPer100;
  return {
    kcal: n.kcal * f,
    protein: n.protein * f,
    carbs: n.carbs * f,
    fat: n.fat * f,
    fiber: (n.fiber ?? 0) * f,
  };
}

/** Recompute a recipe's per-serving nutrition for a given serving count. */
export function computeNutrition(recipe: Recipe, servings: number): Nutrition {
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const ri of recipe.ingredients) {
    const ing = findIngredient(ri.ingredientId);
    if (!ing) continue;
    const n = nutritionForQty(ri, servings, ing);
    total.kcal += n.kcal;
    total.protein += n.protein;
    total.carbs += n.carbs;
    total.fat += n.fat;
    total.fiber += n.fiber;
  }
  return {
    calories: Math.round(total.kcal / servings),
    protein: Math.round(total.protein / servings),
    carbs: Math.round(total.carbs / servings),
    fat: Math.round(total.fat / servings),
    fiber: Math.round(total.fiber / servings * 10) / 10,
  };
}

/** Total ingredient cost in ₹ for the whole cook (scaled by servings). */
export function computeCost(recipe: Recipe, servings: number): number {
  let total = 0;
  for (const ri of recipe.ingredients) {
    const ing = findIngredient(ri.ingredientId);
    if (!ing) continue;
    const grams = quantityForGrams(ri, servings, ing);
    total += (grams / 100) * ing.costPer100;
  }
  return Math.round(total);
}

/** Per-serving cost. */
export function computeCostPerServing(recipe: Recipe, servings: number): number {
  return Math.round(computeCost(recipe, servings) / servings);
}
