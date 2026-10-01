// ─────────────────────────────────────────────────────────────
// RUCHI — content pools (personality engine, part 2/4)
// ─────────────────────────────────────────────────────────────
// The curated voice of RUCHI. Quality over quantity — every line is
// something RUCHI would actually say. Categories, tones, time windows,
// priorities and cooldowns are metadata the engine rotates on. Adding,
// editing, disabling or retiring a line never touches a UI component.
//
// Voice contract (see spec): smart, warm, playful, slightly cheeky.
// Never: cringe, judgmental, fake-urgency, fabricated personalization.
// No line claims user facts — "your kitchen" is observation, "you've
// cooked 5 meals" is a database claim and lives nowhere in here.
// ─────────────────────────────────────────────────────────────

import type { RuchiContentItem } from "./types";

/**
 * Session greetings — the hero's first sentence. Time-windowed so
 * midnight users aren't told good morning. Rotation keeps repeat
 * visits fresh without changing the page structure.
 */
export const GREETINGS: RuchiContentItem[] = [
  // Any time — the evergreen spine.
  {
    id: "g-kitchen-called",
    text: "Your kitchen called. It has ideas.",
    category: "GREETING",
    tone: "playful",
    priority: 5,
  },
  {
    id: "g-what-are-we-cooking",
    text: "Okay, what are we cooking?",
    category: "GREETING",
    tone: "warm",
    priority: 5,
  },
  {
    id: "g-ingredients-opinion",
    text: "Your ingredients already have an opinion.",
    category: "GREETING",
    tone: "cheeky",
    priority: 5,
  },
  {
    id: "g-fix-the-day",
    text: "One good meal can fix a surprisingly large part of the day.",
    category: "GREETING",
    tone: "wise",
    priority: 5,
  },
  {
    id: "g-turn-into-dangerous",
    text: "Let's turn those ingredients into something dangerous.",
    category: "GREETING",
    tone: "cheeky",
    priority: 5,
  },
  {
    id: "g-we-have-ideas",
    text: "You have ingredients. We have ideas.",
    category: "GREETING",
    tone: "warm",
    priority: 5,
  },
  // Morning (5–11): fresh, light, positive.
  {
    id: "g-morning-kitchen",
    text: "Good morning. Your kitchen called.",
    category: "GREETING",
    tone: "warm",
    hours: [5, 11],
    priority: 7, // beats evergreen inside its window
  },
  {
    id: "g-morning-plan",
    text: "Morning. Let's make today's dinner the easy part.",
    category: "GREETING",
    tone: "encouraging",
    hours: [5, 11],
    priority: 7,
  },
  // Afternoon (12–16): energetic, practical.
  {
    id: "g-afternoon-plan",
    text: "What's the plan, chef?",
    category: "GREETING",
    tone: "playful",
    hours: [12, 16],
    priority: 7,
  },
  {
    id: "g-afternoon-sneaky",
    text: "Sneak in some cooking before the day gets away.",
    category: "GREETING",
    tone: "encouraging",
    hours: [12, 16],
    priority: 6,
  },
  // Evening (17–21): comforting, hungry, playful.
  {
    id: "g-evening-dinner",
    text: "Dinner's not a question anymore. It's a plan.",
    category: "GREETING",
    tone: "playful",
    hours: [17, 21],
    priority: 7,
  },
  // Late night (22–4): funny, low-pressure, comfort-food energy.
  {
    id: "g-late-night",
    text: "Midnight cravings? We don't judge.",
    category: "GREETING",
    tone: "cheeky",
    hours: [22, 24],
    priority: 7,
  },
  {
    id: "g-late-night-honest",
    text: "Late-night kitchen runs have produced greatness before.",
    category: "GREETING",
    tone: "cheeky",
    hours: [0, 5],
    priority: 7,
  },
];

/** Cooking thoughts — atmosphere, wisdom, never preachy. */
export const THOUGHTS: RuchiContentItem[] = [
  {
    id: "t-not-complicated",
    text: "Good food doesn't need to be complicated.",
    category: "COOKING_THOUGHT",
    tone: "wise",
  },
  {
    id: "t-actually-make-tonight",
    text: "The best recipe is sometimes the one you can actually make tonight.",
    category: "COOKING_THOUGHT",
    tone: "wise",
  },
  {
    id: "t-trust-the-pan",
    text: "Learning to cook is really learning to trust yourself around a pan.",
    category: "COOKING_THOUGHT",
    tone: "wise",
  },
  {
    id: "t-one-lonely-onion",
    text: "Sometimes dinner starts with one lonely onion.",
    category: "COOKING_THOUGHT",
    tone: "warm",
  },
  {
    id: "t-small-meals",
    text: "Small meals still count.",
    category: "COOKING_THOUGHT",
    tone: "encouraging",
  },
  {
    id: "t-stop-perfect",
    text: "Cooking gets easier when you stop trying to make it perfect.",
    category: "COOKING_THOUGHT",
    tone: "encouraging",
  },
];

/** Food humor — cooking-native jokes, used sparingly. */
export const HUMOR: RuchiContentItem[] = [
  {
    id: "h-maggi-arc",
    text: "Your Maggi deserves character development.",
    category: "FOOD_HUMOR",
    tone: "cheeky",
  },
  {
    id: "h-egg-founders",
    text: "Eggs are basically the startup founders of the kitchen.",
    category: "FOOD_HUMOR",
    tone: "cheeky",
  },
  {
    id: "h-ordering-is-cooking",
    text: "Technically, ordering food is also cooking… for someone else.",
    category: "FOOD_HUMOR",
    tone: "cheeky",
  },
  {
    id: "h-onion-moment",
    text: "That onion has been waiting for its moment.",
    category: "FOOD_HUMOR",
    tone: "cheeky",
  },
  {
    id: "h-five-ingredients",
    text: "Five ingredients. One pan. Zero drama.",
    category: "FOOD_HUMOR",
    tone: "playful",
  },
  {
    id: "h-fridge-mysterious",
    text: "Your fridge isn't empty. It's just being mysterious.",
    category: "KITCHEN_REALITY",
    tone: "cheeky",
  },
  {
    id: "h-chef-hat",
    text: "Chef hat optional. Confidence required.",
    category: "SMALL_ENCOURAGEMENT",
    tone: "cheeky",
  },
  {
    id: "h-looks-harder",
    text: "Let's make something that looks harder than it is.",
    category: "FOOD_HUMOR",
    tone: "playful",
  },
];

/**
 * Returning-user lines — real-state keyed, never guilt-tripping.
 * Shown alongside the hero when the user has history.
 */
export const RETURNING: RuchiContentItem[] = [
  {
    id: "r-back-kitchen",
    text: "Back in the kitchen?",
    category: "RETURNING_USER",
    tone: "warm",
  },
  {
    id: "r-another-round",
    text: "Ready for another round?",
    category: "RETURNING_USER",
    tone: "playful",
  },
  {
    id: "r-what-cooking",
    text: "What's cooking?",
    category: "RETURNING_USER",
    tone: "warm",
  },
  {
    id: "r-kitchen-potential",
    text: "Your kitchen has potential. Let's use it.",
    category: "RETURNING_USER",
    tone: "encouraging",
  },
];

/** First-time lines — no pretending to know the user. */
export const FIRST_TIME: RuchiContentItem[] = [
  {
    id: "f-start-with-what-you-have",
    text: "Let's start with what you already have.",
    category: "FIRST_TIME_USER",
    tone: "warm",
  },
  {
    id: "f-first-meal-waiting",
    text: "Your first RUCHI meal is still waiting.",
    category: "FIRST_TIME_USER",
    tone: "encouraging",
  },
  {
    id: "f-show-ingredients",
    text: "Show RUCHI what's in your kitchen — dinner follows.",
    category: "FIRST_TIME_USER",
    tone: "warm",
  },
];

/** Cook Again continuity — only ever shown when real history supports it. */
export const COOK_AGAIN: RuchiContentItem[] = [
  {
    id: "c-run-it-back",
    text: "That one worked. Run it back?",
    category: "COOK_AGAIN",
    tone: "playful",
  },
  {
    id: "c-respect-consistency",
    text: "You've made this before. We respect consistency.",
    category: "COOK_AGAIN",
    tone: "cheeky",
  },
  {
    id: "c-want-another",
    text: "Want another round of a known good?",
    category: "COOK_AGAIN",
    tone: "warm",
  },
];

/** Completion celebration — earned, restrained, rotated. */
export const COMPLETION: RuchiContentItem[] = [
  {
    id: "x-look-at-you",
    text: "Look at you. You cooked.",
    category: "COMPLETION",
    tone: "playful",
  },
  {
    id: "x-that-counts",
    text: "That counts.",
    category: "COMPLETION",
    tone: "warm",
  },
  {
    id: "x-not-bad-chef",
    text: "Not bad, chef.",
    category: "COMPLETION",
    tone: "cheeky",
  },
  {
    id: "x-made-by-you",
    text: "Another meal made by you.",
    category: "COMPLETION",
    tone: "warm",
  },
  {
    id: "x-kitchen-interesting",
    text: "Your kitchen just got a little more interesting.",
    category: "COMPLETION",
    tone: "cheeky-warm",
  },
];

/** All pools in one registry — the engine's source of truth. */
export const POOLS = {
  greetings: GREETINGS,
  thoughts: THOUGHTS,
  humor: HUMOR,
  returning: RETURNING,
  firstTime: FIRST_TIME,
  cookAgain: COOK_AGAIN,
  completion: COMPLETION,
} as const;

export type PoolName = keyof typeof POOLS;
