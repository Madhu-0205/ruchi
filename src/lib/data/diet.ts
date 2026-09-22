// ─────────────────────────────────────────────────────────────
// RUCHI — dietary classification (veg / non-veg)
// ─────────────────────────────────────────────────────────────
// Single source of truth for the binary Veg / Non-Veg view, derived from
// the authoritative 3-way `diet` field on every recipe. Classification is
// VERIFIED against ingredient data, never trusted from recipe names —
// a recipe labelled veg that contains meat fails validation, and a
// non-veg recipe must contain at least one animal-protein ingredient.
//
// Egg policy: RUCHI follows the common Indian home convention — eggs are
// non-veg in the binary view. The richer `diet: "egg"` value is preserved
// so eggetarian users keep precise matches (see types/index.ts).

import { RECIPES } from "@/lib/data/recipes";
import type { DietType, Recipe } from "@/lib/types";

/** Ingredient ids that make a recipe non-vegetarian (meat & seafood). */
const MEAT_INGREDIENTS = new Set(["chicken-breast", "mutton", "fish", "prawn"]);

/** True when the ingredient id is meat or seafood. */
export function isMeatIngredient(ingredientId: string): boolean {
  return MEAT_INGREDIENTS.has(ingredientId);
}

/** Binary dietary type of a recipe — derived, never stored twice. */
export function dietTypeOf(recipe: Recipe): DietType {
  return recipe.diet === "veg" ? "veg" : "non_veg";
}

/**
 * Validate the whole catalog's diet classification against its ingredients.
 * Returns human-readable problems; an empty array means every recipe is
 * correctly classified:
 *  - veg recipes must contain NO meat ingredient
 *  - egg recipes must contain NO meat ingredient (eggs are not meat)
 *  - nonveg recipes must contain at least one meat ingredient
 */
export function validateDietClassification(recipes: Recipe[] = RECIPES): string[] {
  const problems: string[] = [];
  for (const r of recipes) {
    const meat = r.ingredients.filter((ri) => isMeatIngredient(ri.ingredientId));
    if (r.diet === "veg" && meat.length > 0) {
      problems.push(`${r.id}: diet "veg" but contains ${meat.map((m) => m.ingredientId).join(", ")}`);
    }
    if (r.diet === "egg" && meat.length > 0) {
      problems.push(`${r.id}: diet "egg" but contains ${meat.map((m) => m.ingredientId).join(", ")}`);
    }
    if (r.diet === "nonveg" && meat.length === 0) {
      problems.push(`${r.id}: diet "nonveg" but no meat/seafood ingredient found`);
    }
  }
  return problems;
}
