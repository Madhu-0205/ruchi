// ─────────────────────────────────────────────────────────────
// RUCHI — personality (single source of voice)
// ─────────────────────────────────────────────────────────────
// Every user-facing quip lives here so the tone stays coherent:
// playful, encouraging, slightly cheeky — never judgmental, never
// constant. Screens pick ONE line per moment; they never stack.
//
// All picks are DETERMINISTIC (no Math.random) so SSR and hydration
// always agree — index into pools by a stable input (counts, ids).

/** Shown once ingredients exist, above the intent picker. */
export const KITCHEN_GOOD_LINES = [
  "Your kitchen looks good. 👀",
  "Solid haul. RUCHI can work with this.",
  "Nice — that's dinner material.",
] as const;

export function kitchenGoodLine(ingredientCount: number): string {
  return KITCHEN_GOOD_LINES[ingredientCount % KITCHEN_GOOD_LINES.length]!;
}

/** Sub-copy under the Find My Meal CTA, keyed by the first chosen intent. */
export const INTENT_WHISPERS: Record<string, string> = {
  "high-protein": "Your protein target is about to get some help. 💪",
  quick: "You could order food… or be eating this in 14 minutes.",
  budget: "Big flavor, small bill. Your wallet approves.",
  healthy: "Balanced, not boring. That's the deal.",
  indian: "Proper masala energy. No delivery queue.",
  comfort: "Warm plate, zero fuss. Incoming.",
};

export const FIND_MY_MEAL_SUB = "We'll figure out dinner.";

export function intentWhisper(intents: string[]): string {
  return INTENT_WHISPERS[intents[0] ?? ""] ?? FIND_MY_MEAL_SUB;
}

/** Cooking mode — the one reassurance line per step. */
export function minutesToDinner(minutes: number): string {
  return `You're ~${minutes} minutes away from dinner.`;
}

/** Completion screen. */
export const MADE_IT_HEADLINE = "You made it.";
export const DIDNT_ORDER_LINE = "You didn't order dinner.\nYou made it. 🔥";
