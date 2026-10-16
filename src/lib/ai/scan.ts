// ─────────────────────────────────────────────────────────────
// RUCHI — vision analysis → scan-screen rows (pure, testable)
// ─────────────────────────────────────────────────────────────
// Turns a VisionAnalysis into the confirm-screen rows the user reviews.
// Two things this guarantees:
//   1. Catalog-matched ingredients arrive as confident rows.
//   2. Model names the catalog could NOT map (analysis.uncertainItems) are
//      surfaced as uncertain rows the user confirms or corrects — never
//      silently dropped, and never invented into a catalog id.
//
// Pure: no DOM, no React. Unit-tested directly.

import type { VisionAnalysis } from "./types";

export interface ScanRow {
  /** Stable React key. */
  key: string;
  /** Catalog id — present only for confidently matched rows. */
  id?: string;
  /** Display name (catalog name, or the raw model name when unmapped). */
  name: string;
  quantity?: string;
  /** true → must be confirmed/corrected by the user before cooking. */
  uncertain: boolean;
}

export function visionAnalysisToRows(analysis: VisionAnalysis): ScanRow[] {
  const rows: ScanRow[] = analysis.ingredients.map((ing, i) => ({
    key: `${ing.catalogId ?? ing.label}-${i}`,
    id: ing.catalogId,
    name: ing.label,
    quantity: ing.quantity,
    uncertain: ing.uncertain,
  }));

  // Unmapped model names — keep them visible as uncertain guesses (no id).
  for (const [i, name] of analysis.uncertainItems.entries()) {
    rows.push({
      key: `uncertain-${i}-${name}`,
      name,
      uncertain: true,
    });
  }

  return rows;
}
