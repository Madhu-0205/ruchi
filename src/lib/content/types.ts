// ─────────────────────────────────────────────────────────────
// RUCHI — content system types (personality engine, part 1/4)
// ─────────────────────────────────────────────────────────────
// The personality engine's contract. A ContentItem is a curated piece
// of voice; ContentContext is everything selection may consider — all
// of it REAL user/app state, never fabricated. Selection itself lives
// in engine.ts; pools in pools.ts; session memory in memory.ts.
// ─────────────────────────────────────────────────────────────

/** What kind of moment this content serves. */
export type ContentCategory =
  | "GREETING"
  | "COOKING_THOUGHT"
  | "FOOD_HUMOR"
  | "KITCHEN_REALITY"
  | "INGREDIENT_HUMOR"
  | "SMALL_ENCOURAGEMENT"
  | "DISCOVERY"
  | "RETURNING_USER"
  | "FIRST_TIME_USER"
  | "COOK_AGAIN"
  | "COMPLETION";

/** Tone guardrails — selection can filter to a desired register. */
export type ContentTone =
  | "warm"
  | "playful"
  | "cheeky"
  | "encouraging"
  | "wise"
  | "cheeky-warm";

/** One curated piece of RUCHI voice. */
export interface RuchiContentItem {
  /** Stable, unique — the rotation memory keys on it. */
  id: string;
  text: string;
  category: ContentCategory;
  tone: ContentTone;
  /**
   * Local hour [min, max) when this item may appear. Morning lines
   * don't show at midnight. Omitted (or null) = any time.
   */
  hours?: [number, number] | null;
  /** Higher wins ties. Practical default: everything 5. */
  priority?: number;
  /** Sessions this item stays retired after being shown. Default 4. */
  cooldown?: number;
  /** Kill switch — inactive items never surface, no code edit needed. */
  active?: boolean;
}

/** Every input selection uses. All fields reflect REAL app state. */
export interface ContentContext {
  /** Local hour of day (0–23) — for time-aware pools. */
  hour: number;
  /** The user has never completed a cooked meal. */
  isFirstTime: boolean;
  /** Real completions exist (history.length > 0). */
  hasHistory: boolean;
  /** A real completion happened recently (same day or yesterday). */
  cookedRecently: boolean;
  /** Cook Again is genuinely available (a real completed recipe exists). */
  hasCookAgain: boolean;
}

/** The chosen item plus everything the caller needs. */
export interface ContentPick {
  item: RuchiContentItem;
  /** Pool this item came from — for analytics/observability. */
  pool: string;
}
