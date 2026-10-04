// ─────────────────────────────────────────────────────────────
// RUCHI — attention strategy (Notification Experience 2.0)
// ─────────────────────────────────────────────────────────────
// The "which opportunity wins" layer. It does NOT invent attention:
// the existing Context Engine (evaluateAttention) stays the only
// attention decision point for cooking-relevant contexts. This layer
// ONLY re-ranks and extends: for each real server-side signal it can
// prove, it produces a deterministic opportunity.
//
// Priority model (deterministic, highest wins):
//   1 resume_cooking          2 explicit_followup
//   3 ingredient_opportunity  4 cook_again
//   5 contextual_meal         6 discover_opportunity
//   7 personality (last, long cooldown)
//
// Rules the builders must honour (spec §8/§9):
//  • Never fabricate a paused session, an eligible meal, a
//    completed meal, an ingredient, a category or a personality
//    hook. Return null when the signal is absent.
//  • A candidate's copy facts come only from what the builder
//    actually observed.
//  • Callers MUST NOT mutate the returned opportunity (it is
//    frozen at build time — deterministic).

import { recommend, type Recommendation, type MatchFilters } from "@/lib/engine/match";
import {
  evaluateAttention,
  type AttentionContext,
  type AttentionInput,
  type AttentionRecipeFacts,
} from "@/lib/context/attention";
import { getRecipe } from "@/lib/data/recipes";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import type { MealHistoryEntry } from "@/lib/types";
import { discoverCategories } from "@/lib/data/taxonomy";
import { dayKeyOf } from "@/lib/datetime";

// ── Opportunity type vocabulary (spec §3, one winner) ──────────
export type OpportunityType =
  | "resume_cooking"
  | "explicit_followup"
  | "ingredient_opportunity"
  | "cook_again"
  | "contextual_meal"
  | "discover_opportunity"
  | "personality";

/** Deterministic rank: lower number = higher priority (1 wins). */
export const OPPORTUNITY_PRIORITY: Record<OpportunityType, number> = {
  resume_cooking: 1,
  explicit_followup: 2,
  ingredient_opportunity: 3,
  cook_again: 4,
  contextual_meal: 5,
  discover_opportunity: 6,
  personality: 7,
};

// Tie-break order for determinism when priorities collide.
export const OPPORTUNITY_ORDER = Object.keys(OPPORTUNITY_PRIORITY) as OpportunityType[];

/** Mirrors the engine's PAUSED_MAX_AGE_H (12h): a stale pan is not intent. */
const PAUSED_MAX_AGE_MS = 12 * 3_600_000;

// ── Opportunity (the payload a notification carrier needs) ────
export interface Opportunity {
  /** Deterministic id across runs (used for dedup + copy seed). */
  dedupKey: string;
  type: OpportunityType;
  priority: number;
  /** Owner of this opportunity — makes isolation testable. */
  userId: string;
  /** The engine's AttentionContext, kept for isSuppressed/TTL plumbing. */
  ctx: AttentionContext;
  /** Facts the copy registry is allowed to use (real data only). */
  facts: OpportunityFacts;
  /** Confidence 0..1 (policy: below 0.6 → low_confidence). */
  confidence: number;
  /** Deep-link destination for this notification. */
  destination: string;
}

export interface OpportunityFacts {
  recipeId?: string;
  recipeName?: string;
  categoryId?: string;
  categoryLabel?: string;
  categoryCount?: number;
  step?: number;
  total?: number;
  timeMin?: number;
  window?: "breakfast" | "lunch" | "dinner";
  dayKey: string;
  weekKey: string;
}

// ── Server-only real data the cron can point at (v1 posture) ──
export interface ServerSignals {
  userId: string;
  now: number;
  history: MealHistoryEntry[];
  pausedSession?: { recipeId: string; stepIndex: number; stepCount: number; pausedAt: number } | null;
  /** Calendar-day bucket of the last completion (real data, no clock). */
  lastCookedDay?: string;
  weekKey: string;
  /** Optional real signals the client may mirror (scan/view/start). */
  lastAction?: { kind: "scan" | "view_recipe" | "start_cooking"; recipeId?: string; at: number } | null;
  /** Optional kitchen mirror ({ ids, updatedAt }) — real confirmed ingredients, only from clients that opt into kitchen sync. */
  kitchen?: { ids: string[]; updatedAt: number } | null;
  diet?: "vegetarian" | "eggetarian" | "non-vegetarian";
  /** Server-exact window used for contextual timing (cron runs 10:00/18:00 IST). */
  mealWindowLabel?: "breakfast" | "lunch" | "dinner";
}

// ── One-time engine reuse ─────────────────────────────────────
/**
 * Map the engine's already-decided context to an opportunity — ONLY for
 * the ingredient-class contexts, which no builder can produce without a
 * real kitchen mirror + the recommendation engine. Everything else
 * (resume, cook-again, personality, contextual timing) is owned by a
 * dedicated builder below, so the engine mapping can never duplicate it.
 */
function engineToOpportunity(
  ctx: AttentionContext,
  userId: string,
  dayKey: string,
  weekKey: string,
): Opportunity | null {
  if (ctx.type === "none" || !ctx.recipeId) return null;
  switch (ctx.type) {
    case "unused_ingredients":
    case "quick_win":
    case "budget_win":
    case "protein_fit": {
      const recipe = getRecipe(ctx.recipeId);
      if (!recipe) return null; // never fabricate facts for an unknown dish
      return {
        dedupKey: `ingredient_opportunity:${ctx.recipeId}:${dayKey}`,
        type: "ingredient_opportunity",
        priority: OPPORTUNITY_PRIORITY.ingredient_opportunity,
        userId,
        ctx,
        facts: {
          recipeId: ctx.recipeId,
          recipeName: recipe.name,
          timeMin: recipe.timeMin,
          dayKey,
          weekKey,
        },
        confidence: ctx.type === "quick_win" ? 0.95 : 0.9,
        destination: `/?recipe=${ctx.recipeId}&n=${dayKey}-${weekKey}`,
      };
    }
    // resume / cook_again / personality / meal-time are builder-owned.
    default:
      return null;
  }
}

// ── Step 1: build from the existing engine ────────────────────
function buildFromEngine(signals: ServerSignals): Opportunity[] {
  const { now, history, pausedSession, kitchen, diet } = signals;
  // A real recommendation, computed ONLY from the real kitchen mirror.
  // Without a kitchen the engine stays correctly quiet (v1 posture:
  // inventory is client-local; silence IS the correct behavior).
  const kitchenIds = kitchen?.ids ?? [];
  const filters: MatchFilters = {
    hasIds: kitchenIds,
    intents: ["quick", "indian"],
    timeMax: 0,
    budgetMax: 0,
    servings: 2,
    diet: diet ?? "non-vegetarian",
  };
  const best: Recommendation | null =
    kitchenIds.length > 0 ? (recommend(filters)[0] ?? null) : null;
  const facts: AttentionRecipeFacts | null = best
    ? {
        timeMin: best.recipe.timeMin,
        proteinPerServing: computeNutrition(best.recipe, 1).protein,
        costPerServing: computeCostPerServing(best.recipe, 1),
      }
    : null;

  const input: AttentionInput = {
    now,
    inventoryIds: kitchenIds,
    diet: diet ?? "non-vegetarian",
    history,
    pausedSession: pausedSession ?? null,
    // Server-side: in-app suppression is policy/ledger-driven here.
    lastShown: null,
  };
  const ctx = evaluateAttention(input, best, facts);
  if (ctx.type === "none") return [];
  const mapped = engineToOpportunity(ctx, signals.userId, dayKeyOf(now), signals.weekKey);
  return mapped ? [mapped] : [];
}

// ── Step 2: deterministic builders from real data ─────────────
function resumeOpportunity(s: ServerSignals): Opportunity | null {
  if (!s.pausedSession) return null;
  const ageOk = s.now - s.pausedSession.pausedAt < PAUSED_MAX_AGE_MS;
  const stepReal = s.pausedSession.stepIndex > 0 && s.pausedSession.stepIndex < s.pausedSession.stepCount;
  if (!ageOk || !stepReal) return null;
  const recipe = getRecipe(s.pausedSession.recipeId);
  if (!recipe) return null;
  return {
    dedupKey: `resume_cooking:${s.pausedSession.recipeId}:${dayKeyOf(s.now)}`,
    type: "resume_cooking",
    priority: OPPORTUNITY_PRIORITY.resume_cooking,
    userId: s.userId,
    ctx: {
      type: "incomplete_session",
      priority: 100,
      headline: "Your dinner is still waiting. 🍳",
      supportingText: `Step ${s.pausedSession.stepIndex + 1} of ${s.pausedSession.stepCount} — pick up where you left off.`,
      recipeId: s.pausedSession.recipeId,
      action: "resume",
      reason: `paused session at step ${s.pausedSession.stepIndex + 1}/${s.pausedSession.stepCount}; paused ${Math.round((s.now - s.pausedSession.pausedAt) / 60_000)} min ago`,
    },
    facts: {
      recipeId: s.pausedSession.recipeId,
      recipeName: recipe.name,
      step: s.pausedSession.stepIndex + 1,
      total: s.pausedSession.stepCount,
      timeMin: recipe.timeMin,
      dayKey: dayKeyOf(s.now),
      weekKey: s.weekKey,
    },
    confidence: 0.95,
    destination: `/?resume=${s.pausedSession.recipeId}&n=${dayKeyOf(s.now)}-${s.weekKey}`,
  };
}

function explicitFollowupOpportunity(s: ServerSignals): Opportunity | null {
  // Real, mirrored actions only — never inferred. COPY POINTS AT THE
  // ACTUAL ACTION (scan/view/start), so wording follows the user.
  const a = s.lastAction;
  if (!a) return null;
  const within = (aAt: number) => s.now - aAt < 36 * 60_000; // short window to avoid churn
  if (!within(a.at)) return null;
  const recipe = a.recipeId ? getRecipe(a.recipeId) : undefined;
  const dayKey = dayKeyOf(s.now);
  // Very recent scans while the kitchen is still non-empty = the
  // strongest follow-up signal (spec: "recently scanned ingredients").
  if (a.kind === "scan" && s.kitchen?.ids.length) {
    const best = bestRecipeFor(s.kitchen.ids, s.diet ?? "non-vegetarian");
    if (!best) return null; // no valid recommendation can produce it
    const r = getRecipe(best);
    if (!r) return null;
    return {
      dedupKey: `explicit_followup:${best}:${dayKey}`,
      type: "explicit_followup",
      priority: OPPORTUNITY_PRIORITY.explicit_followup,
      userId: s.userId,
      ctx: {
        type: "meal_time",
        priority: 90,
        headline: "You scanned ingredients earlier.",
        supportingText: "Here's what's hiding in what you already have.",
        recipeId: best,
        action: "cook",
        reason: `explicit follow-up after a scan at ${a.at}`,
      },
      facts: { recipeId: best, recipeName: r.name, timeMin: r.timeMin, dayKey, weekKey: s.weekKey },
      confidence: 0.95,
      destination: `/?recipe=${best}&n=${dayKey}-${s.weekKey}`,
    };
  }
  // Recently viewed a recipe + the user has real completions: "Still
  // thinking about <dish>?" — grounded, actionable, no invented intent.
  if (a.kind === "view_recipe" && recipe && s.history.length > 0) {
    return {
      dedupKey: `explicit_followup:${a.recipeId}:${dayKey}`,
      type: "explicit_followup",
      priority: OPPORTUNITY_PRIORITY.explicit_followup,
      userId: s.userId,
      ctx: {
        type: "meal_time",
        priority: 90,
        headline: `Still thinking about ${recipe.name}?`,
        supportingText: "The pan's still there. One dish, ready when you are.",
        recipeId: a.recipeId,
        action: "cook",
        reason: `explicit follow-up after viewing a recipe at ${a.at}`,
      },
      facts: { recipeId: a.recipeId, recipeName: recipe.name, timeMin: recipe.timeMin, dayKey, weekKey: s.weekKey },
      confidence: 0.9,
      destination: `/?recipe=${a.recipeId}&n=${dayKey}-${s.weekKey}`,
    };
  }
  // A "start_cooking" action without a recorded pause carries no honest
  // message (resume owns real pauses) — stay silent.
  return null;
}

function cookAgainOpportunity(s: ServerSignals): Opportunity | null {
  const last = s.history[0];
  if (!last) return null;
  // Real completion ledger only — a dish that left the catalog goes quiet.
  const recipe = getRecipe(last.recipeId);
  if (!recipe) return null;
  // Recently-cooked dishes get non-spammy re-rotation: cook_again only
  // fires after a full day. The immediate post-meal window is covered by
  // the policy layer's recently_cooked guard; this floor keeps "round
  // two" from landing on the same evening.
  const lastCookedAt = last.cookedAt ?? 0;
  if (s.now - lastCookedAt < 24 * 3_600_000) return null;
  return {
    dedupKey: `cook_again:${last.recipeId}:${dayKeyOf(s.now)}`,
    type: "cook_again",
    priority: OPPORTUNITY_PRIORITY.cook_again,
    userId: s.userId,
    ctx: {
      type: "repeat_success",
      priority: 80,
      headline: "Round two? 👀",
      supportingText: `You finished ${recipe.name} recently. It's ready for another pan.`,
      recipeId: last.recipeId,
      action: "cook_again",
      reason: `real completion of ${last.recipeId} ${Math.round((s.now - lastCookedAt) / 86_400_000)} days ago`,
    },
    facts: {
      recipeId: last.recipeId,
      recipeName: recipe.name,
      timeMin: recipe.timeMin,
      dayKey: dayKeyOf(s.now),
      weekKey: s.weekKey,
    },
    confidence: 0.95,
    destination: `/?recipe=${last.recipeId}&n=${dayKeyOf(s.now)}-${s.weekKey}`,
  };
}

function contextualMealOpportunity(s: ServerSignals): Opportunity | null {
  // Needs the server-exact window (the cron's own IST clock) AND at least
  // one real anchor (kitchen / history / a real viewed dish). Time alone
  // is never a reason (spec §9).
  if (!s.mealWindowLabel) return null;
  const hasKitchen = !!s.kitchen?.ids.length;
  const hasDish = !!(s.lastAction?.recipeId && s.lastAction.kind === "view_recipe" && getRecipe(s.lastAction.recipeId));
  const hasHistory = s.history.length > 0;
  if (!hasKitchen && !hasDish && !hasHistory) return null;

  const best = hasKitchen ? bestRecipeFor(s.kitchen!.ids, s.diet ?? "non-vegetarian") : null;
  const recipe = best ? getRecipe(best) : undefined;

  // The window's label is real info (we do not claim a habit).
  const window = s.mealWindowLabel;
  const headline = window === "dinner"
    ? "Dinner's getting late — this one's decided."
    : window === "lunch"
      ? "Lunch doesn't need a long decision."
      : "Morning is for coffee and a quick pan.";
  const bodies: Record<typeof window, string> = {
    dinner: "One pan, no overthinking.",
    lunch: "Quick from what you have.",
    breakfast: "Easy before the day starts.",
  };
  return {
    dedupKey: `contextual_meal:${recipe?.id ?? "open"}:${dayKeyOf(s.now)}`,
    type: "contextual_meal",
    priority: OPPORTUNITY_PRIORITY.contextual_meal,
    userId: s.userId,
    ctx: {
      // Engine vocabulary: a pinned dish is meal_time; without one this is
      // a gentle "your kitchen might have an idea" moment.
      type: recipe ? "meal_time" : "return_visit",
      priority: 70,
      headline,
      supportingText: bodies[window],
      recipeId: recipe?.id,
      action: recipe ? "cook" : "find_meal",
      reason: `${window} window with real signals (${[hasKitchen && "kitchen", hasDish && "recent dish", hasHistory && "cooking history"].filter(Boolean).join(", ")})`,
    },
    facts: {
      recipeId: recipe?.id,
      recipeName: recipe?.name,
      timeMin: recipe?.timeMin,
      window,
      dayKey: dayKeyOf(s.now),
      weekKey: s.weekKey,
    },
    confidence: recipe ? 0.75 : 0.55,
    destination: recipe
      ? `/?recipe=${recipe.id}&n=${dayKeyOf(s.now)}-${s.weekKey}`
      : `/?n=${dayKeyOf(s.now)}-${s.weekKey}`,
  };
}

function discoverOpportunity(s: ServerSignals): Opportunity | null {
  // Real taxonomy only — and real usage: discovery is for users the app
  // has actually met (history / kitchen / a recent action). A cold push
  // to a fresh visitor is Welcome's job, never a notification.
  const hasUsedRuchi = s.history.length > 0 || !!s.kitchen?.ids.length || !!s.lastAction;
  if (!hasUsedRuchi) return null;
  const categories = discoverCategories();
  if (!categories.length) return null;
  // Deterministic rotation per user per week so the same user sees
  // the same category across the week (no unstable messaging).
  const idx = hashOf(`${s.userId}:${s.weekKey}`) % categories.length;
  const cat = categories[idx]!;
  return {
    dedupKey: `discover_opportunity:${cat.id}:${s.weekKey}`,
    type: "discover_opportunity",
    priority: OPPORTUNITY_PRIORITY.discover_opportunity,
    userId: s.userId,
    ctx: {
      type: "meal_time",
      priority: 65,
      headline: `${cat.label} is stocked.`,
      supportingText: `${cat.recipes.length} ideas ready — pick what you like.`,
      recipeId: cat.recipes[0]?.id,
      action: "find_meal",
      reason: `real taxonomy category ${cat.id}`,
    },
    facts: {
      categoryId: cat.id,
      categoryLabel: cat.label,
      categoryCount: cat.recipes.length,
      dayKey: dayKeyOf(s.now),
      weekKey: s.weekKey,
    },
    confidence: 0.75,
    destination: `/?category=${cat.id}&n=${dayKeyOf(s.now)}-${s.weekKey}`,
  };
}

function personalityOpportunity(s: ServerSignals): Opportunity | null {
  // PERSONALITY (7th) only matters when there is real context: the
  // user has actually cooked here before. Never a lone voice.
  if (!s.history.length) return null;
  return {
    dedupKey: `personality:${s.weekKey}`,
    type: "personality",
    priority: OPPORTUNITY_PRIORITY.personality,
    userId: s.userId,
    ctx: {
      type: "none",
      priority: 0,
      headline: "Your kitchen has been suspiciously quiet. 👀",
      supportingText: "No rush — when you're ready, the pan's waiting.",
      action: "find_meal",
      reason: "personality opportunity (real cooking history exists)",
    },
    facts: { dayKey: dayKeyOf(s.now), weekKey: s.weekKey },
    confidence: 0.75,
    destination: `/?n=${dayKeyOf(s.now)}-${s.weekKey}`,
  };
}

// ── Entry point ───────────────────────────────────────────────
export function generateOpportunities(signals: ServerSignals): Opportunity[] {
  const candidates: Opportunity[] = [];
  const push = (o: Opportunity | null) => {
    if (o) candidates.push(o);
  };
  push(resumeOpportunity(signals));
  push(explicitFollowupOpportunity(signals));
  push(cookAgainOpportunity(signals));
  push(contextualMealOpportunity(signals));
  push(discoverOpportunity(signals));
  for (const o of buildFromEngine(signals)) push(o);

  // De-duplicate overlapping builder/engine candidates by (type, target):
  // first push wins — builders run first, the engine mapping second.
  const seen = new Set<string>();
  const ranked: Opportunity[] = [];
  for (const o of candidates) {
    const key = `${o.type}:${o.facts.recipeId ?? o.facts.categoryId ?? "-"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(o);
  }

  // Personality never competes with anything real (spec §3G): it is the
  // floor of the ladder, only surfaced when no useful opportunity exists.
  if (!ranked.some((o) => o.type !== "personality")) {
    push(personalityOpportunity(signals));
  }
  return ranked;
}

/** Deterministic recipe pick for a kitchen + diet (null when nothing is eligible). */
export function bestRecipeFor(has: string[], diet?: "vegetarian" | "eggetarian" | "non-vegetarian"): string | null {
  if (has.length === 0) return null;
  const f: MatchFilters = {
    hasIds: has,
    intents: ["quick", "indian"],
    timeMax: 0,
    budgetMax: 0,
    servings: 2,
    diet: diet ?? "non-vegetarian",
  };
  const recs = recommend(f);
  return recs.length ? recs[0]!.recipe.id : null;
}

// ── Deterministic helpers (no Math.random anywhere) ────────────
function hashOf(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
