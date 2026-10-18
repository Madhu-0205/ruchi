// ─────────────────────────────────────────────────────────────
// RUCHI — scan → home goal hand-off: whose goals win (pure)
// ─────────────────────────────────────────────────────────────
// The store owns the transfer (publication revision, consumption); this
// module owns the CONSUMER DECISION — what the home screen should do with
// the transfer it is looking at right now. It is pure and React-free so the
// rules can be unit-tested without a renderer, and both the render-phase
// application and the recommendation filters read the SAME decision.
//
// The rules, in order:
//   1. revision 0            → nothing was ever published. Nothing applies.
//   2. consumed              → that publication was already consumed (a
//                              re-mount sees this). Nothing applies, so a
//                              consumed transfer can never come back.
//   3. revision <= applied   → this mount already applied it (re-render,
//                              Strict Mode's second pass). Nothing applies.
//   4. otherwise             → apply THIS revision and its goals.
//
// Note what is deliberately absent: the payload LENGTH is never used as the
// transfer identity. An empty publication is a real publication — the user
// cleared every goal chip — so it applies as an empty goal set. The scan
// screen clears all four chips by default-off, and that choice must reach
// home instead of being mistaken for "no transfer at all".
//
// On "restore the current preferences": this codebase has no `prefs.intents`
// (UserPreferences holds diet/allergies/fitnessGoal/skill/servings/budget/
// cuisines/equipment, and fitnessGoal is never mapped to intents). The only
// goal preference is the home screen's own selection, so that is what an
// empty publication hands control back to — the engine then ranks on the
// preference-derived filters it already had (diet, budget, time, servings)
// with no goal boost.

import { isIntentGoalChipId } from "@/lib/types";
import type { Intent } from "@/lib/types";

/** The store state that describes the current scan transfer. */
export interface ScanGoalTransfer {
  /** Goals published by the scan screen. `[]` = the user chose no goal. */
  goals: readonly Intent[];
  /** Publication identity. 0 = no publication has ever happened. */
  revision: number;
  /** True once the publication at `revision` was consumed. */
  consumed: boolean;
}

/** The consumer's verdict for one render. */
export type ScanGoalDecision =
  | { apply: false }
  | { apply: true; revision: number; goals: Intent[] };

const NOTHING_TO_APPLY: ScanGoalDecision = { apply: false };

/**
 * Should this transfer be applied by a consumer that has already applied
 * `appliedRevision`? Returns the validated goals to activate when it should.
 */
export function decideScanGoalTransfer(
  transfer: ScanGoalTransfer,
  appliedRevision: number,
): ScanGoalDecision {
  if (transfer.revision === 0) return NOTHING_TO_APPLY;
  if (transfer.consumed) return NOTHING_TO_APPLY;
  if (transfer.revision <= appliedRevision) return NOTHING_TO_APPLY;
  // Untrusted boundary: keep only ids the product exposes as goal chips, in
  // the order the user chose them.
  return {
    apply: true,
    revision: transfer.revision,
    goals: transfer.goals.filter(isIntentGoalChipId),
  };
}

/**
 * The goals that drive recommendations for this render: the transfer's when
 * one applies, otherwise the screen's own selection (the preference
 * fallback). ONE derivation — filters, `recommend()` and the AI re-rank all
 * read this value.
 *
 * Returns the caller's own array by REFERENCE when no transfer applies, so a
 * memoized `filters` object keeps its identity across renders (HomeScreen's
 * AI re-rank effect depends on it). The decision's array is already fresh.
 */
export function activeGoals(decision: ScanGoalDecision, ownSelection: Intent[]): Intent[] {
  return decision.apply ? decision.goals : ownSelection;
}
