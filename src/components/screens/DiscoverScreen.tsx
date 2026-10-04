"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { EmptyState, SectionTitle } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { RecipeCard } from "@/components/RecipeCard";
import { useScreen } from "@/lib/store/screens";
import { useRuchi } from "@/lib/store";
import { getPendingCategory } from "@/lib/notifications/deep-link";
import { discoverCategories, type DiscoverGroupId, type ResolvedCategory } from "@/lib/data/taxonomy";
import { isAssumedPantry } from "@/lib/data/ingredients";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import { filterRecipes, searchRecipes, type RecipeFilters } from "@/lib/engine/search";
import type { Recipe } from "@/lib/types";

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

/**
 * Per-serving card facts (1-serving Discover grid) — computed once per
 * recipe per session instead of on every render of every card (collection
 * switches, filter changes and search keystrokes used to redo this work
 * for up to 163 recipes at a time).
 */
const cardFactsMemo = new Map<string, { protein: number; calories: number; cost: number }>();
function cardFacts(r: Recipe) {
  let f = cardFactsMemo.get(r.id);
  if (!f) {
    const n = computeNutrition(r, 1);
    f = { protein: n.protein, calories: n.calories, cost: computeCostPerServing(r, 1) };
    cardFactsMemo.set(r.id, f);
  }
  return f;
}

/** Group presentation order + the question each row answers. */
const GROUP_META: { id: DiscoverGroupId; eyebrow: string }[] = [
  { id: "mood", eyebrow: "What's your mood?" },
  { id: "meal", eyebrow: "By meal" },
  { id: "ingredient", eyebrow: "By ingredient" },
  { id: "style", eyebrow: "By style" },
];

export default function DiscoverScreen() {
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [maxTime, setMaxTime] = useState(0);
  const [diet, setDiet] = useState<RecipeFilters["diet"]>("all");
  const [dietType, setDietType] = useState<RecipeFilters["dietType"]>("all");
  // Deep-link: land on the category the notification promised (read-once).
  const pendingCategory = getPendingCategory();
  const [active, setActive] = useState<string>(pendingCategory ?? "quick-easy");
  const go = useScreen((s) => s.go);
  const inventory = useRuchi((s) => s.inventory);
  const inventoryIds = useMemo(() => inventory.map((i) => i.ingredientId), [inventory]);

  // Resolve every category against the real catalog ONCE per mount —
  // membership, counts and ordering are all deterministic (taxonomy.ts).
  const categories = useMemo(() => discoverCategories(), []);
  const activeCategory: ResolvedCategory =
    categories.find((c) => c.id === active) ?? categories[0]!;

  // Defer search work so typing stays instant on mid-range phones.
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;

  const items = useMemo(() => {
    // Structured filters apply on top of either source. The Diet chips use
    // the rich 3-way enum; the "Non-veg" chip maps to the binary dietType
    // (egg included) INSTEAD of the rich value — the rich "nonveg" value
    // would exclude egg dishes and contradict the chip's own label.
    const rich = diet === "veg" || diet === "egg" ? diet : undefined;
    const binary =
      diet === "nonveg" ? "non_veg" : dietType && dietType !== "all" ? dietType : undefined;
    const structured = filterRecipes({ diet: rich, dietType: binary, maxTime });
    if (searching) {
      // Search keeps its own ranked order, narrowed to matching recipes.
      const ranked = searchRecipes(deferredQuery);
      const pool = new Set(structured);
      return ranked.filter((r) => pool.has(r));
    }
    // Browsing keeps the category's curated order (protein-first on Egg,
    // cheapest-first on Budget, …) — the structured chips only narrow it.
    const allowed = new Set(structured);
    return activeCategory.recipes.filter((r) => allowed.has(r));
  }, [searching, deferredQuery, activeCategory, diet, dietType, maxTime]);

  const filtersActive = maxTime !== 0 || (diet && diet !== "all") || (dietType && dietType !== "all");

  return (
    <div className="pt-8 lg:pt-14">
      {/* Editorial header */}
      <header className="mb-7 lg:mb-10">
        <h1 className="font-display text-display-xl font-semibold">Discover</h1>
        <p className="mt-2 max-w-lg text-[15.5px] leading-relaxed text-muted">
          Curated shelves, not a bottomless feed. That&apos;s the point.
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

      {/* Category architecture — grouped, progressive, all backed by real
          metadata (taxonomy.ts). Hidden while searching. */}
      {!searching && (
        <div className="mb-8 space-y-5">
          {GROUP_META.map(({ id, eyebrow }) => {
            const groupCategories = categories.filter((c) => c.group === id);
            if (groupCategories.length === 0) return null;
            const isMood = id === "mood";
            return (
              <nav key={id} aria-label={eyebrow}>
                <p
                  className={`mb-2 font-semibold text-muted ${
                    isMood
                      ? "text-[13px] font-bold uppercase tracking-[0.14em]"
                      : "text-[12px] font-bold uppercase tracking-[0.14em]"
                  }`}
                >
                  {eyebrow}
                </p>
                <div className="flex flex-wrap gap-2">
                  {groupCategories.map((c) => (
                    <CategoryChip
                      key={c.id}
                      label={c.label}
                      count={c.recipes.length}
                      active={active === c.id}
                      prominent={isMood}
                      onClick={() => setActive(c.id)}
                    />
                  ))}
                </div>
              </nav>
            );
          })}
          <p className="border-t border-line pt-4 text-[14px] text-muted">{activeCategory.blurb}</p>
        </div>
      )}

      <SectionTitle
        right={<span className="text-[12px] font-medium text-muted">{items.length} dishes</span>}
      >
        {searching ? `Results for “${deferredQuery.trim()}”` : activeCategory.label}
      </SectionTitle>

      {/* Grid — editorial slow reveals, one-shot as cards scroll in */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((r, i) => {
          const { protein, calories, cost } = cardFacts(r);
          const missingCount = r.ingredients.filter(
            (ri) =>
              !ri.optional &&
              !isAssumedPantry(ri.ingredientId) &&
              !inventoryIds.includes(ri.ingredientId),
          ).length;
          return (
            <Reveal key={r.id} delay={Math.min(i * 0.03, 0.2)}>
              <RecipeCard
                recipe={r}
                protein={protein}
                calories={calories}
                costPerServing={cost}
                missingCount={missingCount}
                canCookNow={missingCount === 0}
                onClick={() => go("meal", { recipeId: r.id })}
              />
            </Reveal>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="mt-2">
          <EmptyState
            icon={<Search size={20} />}
            title={searching ? `Nothing matches “${deferredQuery.trim()}”.` : "This shelf is empty right now."}
            body={
              searching
                ? "Try an ingredient — “egg”, “paneer” — or a word like “quick”."
                : "Try another category."
            }
          />
        </div>
      )}
    </div>
  );
}

// ── Category chip — the shelf selector ──────────────────────
function CategoryChip({
  label,
  count,
  active,
  prominent,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  prominent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`relative shrink-0 rounded-full transition-colors duration-150 ${
        prominent ? "px-4 py-2.5 text-[14px]" : "px-3.5 py-2 text-[13px]"
      } font-semibold ${active ? "text-cream" : "border border-line bg-surface text-ink hover:border-line-strong hover:shadow-soft"}`}
    >
      {active && (
        <motion.span
          layoutId="discover-pill"
          className="absolute inset-0 rounded-full bg-ink shadow-soft"
          transition={{ type: "spring", damping: 30, stiffness: 350 }}
        />
      )}
      <span className="relative">
        {label}
        <span className={`ml-1.5 ${active ? "text-cream/60" : "text-muted"}`}>{count}</span>
      </span>
    </button>
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
