// ─────────────────────────────────────────────────────────────
// RUCHI — micro-copy (personality engine extension)
// ─────────────────────────────────────────────────────────────
// Used-sparingly voice for small moments: ingredient chip taps and the
// Find My Meal reveal. Same rules as the main pools: curated, real-
// context-gated, deterministic rotation, no fabricated claims.
//
// Ingredient quips rotate deterministically per tap count and cool down
// like every other pool — a chip never says the same thing twice in a
// row, and the humor appears only occasionally, never on every tap.
// ─────────────────────────────────────────────────────────────

import type { RuchiContentItem } from "./types";
import { noteShown, recentShown, currentSession } from "./memory";
import { hashOf } from "./engine";

/**
 * Occasional-voice gate: roughly every third tap gets a quip, so the
 * kitchen never becomes a joke generator. Deterministic per tap count.
 */
export function shouldQuip(tapCount: number): boolean {
  return tapCount > 0 && (tapCount + 1) % 3 === 0;
}

/** Per-ingredient voice lines — only for ingredients that have one. */
const INGREDIENT_QUIPS: Record<string, RuchiContentItem[]> = {
  egg: [
    { id: "iq-egg-1", text: "Reliable.", category: "INGREDIENT_HUMOR", tone: "cheeky" },
    { id: "iq-egg-2", text: "The hardest worker in your kitchen.", category: "INGREDIENT_HUMOR", tone: "warm" },
  ],
  onion: [
    { id: "iq-onion-1", text: "The supporting actor.", category: "INGREDIENT_HUMOR", tone: "cheeky" },
    { id: "iq-onion-2", text: "Every good story starts here.", category: "INGREDIENT_HUMOR", tone: "wise" },
  ],
  tomato: [
    { id: "iq-tomato-1", text: "About to make everything better.", category: "INGREDIENT_HUMOR", tone: "warm" },
  ],
  paneer: [
    { id: "iq-paneer-1", text: "Protein with main-character energy.", category: "INGREDIENT_HUMOR", tone: "cheeky" },
  ],
  maggi: [
    { id: "iq-maggi-1", text: "We know why you're here.", category: "INGREDIENT_HUMOR", tone: "cheeky" },
  ],
  curd: [
    { id: "iq-curd-1", text: "The quiet cool-down.", category: "INGREDIENT_HUMOR", tone: "warm" },
  ],
  potato: [
    { id: "iq-potato-1", text: "Never has a bad idea.", category: "INGREDIENT_HUMOR", tone: "cheeky" },
  ],
  bread: [
    { id: "iq-bread-1", text: "Dinner's honest fallback.", category: "INGREDIENT_HUMOR", tone: "warm" },
  ],
  rice: [
    { id: "iq-rice-1", text: "The foundation holds.", category: "INGREDIENT_HUMOR", tone: "wise" },
  ],
};

/**
 * One quip for an ingredient tap, or null. Rotates deterministically by
 * (ingredient id, tap count), never repeats the immediately-previous
 * quip for that ingredient, and respects the engine's cooldown memory.
 */
export function ingredientQuip(
  ingredientId: string,
  tapCount: number,
): string | null {
  if (!shouldQuip(tapCount)) return null;
  const lines = INGREDIENT_QUIPS[ingredientId];
  if (!lines || lines.length === 0) return null;

  const pool = `ingredient:${ingredientId}`;
  const session = currentSession();
  const recent = recentShown(pool);
  const prevId = recent[0]?.id;

  const ordered = [...lines].sort((a, b) => {
    const ha = hashOf(`${pool}:${a.id}:${tapCount}`);
    const hb = hashOf(`${pool}:${b.id}:${tapCount}`);
    return ha - hb || a.id.localeCompare(b.id);
  });
  const pick = ordered.find((i) => i.id !== prevId) ?? ordered[0]!;
  noteShown(pool, pick.id, session);
  return pick.text;
}

// ── Find My Meal reveal lines ───────────────────────────────
// The anticipation moment between pressing the CTA and the results
// appearing. Selected deterministically per use-count, keyed by real
// kitchen size — a full kitchen and a bare one get different energy.

const REVEAL_FULL: RuchiContentItem[] = [
  { id: "fr-full-1", text: "Reading your kitchen…", category: "DISCOVERY", tone: "playful" },
  { id: "fr-full-2", text: "Connecting the dots…", category: "DISCOVERY", tone: "playful" },
  { id: "fr-full-3", text: "Weighing your options. There are good ones.", category: "DISCOVERY", tone: "cheeky" },
  { id: "fr-full-4", text: "Almost there — and it smells promising.", category: "DISCOVERY", tone: "warm" },
];

const REVEAL_BARE: RuchiContentItem[] = [
  { id: "fr-bare-1", text: "Let's see what we can do…", category: "DISCOVERY", tone: "encouraging" },
  { id: "fr-bare-2", text: "Working with what's here.", category: "DISCOVERY", tone: "warm" },
];

/**
 * A reveal line for the Find My Meal moment. Keyed on the REAL kitchen
 * size (full vs sparse energy), rotates per use count, never repeats
 * the previous line in a row.
 */
export function findMyMealRevealLine(kitchenSize: number, useCount: number): string {
  const lines = kitchenSize >= 3 ? REVEAL_FULL : REVEAL_BARE;
  const pool = "find-my-meal-reveal";
  const recent = recentShown(pool);
  const prevId = recent[0]?.id;

  const ordered = [...lines].sort((a, b) => {
    const ha = hashOf(`${pool}:${a.id}:${useCount}`);
    const hb = hashOf(`${pool}:${b.id}:${useCount}`);
    return ha - hb || a.id.localeCompare(b.id);
  });
  const pick = ordered.find((i) => i.id !== prevId) ?? ordered[0]!;
  noteShown(pool, pick.id, currentSession());
  return pick.text;
}
