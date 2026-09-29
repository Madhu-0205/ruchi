// ─────────────────────────────────────────────────────────────
// RUCHI — motion system
// One source of truth for durations, easing, springs and
// transition presets. Screens compose presets; they never invent
// their own animation values. Every preset pairs with
// useReducedMotion() — the primitives in components/motion.tsx
// render instantly when the user opts out.
//
// Vocabulary:
//   FAST      micro feedback (press, chip, nav)       100–160ms
//   STANDARD  ordinary UI transitions                 180–280ms
//   EMPHASIS  hero / reveal moments                   350–650ms
//   CINEMATIC major scene transitions                 600–900ms
// ─────────────────────────────────────────────────────────────

/** Signature ease — fast start, long soft settle. The RUCHI curve. */
export const EASE = [0.22, 1, 0.36, 1] as const;
/** Exit ease — shorter, decisive. */
export const EASE_OUT = [0.4, 0, 1, 1] as const;

export const DURATION = {
  fast: 0.14,
  standard: 0.22,
  emphasis: 0.45,
  cinematic: 0.7,
} as const;

/**
 * Spring presets. stiff/soft pair: tactile controls snap with a
 * whisper of overshoot; hero lands heavier with none.
 */
export const SPRING = {
  /** Tactile controls — chips, toggles, small elements. */
  tactile: { type: "spring", stiffness: 500, damping: 30 },
  /** Small elements entering/leaving a list. */
  list: { type: "spring", damping: 26, stiffness: 320 },
  /** Hero content — heavier, zero overshoot, premium settle. */
  hero: { type: "spring", stiffness: 210, damping: 26 },
  /** Bottom sheets — weighty glide, no bounce. */
  sheet: { type: "spring", damping: 30, stiffness: 300 },
} as const;

/** Stagger rhythm — children follow at this interval. */
export const STAGGER_CHILDREN = 0.06;
export const STAGGER_DELAY = 0.04;
/** Cap so long lists don't take forever to arrive. */
export const STAGGER_MAX_DELAY = 0.3;

// ── Named transition presets ────────────────────────────────

/** Page-level enter/exit (screens swap via AnimatePresence). */
export const pageTransition = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.14, ease: EASE_OUT } },
} as const;

/** Hero reveal: image first, then title, then meta, then CTA. */
export const heroReveal = {
  image: { initial: { opacity: 0, scale: 0.97, y: 8 }, animate: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION.emphasis, ease: EASE } } },
  title: { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: 0.08 } } },
  meta: { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE, delay: 0.16 } } },
  cta: { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: SPRING.hero, delay: 0.22 } },
} as const;

/** Step advance inside Cooking Mode — spatial continuity, small move. */
export const stepTransition = {
  initial: { opacity: 0, x: 18 },
  animate: { opacity: 1, x: 0, transition: { duration: DURATION.standard, ease: EASE } },
  exit: { opacity: 0, x: -12, transition: { duration: DURATION.fast, ease: EASE_OUT } },
} as const;

/** Ingredient/chip reveal — soft bloom, tiny scale. */
export const bloomIn = {
  initial: { opacity: 0, scale: 0.96, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: SPRING.list },
} as const;

/** Tactile press for buttons that need compression feedback. */
export const pressTap = { scale: 0.97 } as const;
export const pressTapDeep = { scale: 0.94 } as const;
