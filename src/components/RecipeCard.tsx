"use client";

import { ArrowUpRight, Clock } from "lucide-react";
import { Card } from "@/components/ui";
import { FoodVisual } from "@/components/FoodVisual";
import { canMakeFor } from "@/lib/personality";
import type { Recipe } from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// RUCHI — recipe card
// The core repeatable surface. Premium hierarchy: visual (with intent
// badges + time) → title → decision stats (protein / kcal / cost) →
// why RUCHI picked it → Cook this. Whitespace and type size carry the
// ranking; badges are the exception. All numbers stay estimates.
// ─────────────────────────────────────────────────────────────

const TAG_LABELS: Record<string, string> = {
  "high-protein": "High protein",
  healthy: "Healthy",
  quick: "Quick",
  budget: "Budget",
  comfort: "Comfort",
  spicy: "Spicy",
};

export function RecipeCard({
  recipe,
  protein,
  calories,
  costPerServing,
  missingCount,
  canCookNow,
  coreMatched,
  coreTotal,
  onClick,
  onCook,
  reason,
  tags = [],
  why = [],
  notNeeded = [],
  size = "md",
  layout = "auto",
  deliveryCompareCost,
}: {
  recipe: Recipe;
  protein: number;
  /** kcal per serving — shown when provided (recommendation cards). */
  calories?: number;
  costPerServing: number;
  missingCount: number;
  canCookNow: boolean;
  /** matched/total core-ingredient counts ("4/4 core ingredients available"). */
  coreMatched?: number;
  coreTotal?: number;
  onClick: () => void;
  /** When set, the card grows a direct "Cook this →" action that jumps
   * straight into cooking mode, skipping the detail screen. */
  onCook?: () => void;
  reason?: string;
  /** Intent badges overlaid on the visual (max 2 shown). */
  tags?: string[];
  /** "Why RUCHI picked this" lines, rendered inside the card so grid rows
   * stay structurally identical (no h-full stretch dead-space). */
  why?: string[];
  /** Optional ingredient names the user has that this dish doesn't need. */
  notNeeded?: string[];
  size?: "md" | "lg";
  /** Delivered-meal comparison cost — only when the catalog has a defensible
   * basis (recipe.deliveryCompare). Adds "You can make this for ~₹X". */
  deliveryCompareCost?: number;
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
    <Card onClick={onClick} className="group flex h-full flex-col overflow-hidden">
      <div className={
        vertical
          ? "flex flex-1 flex-col"
          : "flex flex-1 flex-col lg:flex-row"
      }>
        {/* Visual — food first, always */}
        <div className={`relative shrink-0 ${vertical ? "" : "lg:w-44"}`}>
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
          {/* Intent badges — top-left, glass over the gradient */}
          {tags.length > 0 && (
            <div className="absolute left-3 top-3 flex max-w-[75%] flex-wrap gap-1.5">
              {tags.slice(0, 2).map((t) => (
                <span
                  key={t}
                  className="glass-dark rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-cream"
                >
                  {TAG_LABELS[t] ?? t}
                </span>
              ))}
            </div>
          )}
          {/* Time — top-right, part of the "how long" glance */}
          <span className="glass-dark absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-cream">
            <Clock size={11} aria-hidden />
            {recipe.timeMin} min
          </span>
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

          {/* Cost as value — shown only when a defensible comparison exists. */}
          {deliveryCompareCost !== undefined && deliveryCompareCost > costPerServing && (
            <p className="mt-1 text-[13px] font-medium text-gold">{canMakeFor(costPerServing)}</p>
          )}

          {/* Decision stats — the three numbers that close the deal */}
          <div className="mt-3.5 grid grid-cols-3 divide-x divide-line rounded-2xl bg-cream/70 py-2.5">
            <Stat value={`${protein}g`} label="Protein" tone="text-sage" />
            {calories !== undefined ? (
              <Stat value={`${calories}`} label="Kcal" />
            ) : (
              <Stat value={recipe.difficulty === "easy" ? "Easy" : "Medium"} label="Level" />
            )}
            <Stat value={`₹${costPerServing}`} label="Est." />
          </div>

          {canCookNow && coreMatched !== undefined && coreTotal !== undefined && (
            <p className="mt-2.5 inline-flex items-center gap-1.5 self-start text-[12px] font-semibold text-sage">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sage" />
              {coreMatched}/{coreTotal} core ingredients available
            </p>
          )}
          {!canCookNow && missingCount > 0 && (
            <p className="mt-2.5 text-[12px] font-medium text-muted">{missingCount} missing</p>
          )}

          {/* Bottom block pinned down (mt-auto) so "Cook this" sits at a
              uniform height across a grid row even when content differs. */}
          <div className="mt-auto">
            {/* Why RUCHI picked this — labeled, capped at 3 upstream */}
            {why.length > 0 && (
              <div className="mt-3.5 border-t border-line pt-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  Why RUCHI picked this
                </p>
                <ul className="mt-1.5 space-y-1">
                  {why.map((w) => (
                    <li key={w} className="flex gap-2 text-[12.5px] leading-relaxed text-muted">
                      <span className="shrink-0 text-sage" aria-hidden>✓</span>
                      <span className="sr-only">Why: </span>
                      {w}
                    </li>
                  ))}
                  {notNeeded.length > 0 && notNeeded[0] && (
                    <li className="text-[12.5px] text-muted">
                      — but you don&apos;t need {notNeeded[0].toLowerCase()}.
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Direct-to-cook action. Lives inside the Card's clickable div,
                so both the click and the keyboard activation are stopped from
                bubbling — the outer card must not also fire. */}
            {onCook && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCook();
                }}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={`Cook ${recipe.name} now`}
                className="mt-3.5 w-full rounded-2xl bg-flame px-4 py-3 text-[14px] font-bold text-white shadow-cta transition-all duration-200 hover:bg-flame-deep active:scale-[0.99]"
              >
                Cook this <span aria-hidden>→</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** One decision stat: value on top, whisper label below. */
function Stat({ value, label, tone = "text-ink" }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center px-1">
      <span className={`text-[15px] font-bold leading-none tracking-tight ${tone}`}>{value}</span>
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
        {label}
      </span>
    </div>
  );
}
