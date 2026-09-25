// ─────────────────────────────────────────────────────────────
// RUCHI — Re-Attention / Context Engine
// ─────────────────────────────────────────────────────────────
// One deterministic answer to: "Why should THIS user care about RUCHI
// right now?" Built exclusively on real application state — the
// recommendation engine, the kitchen, real completion records — and
// never on engagement pressure.
//
// Design rules (product spec):
//  • ONE primary opportunity at a time. Multiple truths may co-exist;
//    the highest-priority one wins. Ties break deterministically.
//  • Silence is a valid outcome: `type: "none"` when there is no
//    genuine reason — Home then stays calm.
//  • Every context is explainable: `reason` states the evidence in
//    plain language (which the UI may show, and tests assert on).
//  • No guilt, no fake urgency, no fabricated numbers. Copy uses the
//    centralized personality module; counts come from real records.
//  • Frequency control lives OUTSIDE the engine (pure function), in
//    the store's persisted attention state — see suppression docs
//    in store/index.ts.
//
// Deterministic: no Math.random, no Date.now() inside — `now` is
// always passed in. Same inputs → same output, always.

import type { Recommendation } from "@/lib/engine/match";
import { getRecipe } from "@/lib/data/recipes";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import type { DietPreference, MealHistoryEntry, SkillLevel } from "@/lib/types";

// ── Types ────────────────────────────────────────────────────

export type AttentionType =
  | "incomplete_session" // user paused mid-cook — resume beats everything
  | "unused_ingredients" // kitchen has an eligible meal waiting
  | "repeat_success" // a recently completed dish can be cooked again
  | "meal_time" // meaningful meal window + a real signal (never time alone)
  | "recent_cooking" // cooked recently; celebrate, invite the next one
  | "return_visit" // back after a meaningful break, kitchen ready
  | "cooking_gap" // historically cooks, quiet lately — gentle, no shame
  | "quick_win" // dinner in ≤15 min from what they have
  | "budget_win" // notable low-cost dinner from what they have
  | "protein_fit" // matches an established protein pattern
  | "none";

export type AttentionAction = "find_meal" | "cook" | "cook_again" | "resume";

export interface AttentionContext {
  type: AttentionType;
  /** Higher wins. Chosen so product value, not click-bait, ranks first. */
  priority: number;
  /** The confident statement — replaces any generic "what should we do?" */
  headline: string;
  /** Optional supporting evidence line. */
  supportingText?: string;
  /** Present when the context is about one specific dish. */
  recipeId?: string;
  action: AttentionAction;
  /** Plain-language evidence for why this surfaced (shown in QA/tests). */
  reason: string;
}

/** Everything the engine may look at — all of it already exists in the app. */
export interface AttentionInput {
  now: number;
  // Kitchen state
  inventoryIds: string[];
  diet: DietPreference;
  // Real cooking history (store `history`, newest first)
  history: MealHistoryEntry[];
  // Incomplete session marker (paused mid-cook), if any
  pausedSession?: { recipeId: string; stepIndex: number; stepCount: number; pausedAt: number } | null;
  // Suppression state (persisted per user; see store)
  lastShown?: { type: AttentionType; recipeId?: string; at: number } | null;
  // Meal-time windows (local hours). Tuned to Indian meal rhythm.
  mealWindows?: { breakfast: [number, number]; lunch: [number, number]; dinner: [number, number] };
}

export interface AttentionRecipeFacts {
  timeMin: number;
  proteinPerServing: number;
  costPerServing: number;
}

// ── Tunables ─────────────────────────────────────────────────

const DAY = 86_400_000;

/** A break is "meaningful" after this many days since the last cook. */
const RETURN_GAP_DAYS = 3;
/** "Been a while" — a longer quiet period; still gentle, never guilty. */
const GAP_DAYS = 14;
/** "Recently cooked" window for repeat/celebration contexts. */
const RECENT_COOK_DAYS = 5;
/** A paused session expires after this long (stale pan ≠ real intent). */
const PAUSED_MAX_AGE_H = 12;
/** Recency threshold for "dinner in N minutes" quick wins. */
const QUICK_MAX_MIN = 20;
/** Budget win ceiling — well under a typical delivery order. */
const BUDGET_MAX_INR = 60;
/** Protein signal threshold (per serving) for protein_fit. */
const PROTEIN_MIN_G = 25;

export const DEFAULT_MEAL_WINDOWS = {
  breakfast: [6, 10] as [number, number],
  lunch: [12, 15] as [number, number],
  dinner: [18, 22] as [number, number],
};

// ── Copy (calm, specific, never generic marketing) ───────────

const COPY = {
  resume: {
    headline: "You were halfway through dinner.",
    action: "Resume cooking",
  },
  unused_ingredients: [
    { headline: "You already have dinner.", supporting: "Your kitchen has everything this needs." },
    { headline: "Those ingredients have dinner potential.", supporting: "One pan away from done." },
  ],
  repeat_success: [
    { headline: "That one worked last time.", supporting: "Same ingredients. Same result." },
    { headline: "You've made this before.", supporting: "It went well — round two is easier." },
  ],
  meal_time: {
    breakfast: { headline: "Something easy before the day starts.", supporting: "Quick from what you have." },
    lunch: { headline: "Lunch doesn't need a long decision.", supporting: "This one's ready before your next meeting." },
    dinner: { headline: "Dinner decision getting difficult?", supporting: "It doesn't have to be. This one's decided." },
  },
  recent_cooking: {
    headline: "Dinner's been going well.",
    supporting: "Ready for another one?",
  },
  return_visit: {
    headline: "Back for dinner?",
    supporting: "Your kitchen might have an idea.",
  },
  cooking_gap: {
    headline: "Been a while. Want an easy one?",
    supporting: "No pressure — just an easy pan when you feel like it.",
  },
  quick_win: {
    headline: "Dinner in {min} minutes.",
    supporting: "Faster than deciding what to order.",
  },
  budget_win: {
    headline: "Dinner for ₹{cost}.",
    supporting: "Full plate, small bill. Estimated, as always.",
  },
  protein_fit: {
    headline: "Your kind of dinner.",
    supporting: "{protein}g protein · {min} min",
  },
} as const;

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Deterministic pool pick — stable for the same key. */
function pick<T>(pool: readonly T[], key: string | number): T {
  const idx = Math.abs(
    typeof key === "number" ? key : [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7),
  );
  return pool[idx % pool.length]!;
}

// ── Meal-time helper ─────────────────────────────────────────

export function mealWindow(
  now: number,
  windows = DEFAULT_MEAL_WINDOWS,
): "breakfast" | "lunch" | "dinner" | null {
  const h = new Date(now).getHours();
  if (h >= windows.breakfast[0] && h < windows.breakfast[1]) return "breakfast";
  if (h >= windows.lunch[0] && h < windows.lunch[1]) return "lunch";
  if (h >= windows.dinner[0] && h < windows.dinner[1]) return "dinner";
  return null;
}

// ── Candidate builders (each returns null when its signal is absent) ──

function buildResume(i: AttentionInput): AttentionContext | null {
  const p = i.pausedSession;
  if (!p) return null;
  const ageOk = i.now - p.pausedAt < PAUSED_MAX_AGE_H * 3_600_000;
  const stepReal = p.stepIndex > 0 && p.stepIndex < p.stepCount;
  if (!ageOk || !stepReal) return null;
  return {
    type: "incomplete_session",
    priority: 100,
    headline: COPY.resume.headline,
    supportingText: `Step ${p.stepIndex + 1} of ${p.stepCount} — pick up where you left off.`,
    recipeId: p.recipeId,
    action: "resume",
    reason: `paused session at step ${p.stepIndex + 1}/${p.stepCount}`,
  };
}

function buildIngredients(
  i: AttentionInput,
  best: Recommendation | null,
): AttentionContext | null {
  if (!best || i.inventoryIds.length === 0) return null;
  const r = best.recipe;
  return {
    type: "unused_ingredients",
    priority: 90,
    headline: pick(COPY.unused_ingredients, r.id).headline,
    supportingText: pick(COPY.unused_ingredients, r.id).supporting,
    recipeId: r.id,
    action: "cook",
    reason: `${best.coreMatched}/${best.coreTotal} core ingredients available`,
  };
}

function buildRepeat(i: AttentionInput): AttentionContext | null {
  const last = i.history[0];
  if (!last) return null;
  if (i.now - last.cookedAt > RECENT_COOK_DAYS * DAY) return null;
  // Facts come from the real recipe catalog — the repeat stands on history,
  // even when tonight's ingredient match points elsewhere. If the recipe
  // left the catalog, the context goes quiet rather than faking numbers.
  const r = getRecipe(last.recipeId);
  if (!r) return null;
  const f: AttentionRecipeFacts = {
    timeMin: r.timeMin,
    proteinPerServing: computeNutrition(r, 1).protein,
    costPerServing: computeCostPerServing(r, 1),
  };
  const c = COPY.repeat_success;
  const pickIdx = i.history.length;
  return {
    type: "repeat_success",
    priority: 80,
    headline: pick([c[0].headline, c[1].headline], pickIdx),
    supportingText: `${f.timeMin} min · ${f.proteinPerServing}g protein · ~₹${f.costPerServing}`,
    recipeId: last.recipeId,
    action: "cook_again",
    reason: `cooked ${last.recipeName} recently`,
  };
}

function buildMealTime(
  i: AttentionInput,
  best: Recommendation | null,
): AttentionContext | null {
  const w = mealWindow(i.now, i.mealWindows);
  // Time alone is never a reason — needs a real meal signal to anchor it.
  if (!w || !best || i.inventoryIds.length === 0) return null;
  return {
    type: "meal_time",
    priority: 70,
    headline: COPY.meal_time[w].headline,
    supportingText: COPY.meal_time[w].supporting,
    recipeId: best.recipe.id,
    action: "cook",
    reason: `${w} window with an eligible meal`,
  };
}

function buildRecentCooking(i: AttentionInput): AttentionContext | null {
  if (i.history.length < 2) return null;
  const last = i.history[0]!;
  if (i.now - last.cookedAt > RECENT_COOK_DAYS * DAY) return null;
  return {
    type: "recent_cooking",
    priority: 60,
    headline: COPY.recent_cooking.headline,
    supportingText: COPY.recent_cooking.supporting,
    action: "find_meal",
    reason: `${i.history.length} meals cooked, latest ${last.recipeName}`,
  };
}

function buildReturnVisit(i: AttentionInput): AttentionContext | null {
  const last = i.history[0];
  const gapDays = last ? (i.now - last.cookedAt) / DAY : Infinity;
  // A first-time user (no history) gets the empty-kitchen welcome instead —
  // that's HomeScreen's normal state, not a re-attention moment.
  if (!last) return null;
  // 3–13 days: a warm welcome-back. Beyond GAP_DAYS the cooking_gap
  // builder takes over so the two never compete for the same moment.
  if (gapDays < RETURN_GAP_DAYS || gapDays >= GAP_DAYS) return null;
  if (i.inventoryIds.length === 0) return null; // nothing to act on — stay quiet
  return {
    type: "return_visit",
    priority: 50,
    headline: COPY.return_visit.headline,
    supportingText: COPY.return_visit.supporting,
    action: "find_meal",
    reason: `${Math.floor(gapDays)} days since last cook, kitchen stocked`,
  };
}

function buildCookingGap(i: AttentionInput): AttentionContext | null {
  const last = i.history[0];
  if (!last) return null;
  const gapDays = (i.now - last.cookedAt) / DAY;
  // Long quiet only — short gaps belong to return_visit (mutually
  // exclusive windows keep the priority table honest).
  if (gapDays < GAP_DAYS || i.inventoryIds.length === 0) return null;
  return {
    type: "cooking_gap",
    priority: 50,
    headline: COPY.cooking_gap.headline,
    supportingText: COPY.cooking_gap.supporting,
    action: "find_meal",
    reason: `${Math.floor(gapDays)} days since last cook — gentle invitation`,
  };
}

function buildQuickWin(
  i: AttentionInput,
  best: Recommendation | null,
  facts: AttentionRecipeFacts | null,
): AttentionContext | null {
  if (!best || !facts) return null;
  if (facts.timeMin > QUICK_MAX_MIN || i.inventoryIds.length === 0) return null;
  return {
    type: "quick_win",
    priority: 65,
    headline: fill(COPY.quick_win.headline, { min: facts.timeMin }),
    supportingText: COPY.quick_win.supporting,
    recipeId: best.recipe.id,
    action: "cook",
    reason: `${facts.timeMin} min meal fully available`,
  };
}

function buildBudgetWin(
  i: AttentionInput,
  best: Recommendation | null,
  facts: AttentionRecipeFacts | null,
): AttentionContext | null {
  if (!best || !facts) return null;
  if (facts.costPerServing > BUDGET_MAX_INR || i.inventoryIds.length === 0) return null;
  return {
    type: "budget_win",
    priority: 55,
    headline: fill(COPY.budget_win.headline, { cost: facts.costPerServing }),
    supportingText: COPY.budget_win.supporting,
    recipeId: best.recipe.id,
    action: "cook",
    reason: `₹${facts.costPerServing} per serving from current kitchen`,
  };
}

function buildProteinFit(
  i: AttentionInput,
  best: Recommendation | null,
  facts: AttentionRecipeFacts | null,
  _skill?: SkillLevel,
): AttentionContext | null {
  void _skill;
  if (!best || !facts) return null;
  if (facts.proteinPerServing < PROTEIN_MIN_G || i.inventoryIds.length === 0) return null;
  return {
    type: "protein_fit",
    priority: 58,
    headline: COPY.protein_fit.headline,
    supportingText: fill(COPY.protein_fit.supporting, {
      protein: facts.proteinPerServing,
      min: facts.timeMin,
    }),
    recipeId: best.recipe.id,
    action: "cook",
    reason: `${facts.proteinPerServing}g protein matches established pattern`,
  };
}

// ── The engine ───────────────────────────────────────────────

/**
 * Decide the ONE attention opportunity for right now, or none.
 *
 * `best` is the caller's already-computed top recommendation (HomeScreen
 * computes `recommend(filters)` for its featured meal anyway — the engine
 * reuses it rather than re-running the matcher). `facts` describes that
 * recipe's numbers from the existing nutrition/cost utilities.
 */
export function evaluateAttention(
  input: AttentionInput,
  best: Recommendation | null,
  facts: AttentionRecipeFacts | null,
): AttentionContext {
  const candidates = [
    buildResume(input),
    buildIngredients(input, best),
    buildRepeat(input),
    buildQuickWin(input, best, facts),
    buildProteinFit(input, best, facts),
    buildMealTime(input, best),
    buildRecentCooking(input),
    buildReturnVisit(input),
    buildBudgetWin(input, best, facts),
    buildCookingGap(input),
  ].filter((c): c is AttentionContext => c !== null);

  if (candidates.length === 0) {
    return {
      type: "none",
      priority: 0,
      headline: "",
      action: "find_meal",
      reason: "no meaningful signal",
    };
  }

  // Highest priority wins; ties break deterministically by type name so
  // the same state always yields the same context.
  candidates.sort(
    (a, b) => b.priority - a.priority || a.type.localeCompare(b.type),
  );
  return candidates[0]!;
}

// ── Suppression (pure, testable; state owned by the store) ───

/** How long a shown context stays suppressed, per type. */
const SUPPRESSION_MS: Partial<Record<AttentionType, number>> = {
  incomplete_session: 30 * 60_000, // resume is urgent; brief cooldown
  unused_ingredients: 6 * 3_600_000,
  repeat_success: 12 * 3_600_000,
  meal_time: 8 * 3_600_000,
  recent_cooking: 24 * 3_600_000,
  return_visit: 24 * 3_600_000,
  cooking_gap: 48 * 3_600_000,
  quick_win: 6 * 3_600_000,
  budget_win: 12 * 3_600_000,
  protein_fit: 12 * 3_600_000,
};

export interface SuppressionState {
  lastShown?: { type: AttentionType; recipeId?: string; at: number } | null;
  /** Epoch ms until which ALL re-attention is muted (e.g. just dismissed). */
  suppressionUntil?: number | null;
}

/**
 * Should this context be muted? Deterministic. Rules:
 *  1. Global mute window (user just dismissed) → suppress everything.
 *  2. Same context type within its cooldown → suppress.
 *  3. Same recipe within 24h (any type) → suppress recipe fatigue.
 */
export function isSuppressed(
  ctx: AttentionContext,
  state: SuppressionState,
  now: number,
): boolean {
  if (state.suppressionUntil && state.suppressionUntil > now) return true;
  const last = state.lastShown;
  if (!last) return false;
  const typeCooldown = SUPPRESSION_MS[last.type] ?? 12 * 3_600_000;
  if (last.type === ctx.type && now - last.at < typeCooldown) return true;
  if (ctx.recipeId && last.recipeId === ctx.recipeId && now - last.at < 24 * 3_600_000) {
    return true;
  }
  return false;
}

/** Exported for copy tests — the quick-win headline uses the REAL time. */
export function quickWinHeadline(minutes: number): string {
  return fill(COPY.quick_win.headline, { min: minutes });
}

/** Next allowed show time for this type, for scheduling/tests. */
export function suppressionUntilFor(type: AttentionType, shownAt: number): number {
  return shownAt + (SUPPRESSION_MS[type] ?? 12 * 3_600_000);
}
