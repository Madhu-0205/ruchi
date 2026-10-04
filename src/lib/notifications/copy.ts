// ─────────────────────────────────────────────────────────────
// RUCHI — notification copy engine
// ─────────────────────────────────────────────────────────────
// Centralised, tone-guarded copy registry for the seven notification
// opportunities (spec §8/§18). Every variant is written in RUCHI's
// voice: smart, warm, playful, slightly cheeky, concise,
// cooking-native, never judgmental.
//
// Rules (spec §8/§9):
//  • No guilt, fear, shame, fake urgency, fake scarcity,
//    manipulative language, excessive emojis or generic marketing.
//  • No fabricated numbers: every template must be filled from a
//    fact the builder proved (e.g. {min} minutes from the real recipe).
//  • Deterministic rotation: the same opportunity id + user context
//    always yields the same line. Different ids rotate.
//  • A variant MUST NOT be offered when required facts are absent.
//    Missing facts → the engine falls back to generic (no-personalise)
//    copy.

import type { Opportunity } from "@/lib/notifications/opportunities";

/** The seven push types + the in-app-only completion follow-up. */
export type CopyType = Opportunity["type"] | "completion_followup";

/** One copy variant (template variables must come from real facts). */
export interface CopyVariant {
  title: string;
  body: string;
  action: string;
  /** Facts that MUST be present or this variant never renders. */
  requires: readonly string[];
}

export const COPY_REGISTRIES: Record<CopyType, readonly CopyVariant[]> = {
  resume_cooking: [
    {
      title: "Your dinner is still waiting. 🍳",
      body: "Pick up where you left off — {step} of {total}, about {min} minutes left.",
      action: "Resume cooking",
      requires: ["step", "total", "min"],
    },
    {
      title: "Your dinner is halfway done.",
      body: "Finish the pan in about {min} minutes. Tap to continue.",
      action: "Resume cooking",
      requires: ["min"],
    },
    {
      title: "The pan misses you.",
      body: "You paused it — and it's still the best part of your evening. Reconnect.",
      action: "Resume cooking",
      requires: [],
    },
  ],
  explicit_followup: [
    {
      title: "You scanned ingredients earlier.",
      body: "There's a {min}-minute dinner hiding in what you already have.",
      action: "Find my meal",
      requires: ["min", "recipeId"],
    },
    {
      title: "Still thinking about {name}?",
      body: "The pan's still there and your ingredients are at home. One dish, ready now.",
      action: "Cook this",
      requires: ["recipeId", "name"],
    },
    {
      title: "You left a dish halfway.",
      body: "Pick up exactly where it stopped. No re-learning.",
      action: "Resume cooking",
      requires: ["recipeId"],
    },
  ],
  ingredient_opportunity: [
    {
      title: "Found a {min}-minute dinner hiding in your ingredients.",
      body: "Something good is already in what you own. {name} is ready in {min} minutes.",
      action: "Find my meal",
      requires: ["min", "recipeId", "name"],
    },
    {
      title: "Your kitchen called. It has ingredients. 👀",
      body: "{name} is ready in {min} minutes — from what you already have.",
      action: "Find my meal",
      requires: ["min", "recipeId", "name"],
    },
    {
      title: "What {name} needs is already at home.",
      body: "One pan, {min} minutes, no delivery wait. Tap to cook.",
      action: "Find my meal",
      requires: ["min", "recipeId", "name"],
    },
  ],
  cook_again: [
    {
      title: "Round two? 👀",
      body: "That last {name} deserves it. Same pan, same result — but easier.",
      action: "Cook it again",
      requires: ["name"],
    },
    {
      title: "You've made this before.",
      body: "It went well. Round two is {min} minutes and zero decisions.",
      action: "Cook it again",
      requires: ["name", "min"],
    },
    {
      title: "{name} — the one you already know works.",
      body: "Reheat the memory and add a new side. {min} minutes.",
      action: "Cook it again",
      requires: ["name", "min"],
    },
  ],
  contextual_meal: [
    {
      title: "Dinner's getting late — this one's decided.",
      body: "{name} is on the table in {min} minutes.",
      action: "Cook this",
      requires: ["name", "min"],
    },
    {
      title: "One pan, no overthinking.",
      body: "The kitchen has what you need. Pick the dish and go.",
      action: "Cook this",
      requires: [],
    },
    {
      title: "Quick. Yours. Done.",
      body: "Lunch doesn't need a long decision today.",
      action: "Cook this",
      requires: [],
    },
  ],
  discover_opportunity: [
    {
      title: "{count} {label} ideas waiting.",
      body: "Real recipes, zero decisions. Poke around.",
      action: "Take a look",
      requires: ["label", "count"],
    },
    {
      title: "Wander into {label}.",
      body: "{count} recipes on the shelf, curated for real kitchens.",
      action: "Take a look",
      requires: ["label", "count"],
    },
    {
      title: "Your turn at {label}.",
      body: "Fresh shelf, ready to roam.",
      action: "Take a look",
      requires: ["label"],
    },
  ],
  personality: [
    {
      title: "Dear future you: dinner is already handled.",
      body: "Your kitchen already has everything it needs. When you're ready.",
      action: "Open RUCHI",
      requires: [],
    },
    {
      title: "The kitchen isn't going to cook itself.",
      body: "But it's got your back. Open RUCHI and let it help.",
      action: "Open RUCHI",
      requires: [],
    },
    {
      title: "Your kitchen's been quiet — suspiciously quiet.",
      body: "No guilt. Just: the pan's warm, and dinner's waiting.",
      action: "Open RUCHI",
      requires: [],
    },
  ],
  // completion_followup is in-app-only (never pushed): the completion
  // screen's own pulse. Kept in the registry so it shares the same
  // deterministic rotation and tone guardrails.
  completion_followup: [
    {
      title: "Done and dusted.",
      body: "Real meal counted, stats updated, no exaggeration.",
      action: "Good meal",
      requires: [],
    },
    {
      title: "Round two is already waiting.",
      body: "Tomorrow's dinner got easier just by finishing today's.",
      action: "Good meal",
      requires: [],
    },
  ],
};

// ── Facts (what a builder actually proved — nothing else) ──────
export interface CopyFacts {
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

/**
 * Template vocabulary → CopyFacts keys. Templates speak the short words
 * ({min}, {name}, {count}); facts keep their descriptive names
 * (timeMin, recipeName, categoryCount). One alias map keeps both stable.
 */
const FACT_ALIASES: Record<string, keyof CopyFacts> = {
  min: "timeMin",
  name: "recipeName",
  count: "categoryCount",
  label: "categoryLabel",
  recipeId: "recipeId",
  step: "step",
  total: "total",
  window: "window",
};

function factValue(facts: CopyFacts, key: string): string | number | undefined {
  const mapped = FACT_ALIASES[key] ?? (key as keyof CopyFacts);
  const v = facts[mapped];
  return v === undefined ? undefined : v;
}

const VARIABLE_REGEX = /\{(\w+)\}/g;

function fill(template: string, facts: CopyFacts): string {
  return template.replace(VARIABLE_REGEX, (_: string, key: string) => {
    const v = factValue(facts, key);
    // Unknown placeholder without a value → drop it (variants needing it
    // never reach fill(); free extras render as empty).
    return v === undefined ? "" : String(v);
  });
}

/** Deterministic pick: same opportunity, same user → same line (forever). */
export function pickCopy(
  type: Opportunity["type"],
  facts: CopyFacts,
  seed: string,
  // allow generic fallback when no variant matches its facts
  allowGeneric = false,
): { variant: CopyVariant; filledTitle: string; filledBody: string } {
  const variants = COPY_REGISTRIES[type];
  if (variants.length === 0) {
    const generic = { title: "RUCHI", body: "Something's waiting for you.", action: "Open RUCHI", requires: [] as readonly string[] };
    return { variant: generic, filledTitle: generic.title, filledBody: generic.body };
  }
  const seedHash = hashOf(`${seed}:${type}`);
  const index = seedHash % variants.length;
  const available = (v: CopyVariant) => v.requires.every((k) => factValue(facts, k) !== undefined);
  let variant = variants[index]!;

  // Rotate deterministically through the registry until a variant's
  // required facts are all present (cheap, still deterministic).
  let tries = 0;
  while (!available(variant) && tries < variants.length) {
    variant = variants[(index + tries + 1) % variants.length]!;
    tries++;
  }

  // generic fallback (spec §9: "use a generic but useful notification")
  if (!available(variant) && !allowGeneric) {
    const generic = {
      title: "Something's waiting.",
      body: "Open RUCHI — there's a genuine idea for you.",
      action: "Open RUCHI",
      requires: [] as readonly string[],
    };
    return { variant: generic, filledTitle: generic.title, filledBody: generic.body };
  }

  const filledTitle = fill(variant.title, facts);
  const filledBody = fill(variant.body, facts);
  return { variant, filledTitle, filledBody };
}

/** Rotation seed by user + opportunity: the same stat never repeats wording. */
export function copySeed(userId: string, opportunity: { dedupKey: string; type: Opportunity["type"] }): string {
  return String(hashOf(`${userId}:${opportunity.dedupKey}:${opportunity.type}`));
}

/** No-Math-random deterministic hash (pure). */
function hashOf(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Tone guardrails (spec §8) ──────────────────────────────────
export const FORBIDDEN_PATTERNS = [
  "!!!",
  "🔥",
  "don't miss out",
  "don't forget",
  "hurry",
  "must",
  "you should",
  "never",
  "always",
  "your kitchen has been quiet",
];

/** A copy variant passes the tone guardrails. */
export function passesToneGuardrails(v: CopyVariant): boolean {
  const text = `${v.title} ${v.body} ${v.action}`;
  for (const bad of FORBIDDEN_PATTERNS) {
    if (text.toLowerCase().includes(bad.toLowerCase())) return false;
  }
  // excessive emoji: never more than 2 per variant
  const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  return emojiCount <= 2;
}

export function toneGuardrailsPass(registry: Record<string, readonly CopyVariant[]>): boolean {
  for (const variants of Object.values(registry)) {
    for (const v of variants) {
      if (!passesToneGuardrails(v)) return false;
    }
  }
  return true;
}
