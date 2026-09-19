// ─────────────────────────────────────────────────────────────
// RUCHI — recipe index
// ─────────────────────────────────────────────────────────────
// Combines the curated dataset and validates every recipe against the
// zod schema at import time. A malformed recipe fails fast in dev/build,
// never in front of a hungry user.

import { recipeSchema } from "@/lib/data/schemas";
import type { Recipe } from "@/lib/types";
import { RECIPES_A } from "./recipes-a";
import { RECIPES_B } from "./recipes-b";
import { RECIPES_C } from "./recipes-c";
import { RECIPES_D } from "./recipes-d";
import { RECIPES_E } from "./recipes-e";
import { RECIPES_F } from "./recipes-f";

function validate(recipes: Recipe[]): Recipe[] {
  return recipes.map((r, i) => {
    const parsed = recipeSchema.safeParse(r);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
        .join("; ");
      throw new Error(`[RUCHI] Invalid recipe #${i} (${r.id ?? "?"}): ${issues}`);
    }
    return parsed.data;
  });
}

export const RECIPES: Recipe[] = [
  ...validate(RECIPES_A),
  ...validate(RECIPES_B),
  ...validate(RECIPES_C),
  ...validate(RECIPES_D),
  ...validate(RECIPES_E),
  ...validate(RECIPES_F),
];

const byId = new Map(RECIPES.map((r) => [r.id, r]));

export function getRecipe(id: string): Recipe | undefined {
  return byId.get(id);
}

export const RECIPE_COUNT = RECIPES.length;
