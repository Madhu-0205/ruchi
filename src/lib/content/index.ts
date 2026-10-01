// ─────────────────────────────────────────────────────────────
// RUCHI — content system barrel (personality engine)
// ─────────────────────────────────────────────────────────────
// The personality engine's public surface. UI components import from
// here only — pools, engine and memory stay internal details.
// ─────────────────────────────────────────────────────────────

import type { ContentContext } from "./types";
import { beginContentSession, currentSession } from "./memory";

export type {
  ContentCategory,
  ContentTone,
  RuchiContentItem,
  ContentContext,
  ContentPick,
} from "./types";
export { POOLS, type PoolName } from "./pools";
export { pickContent, pickAndNote, hashOf } from "./engine";
export { ingredientQuip, findMyMealRevealLine } from "./microcopy";
export {
  beginContentSession,
  currentSession,
  advanceSession,
  noteShown,
} from "./memory";

/**
 * Derive the content context from REAL app state. Nothing here is
 * inferred or invented: first-time means no completions on record,
 * cooked-recently means a real completion today or yesterday.
 */
export function buildContentContext(input: {
  hour: number;
  historyLength: number;
  lastCookedAt?: number;
  now: number;
}): ContentContext {
  const dayMs = 24 * 60 * 60 * 1000;
  const cookedRecently =
    input.historyLength > 0 &&
    typeof input.lastCookedAt === "number" &&
    input.now - input.lastCookedAt < 2 * dayMs;
  return {
    hour: input.hour,
    isFirstTime: input.historyLength === 0,
    hasHistory: input.historyLength > 0,
    cookedRecently,
    hasCookAgain: input.historyLength > 0,
  };
}

/** One-liner the app calls once per page open. */
export function startContentSession(): number {
  return beginContentSession();
}

export { currentSession as contentSession };
