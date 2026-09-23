"use client";

import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui";
import { FoodVisual } from "@/components/FoodVisual";
import type { Recipe } from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// RUCHI — recipe card
// The core repeatable surface. Editorial hierarchy: visual → title →
// metadata line → cost. Typography and spacing carry the information;
// pills are the exception, not the rule. Hover: image zoom + lift.
// ─────────────────────────────────────────────────────────────

export function RecipeCard({
  recipe,
  protein,
  costPerServing,
  missingCount,
  canCookNow,
  coreMatched,
  coreTotal,
  onClick,
  reason,
  size = "md",
  layout = "auto",
}: {
  recipe: Recipe;
  protein: number;
  costPerServing: number;
  missingCount: number;
  canCookNow: boolean;
  /** matched/total core-ingredient counts ("4/4 core ingredients available"). */
  coreMatched?: number;
  coreTotal?: number;
  onClick: () => void;
  reason?: string;
  size?: "md" | "lg";
  /** "vertical" forces the stacked layout even on wide viewports —
   * needed inside narrow rail/grid containers where the viewport-keyed
   * row layout would cramp the text column. */
  layout?: "auto" | "vertical";
}) {
  const lg = size === "lg";
  const vertical = layout === "vertical" || lg;
  // Row layout keys off lg: (not sm:) — the wide 6xl container only exists
  // at lg+; below that cards live in the 448px column and must stay vertical.
  return (
    <Card onClick={onClick} className="group h-full overflow-hidden">
      <div className={vertical ? "flex flex-col" : "flex flex-col lg:flex-row"}>
        {/* Visual */}
        <div className={vertical ? "" : "lg:w-44 lg:shrink-0"}>
          <FoodVisual
            recipe={recipe}
            zoom
            emojiClassName={lg ? "text-7xl" : "text-5xl lg:text-6xl"}
            className={`w-full ${
              vertical
                ? lg
                  ? "aspect-[16/9]"
                  : "aspect-[4/3]"
                : "aspect-[4/3] lg:h-full lg:aspect-auto lg:min-h-[9rem]"
            }`}
          />
        </div>

        {/* Body */}
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <h3
              className={`font-display font-semibold leading-snug tracking-tight text-ink transition-colors duration-200 group-hover:text-flame-deep ${
                lg ? "text-[21px]" : "text-[17px]"
              }`}
            >
              {recipe.name}
            </h3>
            <ArrowUpRight
              size={16}
              aria-hidden
              className="mt-1 shrink-0 text-muted/50 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-flame"
            />
          </div>

          {reason && <p className="mt-1 line-clamp-1 text-[13px] text-muted">{reason}</p>}

          {/* Metadata line — typographic, not pills */}
          <p className="mt-2 text-[13px] font-medium text-muted">
            {recipe.timeMin} min
            <span aria-hidden className="mx-1.5 text-line-strong">·</span>
            {protein}g protein
            <span aria-hidden className="mx-1.5 text-line-strong">·</span>
            <span className="capitalize">{recipe.difficulty}</span>
          </p>

          {/* Bottom row: cost + status */}
          <div className="mt-auto flex items-center justify-between gap-2 pt-3">
            <span className="text-[15px] font-bold text-ink">₹{costPerServing}</span>
            {canCookNow ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-sage">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sage" />
                {coreMatched !== undefined && coreTotal !== undefined
                  ? `${coreMatched}/${coreTotal} core ingredients available`
                  : "Can cook now"}
              </span>
            ) : missingCount > 0 ? (
              <span className="text-[12px] text-muted">
                {missingCount} missing
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
