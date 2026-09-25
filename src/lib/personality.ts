// ─────────────────────────────────────────────────────────────
// RUCHI — personality (single source of voice)
// ─────────────────────────────────────────────────────────────
// Every user-facing quip lives here so the tone stays coherent:
// playful, encouraging, slightly cheeky — never judgmental, never
// constant. Screens pick ONE line per moment; they never stack.
//
// All picks are DETERMINISTIC (no Math.random) so SSR and hydration
// always agree — index into pools by a stable input (counts, ids,
// step indices). Copy principles: cooking feels attractive; ordering
// is never shamed; estimates stay estimates; encouragement is sparse
// and specific, never fake praise.

/** Shown once ingredients exist, above the intent picker. */
export const KITCHEN_GOOD_LINES = [
  "Your kitchen looks good. 👀",
  "Solid haul. RUCHI can work with this.",
  "Nice — that's dinner material.",
] as const;

export function kitchenGoodLine(ingredientCount: number): string {
  return KITCHEN_GOOD_LINES[ingredientCount % KITCHEN_GOOD_LINES.length]!;
}

// ── The hunger moment ───────────────────────────────────────
// The hero is a STATEMENT, not a question. RUCHI answers "what's for
// dinner?" — it never asks the user to formulate one. Lines are keyed
// deterministically off the user's real state (kitchen, cook count),
// so first visit and return visits read differently without randomness.

/** First visit, empty kitchen: the promise, plainly. */
export const HOME_HEADLINE_EMPTY = "Your kitchen has\ndinner covered.";

/**
 * Return visit / stocked kitchen: confident context statements.
 * Deterministic pick by cook count — the same visit always reads the same.
 */
export const HOME_HEADLINES = [
  "Something good is\nalready in your kitchen.",
  "Your dinner might\nalready be here.",
  "Tonight just\ngot easier.",
  "We found\nyour dinner.",
] as const;

/** Empty kitchen but they've cooked before — welcoming, never guilt-tripping. */
export const HOME_HEADLINE_EMPTY_RETURN = "The kitchen is empty.\nLet's fix that.";

export function homeHeadline(kitchenSize: number, cookCount: number): string {
  if (kitchenSize === 0) return cookCount === 0 ? HOME_HEADLINE_EMPTY : HOME_HEADLINE_EMPTY_RETURN;
  return HOME_HEADLINES[cookCount % HOME_HEADLINES.length]!;
}

/** Supporting line under the headline — warm, never a task list. */
export const HOME_SUB_LINES = [
  "Scan what you have. RUCHI turns it into dinner.",
  "A quick look, three real options, one pan.",
] as const;

export function homeSubLine(kitchenSize: number): string {
  return HOME_SUB_LINES[kitchenSize % HOME_SUB_LINES.length]!;
}

/**
 * Re-attention for returning users, deterministic by visit count.
 * Uses ONLY real signals (kitchen size, cook count, savings) — never fake
 * urgency, never a popup. Null → the standard sub-line suffices.
 */
export const RETURN_LINES = [
  "Back for dinner? Your kitchen has an idea.",
  "You've got options tonight.",
  "Ready for another one?",
] as const;

export function returnVisitLine(kitchenSize: number, cookCount: number): string | null {
  if (cookCount === 0 || kitchenSize === 0) return null; // first visit, or nothing to cook with
  return RETURN_LINES[cookCount % RETURN_LINES.length]!;
}

/** "₹1,840 kept in your pocket." — only ever from the real aggregate. */
export function keptInPocket(totalSaved: number): string {
  return `₹${totalSaved.toLocaleString("en-IN")} kept in your pocket.`;
}

export const ABOUT_TO_ORDER_LINES = [
  "Your kitchen called. It has an idea. 📞",
  "Before you order… your kitchen first. 👀",
  "Your dinner might already be here.",
  "Don't overthink it. I've got dinner.",
] as const;

// ── Fast lanes ──────────────────────────────────────────────

/** Whisper under the featured-meal CTA — never competes with the dish. */
export const FEATURED_CTA_HINT = "One tap. Step-by-step from here.";

export const FIND_MY_MEAL_LABEL = "Find My Meal ✨";

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

export const RECENTLY_COOKED_HEADING = "Recently cooked";
export const COOK_AGAIN_LABEL = "Cook again";

export const LET_RUCHI_CHOOSE_LABEL = "Let RUCHI Choose 🤷";
export const LET_RUCHI_CHOOSE_SUB = "I'll pick from your kitchen. 20 seconds, decided.";

// ── Cost as value, not shame ────────────────────────────────
// Only ever paired with the engine's real estimate. Never invented.

export function canMakeFor(cost: number): string {
  return `You can make this for ~₹${cost}.`;
}

// ── Cooking-mode confidence moments ─────────────────────────
// Sparse, earned. Surfaced after selected step completions — not every
// step, or it becomes noise.

/** "You're ~8 minutes away." — the one reassurance line per step. */
export function minutesToDinner(minutes: number): string {
  return `You're ~${minutes} minutes away from dinner.`;
}

export const STEP_CHEERS = [
  "Nice. That's exactly what we wanted.",
  "Looking good. 🔥",
  "You're doing fine.",
  "See? You already know more than you thought.",
] as const;

/** Deterministic, sparse: roughly every 3rd completed step gets a cheer. */
export function stepCheer(stepIndex: number): string | null {
  if (stepIndex < 0 || (stepIndex + 1) % 3 !== 0) return null;
  return STEP_CHEERS[stepIndex % STEP_CHEERS.length]!;
}

/** "That's the hard part done." — shown at the midpoint step only. */
export function milestoneLine(stepIndex: number, stepCount: number): string | null {
  if (stepCount < 4) return null;
  return stepIndex + 1 === Math.ceil(stepCount / 2) ? "That's the hard part done." : null;
}

// ── Mistake handling: reduce panic, never fake safety ───────

export const REASSURANCE_LINES = [
  "Not quite there yet? Give it another minute.",
  "Your onions don't need to look perfect.",
  "Cooking isn't a chemistry exam.",
  "Small differences are okay.",
] as const;

/** Stable pick per step — the reassurance context doesn't reshuffle mid-cook. */
export function reassuranceLine(stepIndex: number): string {
  return REASSURANCE_LINES[stepIndex % REASSURANCE_LINES.length]!;
}

export const CUE_NOT_PERFECT = "Close enough counts. Keep going.";

// ── Completion ──────────────────────────────────────────────

export const MADE_IT_HEADLINE = "You made it.";

export const DIDNT_ORDER_LINE = "You didn't order dinner.\nYou made it. 🔥";

/** Deterministic by cook count — the last line before they leave the screen. */
export const COMPLETION_ECHO_LINES = [
  "Turns out you can cook. 👀",
  "That was easier than expected, right?",
  "Same time tomorrow? I'll have ideas.",
] as const;

export function completionEcho(cookCount: number): string {
  return COMPLETION_ECHO_LINES[cookCount % COMPLETION_ECHO_LINES.length]!;
}

// ── Behavior-based personalization (ranking signals only) ───
// Evidence-gated: only speak once there's a real pattern, and phrase it
// as an observation, never surveillance. Returns null until then.

export interface CookSignal {
  recipeId: string;
  recipeName: string;
  proteinG: number;
  cost: number;
  deliveryCompareCost: number;
}

/**
 * Repeat-protein nudge: after 2+ cooked meals averaging 25g+ protein,
 * acknowledge the pattern before they choose. "Going with another quick
 * protein meal?" — not "we know you always eat eggs."
 */
export function proteinPatternLine(history: CookSignal[]): string | null {
  if (history.length < 2) return null;
  const recent = history.slice(0, 5);
  const avg = recent.reduce((s, h) => s + h.proteinG, 0) / recent.length;
  return avg >= 25 ? "Going with another protein-packed meal?" : null;
}
