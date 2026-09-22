"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { EmptyState, SectionTitle } from "@/components/ui";
import { RecipeCard } from "@/components/RecipeCard";
import { useScreen } from "@/lib/store/screens";
import { useRuchi } from "@/lib/store";
import { RECIPES } from "@/lib/data/recipes";
import { isAssumedPantry } from "@/lib/data/ingredients";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import { filterRecipes, searchRecipes, type RecipeFilters } from "@/lib/engine/search";
import { dietTypeOf } from "@/lib/data/diet";
import type { RecipeCategory } from "@/lib/types";

type CollectionId =
  | "high-protein"
  | "under-100"
  | "15-min"
  | "breakfast"
  | "lunch"
  | "dinner"
  | "beginner"
  | "comfort"
  | "healthy"
  | "popular-veg"
  | "south-indian-veg"
  | "veg-budget"
  | "popular-nonveg"
  | "quick-chicken"
  | "egg-favorites"
  | "high-protein-nonveg"
  | "nonveg-budget";

const COLLECTIONS: { id: CollectionId; label: string; blurb: string }[] = [
  { id: "high-protein", label: "High Protein", blurb: "20g+ per serving. Gains included." },
  { id: "under-100", label: "Under ₹100", blurb: "Full meals that respect your wallet." },
  { id: "15-min", label: "15-Minute Meals", blurb: "Faster than any delivery promise." },
  { id: "breakfast", label: "Breakfast", blurb: "Start the day fed, not frantic." },
  { id: "lunch", label: "Lunch", blurb: "The midday decision, already made." },
  { id: "dinner", label: "Dinner", blurb: "Tonight's cooking, decided early." },
  { id: "beginner", label: "Beginner Friendly", blurb: "Zero-cooking-experience safe." },
  { id: "comfort", label: "Comfort Food", blurb: "The classics, done properly." },
  { id: "healthy", label: "Healthy", blurb: "Balanced, not sad." },
  { id: "popular-veg", label: "Popular Veg", blurb: "The vegetarian hits, from dosa to dal makhani." },
  { id: "south-indian-veg", label: "South Indian Veg", blurb: "Idli's extended family. Fermented, steamed, wonderful." },
  { id: "veg-budget", label: "Veg Under ₹35", blurb: "Vegetarian plates, tiny bill. Estimated cost." },
  { id: "popular-nonveg", label: "Popular Non-Veg", blurb: "Biryani, butter chicken, and the rest of the hall of fame." },
  { id: "quick-chicken", label: "Quick Chicken", blurb: "Chicken on the table in 30 minutes or less." },
  { id: "egg-favorites", label: "Egg Favorites", blurb: "For the egg-first household." },
  { id: "high-protein-nonveg", label: "High Protein Non-Veg", blurb: "20g+ protein, meat and egg editions." },
  { id: "nonveg-budget", label: "Non-Veg Under ₹150", blurb: "Non-veg meals that don't feel like a splurge. Estimated cost." },
];

const TIME_FILTERS = [
  { label: "Any", value: 0 },
  { label: "≤ 15 min", value: 15 },
  { label: "≤ 30 min", value: 30 },
  { label: "≤ 45 min", value: 45 },
];

const DIET_FILTERS = [
  { label: "All", value: "all" as const },
  { label: "Veg", value: "veg" as const },
  { label: "Egg", value: "egg" as const },
  // The binary Non-veg chip filters on dietTypeOf(r) === "non_veg" — egg
  // dishes included per the documented product policy — while keeping the
  // rich `diet` state untouched so the two filter systems stay independent.
  { label: "Non-veg", value: "nonveg" as const },
];

export default function DiscoverScreen() {
  const [active, setActive] = useState<CollectionId>("high-protein");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [maxTime, setMaxTime] = useState(0);
  const [diet, setDiet] = useState<RecipeFilters["diet"]>("all");
  const [dietType, setDietType] = useState<RecipeFilters["dietType"]>("all");
  const go = useScreen((s) => s.go);
  const inventory = useRuchi((s) => s.inventory);
  const inventoryIds = useMemo(() => inventory.map((i) => i.ingredientId), [inventory]);

  // Defer search work so typing stays instant on mid-range phones.
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;

  const collectionItems = useMemo(() => {
    const cat: Partial<Record<CollectionId, RecipeCategory>> = {
      breakfast: "breakfast",
      lunch: "lunch",
      dinner: "dinner",
    };
    return RECIPES.filter((r) => {
      switch (active) {
        case "high-protein":
          return computeNutrition(r, 1).protein >= 20;
        case "under-100":
          return computeCostPerServing(r, 1) <= 100;
        case "15-min":
          return r.timeMin <= 15;
        case "breakfast":
        case "lunch":
        case "dinner":
          return r.category === cat[active];
        case "beginner":
          return r.difficulty === "easy";
        case "comfort":
          return r.tags.includes("comfort");
        case "healthy":
          return r.tags.includes("healthy");
        case "popular-veg":
          return r.diet === "veg";
        case "south-indian-veg":
          return (
            r.diet === "veg" &&
            ["South Indian", "Kerala", "Karnataka", "Tamil Nadu"].some((c) =>
              r.cuisine.includes(c),
            )
          );
        case "veg-budget":
          return r.diet === "veg" && computeCostPerServing(r, 1) <= 35;
        case "popular-nonveg":
          return dietTypeOf(r) === "non_veg";
        case "quick-chicken":
          return (
            r.diet === "nonveg" &&
            r.ingredients.some((i) => i.ingredientId === "chicken-breast") &&
            r.timeMin <= 30
          );
        case "egg-favorites":
          return r.diet === "egg";
        case "high-protein-nonveg":
          return dietTypeOf(r) === "non_veg" && computeNutrition(r, 1).protein >= 20;
        case "nonveg-budget":
          return r.diet !== "veg" && computeCostPerServing(r, 1) <= 150;
      }
    });
  }, [active]);

  const items = useMemo(() => {
    const base = searching
      ? searchRecipes(deferredQuery)
      : collectionItems;
    // Structured filters apply on top of either source. The Diet chips use
    // the rich 3-way enum; the "Non-veg" chip maps to the binary dietType
    // (egg included) INSTEAD of the rich value — the rich "nonveg" value
    // would exclude egg dishes and contradict the chip's own label.
    const rich = diet === "veg" || diet === "egg" ? diet : undefined;
    const binary =
      diet === "nonveg" ? "non_veg" : dietType && dietType !== "all" ? dietType : undefined;
    return filterRecipes({
      diet: rich,
      dietType: binary,
      maxTime,
    } as RecipeFilters).filter((r) => base.includes(r));
  }, [searching, deferredQuery, collectionItems, diet, dietType, maxTime]);

  const col = COLLECTIONS.find((c) => c.id === active)!;
  const filtersActive = maxTime !== 0 || (diet && diet !== "all") || (dietType && dietType !== "all");

  return (
    <div className="pt-8 lg:pt-14">
      {/* Editorial header */}
      <header className="mb-7 lg:mb-10">
        <h1 className="font-display text-display-xl font-semibold">Discover</h1>
        <p className="mt-2 max-w-lg text-[15.5px] leading-relaxed text-muted">
          Curated lists, not a bottomless feed. That&apos;s the point.
        </p>
      </header>

      {/* Search + filter toggle */}
      <div className="mb-5 flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes, ingredients…"
            aria-label="Search recipes"
            className="w-full rounded-2xl border border-line bg-surface py-3.5 pl-11 pr-9 text-[15px] text-ink shadow-soft outline-none transition-colors placeholder:text-muted/70 focus:border-ink/40"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-label="Toggle filters"
          className={`flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-2xl border transition-colors ${
            filtersActive || showFilters
              ? "border-ink bg-ink text-cream"
              : "border-line bg-surface text-ink shadow-soft"
          }`}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="mb-5 space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-soft">
          <FilterRow label="Time">
            {TIME_FILTERS.map((t) => (
              <FilterChip key={t.value} selected={maxTime === t.value} onClick={() => setMaxTime(t.value)}>
                {t.label}
              </FilterChip>
            ))}
          </FilterRow>
          <FilterRow label="Diet">
            {DIET_FILTERS.map((d) => (
              <FilterChip key={d.value} selected={diet === d.value} onClick={() => setDiet(d.value)}>
                {d.label}
              </FilterChip>
            ))}
          </FilterRow>
          <FilterRow label="Veg / Non-veg">
            {[
              { label: "All", value: "all" as const },
              { label: "Veg only", value: "veg" as const },
              { label: "Non-veg (incl. egg)", value: "non_veg" as const },
            ].map((d) => (
              <FilterChip key={d.value} selected={dietType === d.value} onClick={() => setDietType(d.value)}>
                {d.label}
              </FilterChip>
            ))}
          </FilterRow>
          {filtersActive && (
            <button
              onClick={() => {
                setMaxTime(0);
                setDiet("all");
                setDietType("all");
              }}
              className="text-[13px] font-semibold text-flame underline underline-offset-2"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

      {/* Collections rail (hidden while searching) */}
      {!searching && (
        <>
          <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
            {COLLECTIONS.map((c) => {
              const isActive = active === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className={`relative shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-150 ${
                    isActive ? "text-cream" : "border border-line bg-surface text-ink hover:border-line-strong hover:shadow-soft"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="discover-pill"
                      className="absolute inset-0 rounded-full bg-ink shadow-soft"
                      transition={{ type: "spring", damping: 30, stiffness: 350 }}
                    />
                  )}
                  <span className="relative">{c.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mb-7 text-[14px] text-muted">{col.blurb}</p>
        </>
      )}

      <SectionTitle
        right={<span className="text-[12px] font-medium text-muted">{items.length} dishes</span>}
      >
        {searching ? `Results for “${deferredQuery.trim()}”` : col.label}
      </SectionTitle>

      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((r) => {
          const n = computeNutrition(r, 1);
          const cost = computeCostPerServing(r, 1);
          const missingCount = r.ingredients.filter(
            (ri) =>
              !ri.optional &&
              !isAssumedPantry(ri.ingredientId) &&
              !inventoryIds.includes(ri.ingredientId),
          ).length;
          return (
            <RecipeCard
              key={r.id}
              recipe={r}
              protein={n.protein}
              costPerServing={cost}
              missingCount={missingCount}
              canCookNow={missingCount === 0}
              onClick={() => go("meal", { recipeId: r.id })}
            />
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="mt-2">
          <EmptyState
            icon={<Search size={20} />}
            title={searching ? `Nothing matches “${deferredQuery.trim()}”.` : "This list is empty right now."}
            body={
              searching
                ? "Try an ingredient — “egg”, “paneer” — or a word like “quick”."
                : "Try another collection."
            }
          />
        </div>
      )}
    </div>
  );
}

// ── Filter primitives (local, single-screen use) ────────────
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
        selected ? "bg-ink text-cream" : "border border-line bg-surface text-ink hover:border-line-strong"
      }`}
    >
      {children}
    </button>
  );
}
