// ─────────────────────────────────────────────────────────────
// RUCHI — matching engine
// ─────────────────────────────────────────────────────────────
// Deterministic recommendations: score every recipe against what the user
// has, then return 3–4. The AI layer re-ranks within a schema-validated
// envelope — it never invents recipes for the MVP dataset flow.

import { RECIPES } from "@/lib/data/recipes";
import { findIngredient, isAssumedPantry } from "@/lib/data/ingredients";
import type { Intent, Recipe, SubstitutionRule } from "@/lib/types";
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
  /** Missing ids that the recipe's substitution table can cover. */
  substitutable: string[];
  reasons: string[]; // human-readable why-lines
  protein: number;
  /**
   * Ingredient-grounded match category. CAN_COOK_NOW = every core
   * ingredient owned (optional/pantry items never block). ONE_OR_FEW_AWAY =
   * genuinely relevant but missing 1+ core items. ADAPTABLE = one or more
   * missing items covered ONLY by the recipe's own validated substitution
   * rules. The engine never invents swaps. NOT_RELEVANT recipes never
   * leave matchRecipes — they are filtered before ranking.
   */
  category: "CAN_COOK_NOW" | "ONE_OR_FEW_AWAY" | "ADAPTABLE";
  /** matched/total core-ingredient counts powering the "4/4" card line. */
  coreMatched: number;
  coreTotal: number;
}

/**
 * Recipe-aware substitution check: can this missing ingredient be covered
 * by the recipe's own substitution rules? The user's kitchen is checked
 * against each rule's `useId` — a rule without a concrete swap ("skip it")
 * is not automatically satisfiable, so it stays missing.
 */
function substitutionCover(r: Recipe, missingIds: string[], has: Set<string>): string[] {
  if (missingIds.length === 0) return [];
  const rules = new Map<string, SubstitutionRule>();
  for (const s of r.substitutions) rules.set(s.missingId, s);
  const covered: string[] = [];
  for (const id of missingIds) {
    const rule = rules.get(id);
    if (rule?.useId && has.has(rule.useId)) covered.push(id);
  }
  return covered;
}

export function matchRecipes(f: MatchFilters): MatchScore[] {
  // Assumed pantry: salt, oil and basic spices never block a match.
  const has = new Set(f.hasIds);
  const intents = new Set(f.intents);
  const scores: MatchScore[] = [];

  for (const r of RECIPES) {
    // Diet gate. "vegetarian" is strict — egg dishes are non-veg in the
    // binary product policy (see dietTypeOf), so a veg-only context never
    // recommends them. "eggetarian" adds egg back (veg + egg, no meat).
    if (f.diet === "vegetarian" && r.diet !== "veg") continue;
    if (f.diet === "eggetarian" && r.diet === "nonveg") continue;

    // Time & budget are PERSONALIZATION RANKERS, not hard gates (spec:
    // "lower-cost compatible meals can rank higher among similarly matched
    // meals"). A ₹58 dish stays visible for someone who owns paneer — it
    // just ranks below affordable equals. 0 = no limit.
    const cost = computeCostPerServing(r, f.servings);
    const timeFit = f.timeMax === 0 || r.timeMin <= f.timeMax;
    const budgetFit = f.budgetMax === 0 || cost <= f.budgetMax;

    // Ingredient overlap (assumed-pantry items count as owned)
    const core = r.ingredients.filter((i) => !i.optional && !isAssumedPantry(i.ingredientId));
    const coreHave = core.filter((i) => has.has(i.ingredientId));
    const missing = core
      .filter((i) => !has.has(i.ingredientId))
      .map((i) => i.ingredientId);
    const coverage = core.length === 0 ? 0 : coreHave.length / core.length;

    // Relevance gate — ingredient compatibility is the entry ticket, not a
    // bonus. Coverage ≥ 50% alone is NOT enough: a two-core recipe sharing
    // one generic ingredient (e.g. the user's only hit being "egg") is not
    // a recommendation. Require the matches to be meaningful: at least two
    // distinct owned cores, or full coverage when a recipe is genuinely
    // minimal (a 1-core dish the user actually owns). Optional and pantry
    // items never contribute.
    const relevant =
      core.length === 0
        ? false
        : coverage === 1
          ? true
          : coreHave.length >= 2 && coverage >= 0.5;
    if (!relevant) continue;

    // Recipe-aware substitutions: missing items covered by an owned swap
    // stop counting against the match (and earn a small bonus).
    const substitutable = substitutionCover(r, missing, has);
    const effectiveMissing = missing.length - substitutable.length;
    const effectiveCoverage = core.length === 0 ? 0 : (coreHave.length + substitutable.length) / core.length;

    // Reasons
    const reasons: string[] = [];
    if (effectiveMissing === 0) {
      reasons.push(
        substitutable.length > 0
          ? `Everything covered — ${substitutable.length === 1 ? "one swap makes it work" : "swaps make it work"}`
          : "You have everything",
      );
    } else {
      reasons.push(
        `Only ${effectiveMissing} item${effectiveMissing > 1 ? "s" : ""} missing`,
      );
    }
    // Name the owned swaps whether or not anything is still missing.
    for (const subId of substitutable) {
      const rule = r.substitutions.find((s) => s.missingId === subId);
      const swapName = rule?.useId ? findIngredientName(rule.useId) : null;
      const missName = findIngredientName(subId);
      if (swapName) reasons.push(`${swapName} works instead of ${missName.toLowerCase()}`);
    }
    if (r.tags.includes("high-protein")) reasons.push("High protein");
    if (r.timeMin <= 15) reasons.push("15-min meal");

    // Score
    let score = effectiveCoverage * 60; // up to 60 pts for coverage
    if (timeFit) score += 10;
    if (budgetFit) score += 8;
    let intentHits = 0;
    for (const t of r.tags) if (intents.has(t)) { score += 9; intentHits++; }
    if (intentHits >= 2) score += 6;
    if (r.difficulty === "easy") score += 5;
    if (effectiveMissing === 0) score += 12; // cook-now bonus
    if (substitutable.length > 0) score += 4 * substitutable.length; // swap-aware bonus
    // Protein matters — up to +8 pts, and it breaks ties (high-protein
    // users should never see an 11g omelette above a 35g bhurji).
    const protein = computeNutrition(r, f.servings).protein;
    score += Math.min(8, (protein / 50) * 8);

    // Category: full coverage with no swaps → CAN_COOK_NOW. Full coverage
    // only via the recipe's own validated swaps → ADAPTABLE. Anything still
    // genuinely missing → ONE_OR_FEW_AWAY. CAN_COOK_NOW is the product's
    // headline promise ("you can cook this right now") so it must never be
    // outranked by a swap-dependent recipe — enforced with a strict bonus,
    // not by trusting the weighted sum.
    const category: MatchScore["category"] =
      effectiveMissing === 0
        ? substitutable.length > 0
          ? "ADAPTABLE"
          : "CAN_COOK_NOW"
        : "ONE_OR_FEW_AWAY";
    if (category === "CAN_COOK_NOW") score += 25;
    else if (category === "ADAPTABLE") score -= 5;

    scores.push({
      recipe: r,
      score,
      missing,
      missingCount: missing.length,
      substitutable,
      reasons,
      protein,
      category,
      coreMatched: coreHave.length,
      coreTotal: core.length,
    });
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
  /** Ingredient-grounded category — drives the "cook right now" framing. */
  category: MatchScore["category"];
  /** matched/total core-ingredient counts, e.g. 4/4. */
  coreMatched: number;
  coreTotal: number;
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
 * "Almost there" candidates — recipes the user is 1–2 confirmed ingredients
 * away from. ALWAYS a separate, clearly-labeled section; NEVER mixed into
 * primary results (see recommend()'s strict eligibility gate). Swap-covered
 * recipes (Soya Chunks Curry ↔ paneer) land here, not in primary.
 */
export function nearRecipes(f: MatchFilters, limit = 4): Recommendation[] {
  const ranked = matchRecipes(f).filter(
    (m) => m.missing.length >= 1 && m.missing.length <= 2,
  );
  return ranked.slice(0, limit).map((m) => {
    const missingSet = new Set(m.missing);
    const notNeeded = m.recipe.ingredients
      .filter((ri) => ri.optional && !missingSet.has(ri.ingredientId))
      .map((ri) => findIngredientName(ri.ingredientId));
    const coreIds = m.recipe.ingredients.filter(
      (ri) => !ri.optional && !isAssumedPantry(ri.ingredientId),
    );
    return {
      recipe: m.recipe,
      missing: m.missing,
      reason:
        m.missing.length === 1
          ? "You're missing 1 ingredient"
          : `You're missing ${m.missing.length} ingredients`,
      why: whyThis(m, f),
      usesCount: coreIds.length - m.missing.length,
      protein: computeNutrition(m.recipe, f.servings).protein,
      costPerServing: computeCostPerServing(m.recipe, f.servings),
      minutes: m.recipe.timeMin,
      difficulty: m.recipe.difficulty,
      notNeeded,
      category: m.category,
      coreMatched: m.coreMatched,
      coreTotal: m.coreTotal,
    };
  });
}

/**
 * Top 3–4 recommendations with microcopy + structured why-lines.
 *
 * `aiPicks` (optional) is the AI's selection/order over the candidate list —
 * validated recipeIds only (enforced by the recommendation service contract). The AI
 * reorders the deterministic top slice and can replace the "why" copy with
 * its matchReason lines; it can never introduce a recipe that didn't score.
 */
export function recommend(f: MatchFilters, aiPicks?: { recipeId: string; matchReason: string[] }[]): Recommendation[] {
  const ranked = matchRecipes(f);

  // ── STRICT ELIGIBILITY (hard gate, before any ranking or AI) ──
  // Primary results may only contain recipes whose non-optional, non-pantry
  // ingredient set is FULLY OWNED: recipeRequiredIngredients ⊆ user's
  // confirmed ingredients. This is deliberately stricter than the score's
  // substitution awareness — even a catalog-validated swap (paneer for
  // soya-chunks) does not make a recipe eligible for primary results,
  // because the user never confirmed the headline ingredient. Swap-covered
  // and near-miss recipes surface ONLY in the clearly-labeled "Almost
  // there" section via nearRecipes(). AI ordering below operates only
  // within this already-filtered list; it can reorder, never expand.
  const eligible = ranked.filter((m) => m.missing.length === 0);

  // Apply AI ordering (only ids present in the deterministic eligible slice).
  const byId = new Map(eligible.map((m) => [m.recipe.id, m]));
  const top: MatchScore[] = [];
  if (aiPicks && aiPicks.length > 0) {
    for (const pick of aiPicks) {
      const m = byId.get(pick.recipeId);
      if (m && !top.includes(m)) top.push(m);
    }
    // Fill remaining slots with the best deterministic scores not already picked.
    for (const m of eligible) {
      if (top.length >= 4) break;
      if (!top.includes(m)) top.push(m);
    }
  } else {
    top.push(...eligible.slice(0, 4));
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
      category: m.category,
      coreMatched: m.coreMatched,
      coreTotal: m.coreTotal,
    };
  });
}
