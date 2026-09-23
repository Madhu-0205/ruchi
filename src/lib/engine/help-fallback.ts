// ─────────────────────────────────────────────────────────────
// RUCHI — deterministic cooking-help fallback (pure functions)
// ─────────────────────────────────────────────────────────────
// When AI help is unavailable (offline, timeout, malformed
// response), Cooking Mode still needs to answer the cook. These answers
// come from the curated help library plus the recipe's own step cues and
// substitution table — never invented, and phrased like a person, not a
// spec sheet. Extracted from CookingMode so it can be tested directly.

import { getHelp } from "@/lib/data/help";
import type { Recipe, RecipeStep } from "@/lib/types";

/** The one-tap questions the help sheet offers. */
export const GENERIC_QUESTIONS = [
  "How do I know it's ready?",
  "I added too much salt",
  "I burned it",
  "Why is this watery?",
  "I don't have this ingredient",
  "I don't have this utensil",
] as const;

export function fallbackAnswer(
  question: string,
  recipe: Recipe,
  step: RecipeStep,
): string {
  const q = question.toLowerCase();
  if (q.includes("salt")) return getHelp("fix-too-salty")?.answer ?? "";
  if (q.includes("burn")) return getHelp("fix-burnt")?.answer ?? "";
  if (q.includes("watery"))
    return getHelp("why-watery-curry")?.answer ?? getHelp("fix-watery")?.answer ?? "";
  if (q.includes("utensil")) return getHelp("utensil-missing")?.answer ?? "";
  if (q.includes("don't have") || q.includes("substitute") || q.includes("alternative")) {
    const subs = recipe.substitutions.map((s) => s.message);
    // Each substitution message is already a complete, human sentence —
    // return it as one. Only frame a list when there are several to name.
    return subs.length === 1
      ? subs[0]!
      : subs.length > 1
        ? `Here's what works for ${recipe.name}: ${subs.join(" ")}`
        : (getHelp("substitute")?.answer ??
            "No listed swap for this one — the meal screen's substitutions card has the honest options.");
  }
  if (q.includes("ready") || q.includes("done") || q.includes("know")) {
    // The step's look-for cue is the honest doneness answer — a complete
    // human sentence already; let it stand on its own without a prefix.
    return step.lookFor;
  }
  if (q.includes("flame") || q.includes("heat")) return getHelp("medium-flame")?.answer ?? "";
  if (q.includes("protein")) return getHelp("protein-lower")?.answer ?? "";
  // Step-specific curated help first, then the honest general answer.
  for (const id of step.helpIds ?? []) {
    const h = getHelp(id);
    if (h) return h.answer;
  }
  return getHelp("is-it-cooked")?.answer ?? "";
}
