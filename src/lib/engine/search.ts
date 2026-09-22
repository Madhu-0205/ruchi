// ─────────────────────────────────────────────────────────────
// RUCHI — recipe search + shared filters (pure functions)
// ─────────────────────────────────────────────────────────────
// Structured search over the curated catalog — names, ingredients,
// tags, categories, difficulty. No AI involved: search must work
// offline and instantly. Handles natural phrases like "under 100",
// "15 min", "high protein", "breakfast".

import { RECIPES } from "@/lib/data/recipes";
import { INGREDIENTS, findIngredient } from "@/lib/data/ingredients";
import { dietTypeOf } from "@/lib/data/diet";
import { computeCostPerServing, computeNutrition } from "./nutrition";
import type { DietType, Recipe, RecipeCategory } from "@/lib/types";

export interface RecipeFilters {
  category?: RecipeCategory | "all";
  /** Rich 3-way filter (egg kept distinct for eggetarian users). */
  diet?: "veg" | "egg" | "nonveg" | "all";
  /** Binary Veg / Non-Veg filter. Non-veg INCLUDES egg (product policy). */
  dietType?: DietType | "all";
  maxTime?: number; // 0 = any
  maxCost?: number; // 0 = any
  difficulty?: "easy" | "medium" | "all";
  intents?: string[]; // empty = any
}

/** Apply structured filters to the catalog. */
export function filterRecipes(filters: RecipeFilters): Recipe[] {
  return RECIPES.filter((r) => {
    if (filters.category && filters.category !== "all" && r.category !== filters.category)
      return false;
    if (filters.diet && filters.diet !== "all" && r.diet !== filters.diet) return false;
    if (
      filters.dietType &&
      filters.dietType !== "all" &&
      dietTypeOf(r) !== filters.dietType
    )
      return false;
    if (filters.maxTime && filters.maxTime > 0 && r.timeMin > filters.maxTime) return false;
    if (filters.maxCost && filters.maxCost > 0 && computeCostPerServing(r, 1) > filters.maxCost)
      return false;
    if (filters.difficulty && filters.difficulty !== "all" && r.difficulty !== filters.difficulty)
      return false;
    if (filters.intents && filters.intents.length > 0) {
      const has = filters.intents.every((t) => r.tags.includes(t as Recipe["tags"][number]));
      if (!has) return false;
    }
    return true;
  });
}

// Pre-built lowercase lookup once per module load — search stays O(1)-ish
// per query against 100+ recipes.
const INGREDIENT_ALIASES = new Map<string, string>(); // alias → ingredient id
for (const ing of INGREDIENTS) {
  INGREDIENT_ALIASES.set(ing.id, ing.id);
  INGREDIENT_ALIASES.set(ing.name.toLowerCase(), ing.id);
  for (const a of ing.aliases) INGREDIENT_ALIASES.set(a.toLowerCase(), ing.id);
}

function ingredientIdFromQuery(q: string): string | undefined {
  const direct = INGREDIENT_ALIASES.get(q);
  if (direct) return direct;
  // "eggs" → "egg": try singular
  if (q.endsWith("s")) {
    const singular = INGREDIENT_ALIASES.get(q.slice(0, -1));
    if (singular) return singular;
  }
  // substring match on names ("cotta..." → paneer via alias)
  for (const [alias, id] of INGREDIENT_ALIASES) {
    if (alias.length >= 4 && (q.includes(alias) || alias.includes(q))) return id;
  }
  return undefined;
}

/**
 * Natural-language-ish search over recipes. Understands:
 *  - names ("paneer bhurji"), partial names ("bhurji")
 *  - ingredient queries ("egg", "paneer", "mushroom")
 *  - time ("15 min", "quick")
 *  - budget ("under 100", "cheap", "budget")
 *  - protein ("high protein", "protein")
 *  - categories ("breakfast", "dinner", "snack", "drink")
 *  - diet ("veg", "chicken" → nonveg/egg filters via ingredients)
 */
export function searchRecipes(query: string): Recipe[] {
  const q = query.trim().toLowerCase();
  if (!q) return RECIPES;

  // Extract structured intent from the phrase.
  const wantsTime = /(\d+)\s*min/.exec(q)?.[1];
  const wantsQuick = /\b(quick|fast)\b/.test(q);
  const wantsBudget = /\b(under\s*(?:₹)?\s*(\d+)|cheap|budget)\b/.exec(q)?.[2];
  const wantsProtein = /\b(high\s*protein|protein)\b/.test(q);
  const wantsBreakfast = /\bbreakfast\b/.test(q);
  const wantsLunch = /\blunch\b/.test(q);
  const wantsDinner = /\bdinner\b/.test(q);
  const wantsSnack = /\b(snack|snacks)\b/.test(q);
  const wantsDrink = /\b(drink|drinks|chai|coffee|lassi|smoothie)\b/.test(q);
  const wantsVeg = /\bveg(etarian)?\b/.test(q);
  // "non veg", "nonveg", "non-veg" — the binary filter (egg included).
  const wantsNonVeg = /\bnon[\s-]?veg\b|\bnonveg\b/.test(q);
  const wantsEasy = /\b(easy|beginner|simple)\b/.test(q);

  // Remaining words after removing known structural tokens.
  const structural = new Set(
    (
      "min minute minutes under quick fast cheap budget high protein breakfast lunch dinner " +
      "snack snacks drink drinks chai coffee lassi smoothie veg vegetarian nonveg non-veg " +
      "easy beginner simple the a an for with and"
    ).split(" "),
  );
  const words = q
    .split(/[\s,]+/)
    .map((w) => w.replace(/[₹.]/g, ""))
    .filter((w) => w.length > 1 && !structural.has(w) && !/^\d+$/.test(w));

  // Ingredient words: "egg paneer" → matches recipes using either/any.
  const ingredientIds = new Set<string>();
  for (const w of words) {
    const id = ingredientIdFromQuery(w);
    if (id) ingredientIds.add(id);
  }
  const leftoverWords = words.filter((w) => !ingredientIdFromQuery(w));

  // Dietary intent is structural: "veg" / "non veg" HARD-FILTER the pool
  // (never a mere boost — "veg breakfast" must never surface butter
  // chicken). "non veg" must win over the "veg" substring it contains.
  // All other intents boost within the filtered pool.
  const pool = wantsNonVeg
    ? RECIPES.filter((r) => dietTypeOf(r) === "non_veg")
    : wantsVeg
      ? RECIPES.filter((r) => r.diet === "veg")
      : RECIPES;

  return pool.map((r) => {
    let score = 0;
    const name = r.name.toLowerCase();

    // Name matches dominate.
    if (name === q) score += 100;
    else if (name.includes(q)) score += 60;
    else {
      // word-level name hits
      for (const w of words) if (name.includes(w)) score += 20;
    }
    if (r.teluguName?.toLowerCase().includes(q)) score += 40;

    // Ingredient matches.
    for (const id of ingredientIds) {
      if (r.ingredients.some((ri) => ri.ingredientId === id)) score += 25;
    }
    // leftover words try description/tags
    for (const w of leftoverWords) {
      if (r.description.toLowerCase().includes(w)) score += 8;
      if (r.cuisine.toLowerCase().includes(w)) score += 6;
      if (r.tags.some((t) => t.includes(w))) score += 6;
    }

    // Structured intent boosts — these widen, not filter, but rank hard.
    if (wantsQuick && r.timeMin <= 15) score += 18;
    if (wantsTime && r.timeMin <= parseInt(wantsTime ?? "0", 10)) score += 18;
    if (wantsBudget) {
      const cost = computeCostPerServing(r, 1);
      if (cost <= parseInt(wantsBudget ?? "0", 10)) score += 18;
      if (r.tags.includes("budget")) score += 6;
    }
    if (wantsProtein) {
      if (r.tags.includes("high-protein")) score += 18;
      else if (computeNutrition(r, 1).protein >= 15) score += 8;
    }
    if (wantsBreakfast && r.category === "breakfast") score += 18;
    if (wantsLunch && r.category === "lunch") score += 18;
    if (wantsDinner && r.category === "dinner") score += 18;
    if (wantsSnack && r.category === "snack") score += 18;
    if (wantsDrink && r.category === "drink") score += 18;
    if (wantsVeg && r.diet === "veg") score += 12;
    if (wantsNonVeg && dietTypeOf(r) === "non_veg") score += 12;
    if (wantsEasy && r.difficulty === "easy") score += 10;

    return { r, score };
  })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ r }) => r);
}

/** Ingredient-name suggestions for search-as-you-type. */
export function searchIngredientNames(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return INGREDIENTS.filter((i) =>
    i.name.toLowerCase().includes(q) || i.aliases.some((a) => a.toLowerCase().includes(q)),
  )
    .slice(0, 6)
    .map((i) => findIngredient(i.id)?.name ?? i.name);
}
