// ─────────────────────────────────────────────────────────────
// RUCHI — matching engine
// ─────────────────────────────────────────────────────────────
// Deterministic recommendations: score every recipe against what the user
// has, then return 3–4. The AI layer re-ranks within a schema-validated
// envelope — it never invents recipes for the MVP dataset flow.

import { RECIPES } from "@/lib/data/recipes";
import { findIngredient, isAssumedPantry } from "@/lib/data/ingredients";
import type { Intent, Recipe } from "@/lib/types";
import { computeCostPerServing, computeNutrition } from "./nutrition";

export interface MatchFilters {
  hasIds: string[]; // ingredient ids the user has
  intents: Intent[];
  timeMax: number; // 0 = no rush
  budgetMax: number; // 0 = no limit
  servings: number;
  diet: "vegetarian" | "eggetarian" | "non-vegetarian";
}

export interface MatchScore {
  recipe: Recipe;
  score: number;
  missing: string[]; // core (non-optional) ingredient ids not in the kitchen
  missingCount: number;
  reasons: string[]; // human-readable why-lines
  protein: number;
}

export function matchRecipes(f: MatchFilters): MatchScore[] {
  // Assumed pantry: salt, oil and basic spices never block a match.
  const has = new Set(f.hasIds);
  const intents = new Set(f.intents);
  const scores: MatchScore[] = [];

  for (const r of RECIPES) {
    // Diet gate
    if (f.diet === "vegetarian" && r.diet === "nonveg") continue;
    if (f.diet === "eggetarian" && r.diet === "nonveg") continue;

    // Time gate — a hard limit: a 30-min dish is useless to someone with
    // 10 minutes, however well it scores.
    const timeFit = f.timeMax === 0 || r.timeMin <= f.timeMax;
    // Budget gate
    const cost = computeCostPerServing(r, f.servings);
    const budgetFit = f.budgetMax === 0 || cost <= f.budgetMax;

    // Ingredient overlap (assumed-pantry items count as owned)
    const core = r.ingredients.filter((i) => !i.optional && !isAssumedPantry(i.ingredientId));
    const coreHave = core.filter((i) => has.has(i.ingredientId));
    const missing = core
      .filter((i) => !has.has(i.ingredientId))
      .map((i) => i.ingredientId);
    const coverage = core.length === 0 ? 0 : coreHave.length / core.length;
    if (coverage < 0.5) continue; // need at least half the core ingredients

    // Reasons
    const reasons: string[] = [];
    if (missing.length === 0) reasons.push("You have everything");
    else reasons.push(`Only ${missing.length} item${missing.length > 1 ? "s" : ""} missing`);
    if (r.tags.includes("high-protein")) reasons.push("High protein");
    if (r.timeMin <= 15) reasons.push("15-min meal");

    // Score
    let score = coverage * 60; // up to 60 pts for coverage
    if (timeFit) score += 10;
    if (budgetFit) score += 8;
    let intentHits = 0;
    for (const t of r.tags) if (intents.has(t)) { score += 9; intentHits++; }
    if (intentHits >= 2) score += 6;
    if (r.difficulty === "easy") score += 5;
    if (missing.length === 0) score += 12; // cook-now bonus
    // Protein matters — up to +8 pts, and it breaks ties (high-protein
    // users should never see an 11g omelette above a 35g bhurji).
    const protein = computeNutrition(r, f.servings).protein;
    score += Math.min(8, (protein / 50) * 8);
    if (!budgetFit) score -= 14;

    scores.push({ recipe: r, score, missing, missingCount: missing.length, reasons, protein });
  }

  scores.sort((a, b) => b.score - a.score || b.protein - a.protein);
  return scores;
}

export interface Recommendation {
  recipe: Recipe;
  missing: string[];
  reason: string;
  /** Structured “why this one” lines for the card, e.g. "Uses 5 ingredients you have". */
  why: string[];
  usesCount: number;
  protein: number;
  costPerServing: number;
  minutes: number;
  difficulty: "easy" | "medium";
  /** Missing item names that are optional in the recipe — “don’t need it”. */
  notNeeded: string[];
}

const KITCHEN_MICROCOPY = [
  "Your kitchen is basically asking for this. 👀",
  "Your fridge called. It has dinner plans.",
  "This one's been waiting in your kitchen all day.",
  "Everything you need is already staring at you.",
  "Your future self will thank you for this meal.",
  "15 minutes of cooking > 30 minutes waiting for delivery.",
];

function findIngredientName(id: string): string {
  return findIngredient(id)?.name ?? id;
}

/** Build the “Why this one?” checklist for a match. */
export function whyThis(m: MatchScore, f: MatchFilters): string[] {
  const why: string[] = [];
  const n = computeNutrition(m.recipe, f.servings);
  const cost = computeCostPerServing(m.recipe, f.servings);
  // Same core definition as matching: non-optional, assumed-pantry excluded.
  const coreCount = m.recipe.ingredients.filter(
    (i) => !i.optional && !isAssumedPantry(i.ingredientId),
  ).length;

  why.push(
    m.missingCount === 0
      ? `Uses all ${coreCount} ingredients you have`
      : `Uses ${coreCount - m.missingCount} of ${coreCount} ingredients you already have`,
  );
  if (n.protein >= 30) why.push(`${n.protein}g protein — seriously filling`);
  else if (n.protein >= 20) why.push(`${n.protein}g protein`);
  if (m.recipe.timeMin <= 15) why.push(`${m.recipe.timeMin} minutes, faster than delivery`);
  else why.push(`${m.recipe.timeMin} minutes`);
  if (cost <= 100) why.push(`₹${cost} per serving — under ₹100`);
  else why.push(`₹${cost} per serving`);
  if (m.recipe.difficulty === "easy") why.push("Beginner friendly");
  return why;
}

/**
 * Top 3–4 recommendations with microcopy + structured why-lines.
 *
 * `aiPicks` (optional) is the AI's selection/order over the candidate list —
 * validated recipeIds only (enforced in lib/ai/recommendations.ts). The AI
 * reorders the deterministic top slice and can replace the "why" copy with
 * its matchReason lines; it can never introduce a recipe that didn't score.
 */
export function recommend(f: MatchFilters, aiPicks?: { recipeId: string; matchReason: string[] }[]): Recommendation[] {
  const ranked = matchRecipes(f);

  // Apply AI ordering (only ids present in the deterministic top slice).
  const byId = new Map(ranked.map((m) => [m.recipe.id, m]));
  const top: MatchScore[] = [];
  if (aiPicks && aiPicks.length > 0) {
    for (const pick of aiPicks) {
      const m = byId.get(pick.recipeId);
      if (m && !top.includes(m)) top.push(m);
    }
    // Fill remaining slots with the best deterministic scores not already picked.
    for (const m of ranked) {
      if (top.length >= 4) break;
      if (!top.includes(m)) top.push(m);
    }
  } else {
    top.push(...ranked.slice(0, 4));
  }
  const ordered = top.slice(0, 4);

  return ordered.map((m, idx) => {
    let reason: string;
    const aiReasons = aiPicks?.find((p) => p.recipeId === m.recipe.id)?.matchReason ?? [];
    if (aiReasons.length > 0) {
      reason = aiReasons[0] ?? "";
    } else if (m.missingCount === 0) {
      reason =
        idx === 0
          ? "You have literally everything. The kitchen chose this. 👀"
          : "You have everything for this one.";
    } else if (m.missingCount === 1) {
      reason = "One ingredient away. Worth a look.";
    } else {
      reason = KITCHEN_MICROCOPY[idx % KITCHEN_MICROCOPY.length] ?? "Your kitchen knows best. 👀";
    }

    // Missing items that the recipe marks optional → “you don’t need it”.
    const missingSet = new Set(m.missing);
    const notNeeded = m.recipe.ingredients
      .filter((ri) => ri.optional && !missingSet.has(ri.ingredientId))
      .map((ri) => findIngredientName(ri.ingredientId));
    const coreIds = m.recipe.ingredients.filter(
      (ri) => !ri.optional && !isAssumedPantry(ri.ingredientId),
    );
    const usesCount = coreIds.length - m.missing.length;

    return {
      recipe: m.recipe,
      missing: m.missing,
      reason,
      why: aiReasons.length > 0 ? [...aiReasons, ...whyThis(m, f)].slice(0, 5) : whyThis(m, f),
      usesCount,
      protein: computeNutrition(m.recipe, f.servings).protein,
      costPerServing: computeCostPerServing(m.recipe, f.servings),
      minutes: m.recipe.timeMin,
      difficulty: m.recipe.difficulty,
      notNeeded,
    };
  });
}
