"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Card, Pill, SectionTitle } from "@/components/ui";
import { useScreen } from "@/lib/store/screens";
import { useRuchi } from "@/lib/store";
import { RECIPES } from "@/lib/data/recipes";
import { isAssumedPantry } from "@/lib/data/ingredients";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import { filterRecipes, searchRecipes, type RecipeFilters } from "@/lib/engine/search";
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
  | "healthy";

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
  { label: "Non-veg", value: "nonveg" as const },
];

export default function DiscoverScreen() {
  const [active, setActive] = useState<CollectionId>("high-protein");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [maxTime, setMaxTime] = useState(0);
  const [diet, setDiet] = useState<RecipeFilters["diet"]>("all");
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
      }
    });
  }, [active]);

  const items = useMemo(() => {
    const base = searching
      ? searchRecipes(deferredQuery)
      : collectionItems;
    // Structured filters apply on top of either source.
    return filterRecipes({
      diet: diet ?? "all",
      maxTime,
    } as RecipeFilters).filter((r) => base.includes(r));
  }, [searching, deferredQuery, collectionItems, diet, maxTime]);

  const col = COLLECTIONS.find((c) => c.id === active)!;
  const filtersActive = maxTime !== 0 || (diet && diet !== "all");

  return (
    <div className="pt-6">
      <header className="mb-4">
        <h1 className="font-display text-[30px] font-bold tracking-tight">Discover</h1>
        <p className="mt-1 text-[15px] text-muted">
          Curated lists, not a bottomless feed. That&apos;s the point.
        </p>
      </header>

      {/* Search */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes, ingredients…"
            aria-label="Search recipes"
            className="w-full rounded-2xl border border-line bg-white py-2.5 pl-10 pr-9 text-[15px] text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-ink/40"
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
          className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-2xl border transition-colors ${
            filtersActive || showFilters
              ? "border-ink bg-ink text-cream"
              : "border-line bg-white text-ink"
          }`}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="mb-4 space-y-3 rounded-2xl border border-line bg-white p-4">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
              Time
            </p>
            <div className="flex flex-wrap gap-2">
              {TIME_FILTERS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setMaxTime(t.value)}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                    maxTime === t.value
                      ? "bg-ink text-cream"
                      : "border border-line bg-white text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
              Diet
            </p>
            <div className="flex flex-wrap gap-2">
              {DIET_FILTERS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDiet(d.value)}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                    diet === d.value
                      ? "bg-ink text-cream"
                      : "border border-line bg-white text-ink"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          {filtersActive && (
            <button
              onClick={() => {
                setMaxTime(0);
                setDiet("all");
              }}
              className="text-[13px] font-semibold text-flame underline underline-offset-2"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

      {/* Collections (hidden while searching) */}
      {!searching && (
        <>
          <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
            {COLLECTIONS.map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                  active === c.id
                    ? "bg-ink text-cream"
                    : "border border-line bg-white text-ink hover:border-ink/30"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mb-4 text-[14px] text-muted">{col.blurb}</p>
        </>
      )}

      <SectionTitle
        right={<span className="text-[12px] text-muted">{items.length} dishes</span>}
      >
        {searching ? `Results for “${deferredQuery.trim()}”` : col.label}
      </SectionTitle>

      <div className="space-y-3">
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
            <Card key={r.id} className="p-4" onClick={() => go("meal", { recipeId: r.id })}>
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-flame-soft text-2xl">
                  {r.heroEmoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-[16px] font-bold">{r.name}</h3>
                    <Pill tone="time">{r.timeMin} min</Pill>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{r.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Pill tone="protein">{n.protein}g protein</Pill>
                    <Pill tone="savings">₹{cost}</Pill>
                    {missingCount === 0 ? (
                      <Pill className="bg-sage-soft text-sage">Can cook now</Pill>
                    ) : (
                      <span className="text-[12px] text-muted">{missingCount} missing</span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
        {items.length === 0 && (
          <Card className="p-5">
            {searching ? (
              <>
                <p className="text-[15px] font-semibold">Nothing matches “{deferredQuery.trim()}”.</p>
                <p className="mt-1 text-sm text-muted">
                  Try an ingredient — “egg”, “paneer” — or a word like “quick”.
                </p>
              </>
            ) : (
              <>
                <p className="text-[15px] font-semibold">This list is empty right now.</p>
                <p className="mt-1 text-sm text-muted">Try another collection.</p>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
