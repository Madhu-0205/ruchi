// ─────────────────────────────────────────────────────────────
// RUCHI — Discover taxonomy (single source of truth)
// ─────────────────────────────────────────────────────────────
// Every Discover category is backed by REAL recipe metadata through one
// deterministic predicate. No hand-maintained lists, no empty categories:
// a category exists on screen only when the catalog actually stocks it
// (MIN_CATEGORY_RECIPES), and its ordering is a pure function of the data.
//
// Groups mirror the product's progressive-discovery structure:
//   mood       — "What's your mood?" quick picks
//   meal       — by meal slot
//   ingredient — by the ingredient doing the heavy lifting
//   style      — by cooking style / budget / cuisine

import { RECIPES } from "./recipes";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import type { Recipe } from "@/lib/types";

export type DiscoverGroupId = "mood" | "meal" | "ingredient" | "style";

/** Curated, deterministic orderings — never dataset whim. */
export type RecipeOrder = "time" | "protein" | "cost" | "catalog";

export interface DiscoverCategory {
  id: string;
  label: string;
  blurb: string;
  group: DiscoverGroupId;
  /** Deterministic membership — the ONLY source of truth for this category. */
  matches: (r: Recipe) => boolean;
  order: RecipeOrder;
}

/** A category is worth a slot on screen only with a real shelf behind it. */
export const MIN_CATEGORY_RECIPES = 5;

const proteinOf = (r: Recipe) => computeNutrition(r, 1).protein;
const costOf = (r: Recipe) => computeCostPerServing(r, 1);

/** Core (non-optional) ingredient use — optional garnishes don't define a dish. */
const usesCore = (r: Recipe, ingredientId: string) =>
  r.ingredients.some((ri) => ri.ingredientId === ingredientId && !ri.optional);

const SOUTH_INDIAN = /south|kerala|karnataka|tamil|andhra/i;
const NORTH_INDIAN = /north|punjabi|mughlai/i;

export const DISCOVER_CATEGORIES: DiscoverCategory[] = [
  // ── Mood — the quick picks ────────────────────────────────
  {
    id: "quick-easy",
    label: "Quick & Easy",
    blurb: "Real food on the table before delivery could even find you.",
    group: "mood",
    matches: (r) => r.timeMin <= 20 && r.difficulty === "easy",
    order: "time",
  },
  {
    id: "high-protein",
    label: "High Protein",
    blurb: "20g+ per serving. Gains included.",
    group: "mood",
    matches: (r) => proteinOf(r) >= 20,
    order: "protein",
  },
  {
    id: "comfort",
    label: "Comfort Food",
    blurb: "The classics, done properly.",
    group: "mood",
    matches: (r) => r.tags.includes("comfort"),
    order: "catalog",
  },
  {
    id: "healthy",
    label: "Healthy",
    blurb: "Balanced, not sad.",
    group: "mood",
    matches: (r) => r.tags.includes("healthy"),
    order: "protein",
  },
  // ("Late Night" was audited out: snack ∧ ≤15min is a strict subset of
  // Quick & Easy — two labels for the same shelf. Snacks + the ≤15min
  // filter keeps the mood reachable without the duplicate.)

  // ── Meal ──────────────────────────────────────────────────
  {
    id: "breakfast",
    label: "Breakfast",
    blurb: "Start the day fed, not frantic.",
    group: "meal",
    matches: (r) => r.category === "breakfast",
    order: "time",
  },
  {
    id: "lunch",
    label: "Lunch",
    blurb: "The midday decision, already made.",
    group: "meal",
    matches: (r) => r.category === "lunch",
    order: "time",
  },
  {
    id: "dinner",
    label: "Dinner",
    blurb: "Tonight's cooking, decided early.",
    group: "meal",
    matches: (r) => r.category === "dinner",
    order: "protein",
  },
  {
    id: "snacks",
    label: "Snacks",
    blurb: "Small pan, big payoff.",
    group: "meal",
    matches: (r) => r.category === "snack",
    order: "time",
  },
  {
    id: "drinks",
    label: "Drinks",
    blurb: "Chai, chaas, coffee — the supporting cast.",
    group: "meal",
    matches: (r) => r.category === "drink",
    order: "catalog",
  },

  // ── Ingredient ────────────────────────────────────────────
  {
    id: "egg",
    label: "Egg",
    blurb: "For the egg-first household.",
    group: "ingredient",
    matches: (r) => r.diet === "egg",
    order: "protein",
  },
  {
    id: "paneer",
    label: "Paneer",
    blurb: "The quiet hero of the Indian kitchen.",
    group: "ingredient",
    matches: (r) => usesCore(r, "paneer"),
    order: "protein",
  },
  {
    id: "chicken",
    label: "Chicken",
    blurb: "From 20-minute stir-fries to Sunday biryani.",
    group: "ingredient",
    matches: (r) => usesCore(r, "chicken-breast"),
    order: "protein",
  },
  {
    id: "rice",
    label: "Rice",
    blurb: "The grain that never says no.",
    group: "ingredient",
    matches: (r) => usesCore(r, "rice"),
    order: "time",
  },
  {
    id: "noodles",
    label: "Noodles & Maggi",
    blurb: "Instant, stir-fried, upgraded — the two-minute family.",
    group: "ingredient",
    matches: (r) => usesCore(r, "noodles"),
    order: "time",
  },

  // ── Style ─────────────────────────────────────────────────
  {
    id: "budget",
    label: "Budget Friendly",
    blurb: "Full plates, small bill. Estimated cost.",
    group: "style",
    matches: (r) => r.tags.includes("budget"),
    order: "cost",
  },
  {
    id: "beginner",
    label: "Beginner Friendly",
    blurb: "Zero cooking experience safe.",
    group: "style",
    matches: (r) => r.difficulty === "easy",
    order: "time",
  },
  {
    id: "one-pan",
    label: "One-Pan",
    blurb: "One pan. Fewer dishes. Same dinner.",
    group: "style",
    matches: (r) =>
      r.equipment.every((e) => ["stove", "pan", "kadai", "none"].includes(e)),
    order: "time",
  },
  {
    id: "south-indian",
    label: "South Indian",
    blurb: "Idli's extended family. Fermented, steamed, wonderful.",
    group: "style",
    matches: (r) => SOUTH_INDIAN.test(r.cuisine),
    order: "catalog",
  },
  {
    id: "north-indian",
    label: "North Indian",
    blurb: "Dal makhani country. Rich, slow, celebratory.",
    group: "style",
    matches: (r) => NORTH_INDIAN.test(r.cuisine),
    order: "catalog",
  },
  {
    id: "vegetarian",
    label: "Vegetarian",
    blurb: "The meat-free majority, done properly.",
    group: "style",
    matches: (r) => r.diet === "veg",
    order: "protein",
  },
];

/** A category resolved against the real catalog: deterministic shelf + count. */
export interface ResolvedCategory extends Pick<
  DiscoverCategory,
  "id" | "label" | "blurb" | "group" | "order"
> {
  recipes: Recipe[];
}

function orderRecipes(recipes: Recipe[], order: RecipeOrder): Recipe[] {
  const byName = (a: Recipe, b: Recipe) => a.name.localeCompare(b.name);
  switch (order) {
    case "time":
      return [...recipes].sort((a, b) => a.timeMin - b.timeMin || byName(a, b));
    case "protein":
      return [...recipes].sort((a, b) => proteinOf(b) - proteinOf(a) || byName(a, b));
    case "cost":
      return [...recipes].sort((a, b) => costOf(a) - costOf(b) || byName(a, b));
    case "catalog":
      return recipes;
  }
}

/**
 * Resolve every declared category against the catalog. Categories with
 * fewer than MIN_CATEGORY_RECIPES real members are dropped — an
 * understocked shelf is worse than no shelf (spec §19: never an empty or
 * token category). Membership and ordering are pure functions of the data.
 */
export function discoverCategories(): ResolvedCategory[] {
  const resolved: ResolvedCategory[] = [];
  for (const c of DISCOVER_CATEGORIES) {
    const recipes = orderRecipes(RECIPES.filter((r) => c.matches(r)), c.order);
    if (recipes.length < MIN_CATEGORY_RECIPES) continue;
    resolved.push({ id: c.id, label: c.label, blurb: c.blurb, group: c.group, order: c.order, recipes });
  }
  return resolved;
}

/** One category by id (resolved) — undefined when the catalog can't stock it. */
export function discoverCategoryById(id: string): ResolvedCategory | undefined {
  return discoverCategories().find((c) => c.id === id);
}

/** The declared-but-understocked category ids — useful for tests + audits. */
export function understockedCategoryIds(): string[] {
  return DISCOVER_CATEGORIES.filter(
    (c) => RECIPES.filter((r) => c.matches(r)).length < MIN_CATEGORY_RECIPES,
  ).map((c) => c.id);
}
