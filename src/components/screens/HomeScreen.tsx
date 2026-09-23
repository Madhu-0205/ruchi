"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Search, Sparkles, X } from "lucide-react";
import { Card, Chip, EmptyState, SectionHeading, SectionTitle, ShimmerSweep } from "@/components/ui";
import { RuchiLogo } from "@/components/RuchiLogo";
import { FoodVisual } from "@/components/FoodVisual";
import { RecipeCard } from "@/components/RecipeCard";
import { StaggerGroup, StaggerItem } from "@/components/motion";
import { useRuchi, weeklyProgress } from "@/lib/store";
import { useScreen } from "@/lib/store/screens";
import { INGREDIENTS, searchIngredients } from "@/lib/data/ingredients";
import { RECIPES } from "@/lib/data/recipes";
import { recommend, matchRecipes } from "@/lib/engine/match";
import { getRecommendationService, aiConfigured } from "@/lib/ai";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import type { Intent, People } from "@/lib/types";

const INTENTS: { id: Intent; label: string }[] = [
  { id: "high-protein", label: "High protein" },
  { id: "healthy", label: "Healthy" },
  { id: "quick", label: "Quick" },
  { id: "budget", label: "Budget" },
  { id: "comfort", label: "Comfort" },
  { id: "spicy", label: "Spicy" },
];

const TIMES = [10, 15, 30, 45] as const;
const BUDGETS = [50, 100, 150, 200] as const;
const PEOPLE: People[] = [1, 2, 3, 4];

const SUGGESTED = [
  "egg", "paneer", "tomato", "onion", "rice", "bread", "potato", "curd", "capsicum", "toor-dal",
];

// Horizontal rail on mobile → 4-col editorial grid on desktop.
// Module-level so the component identity is stable across renders
// (react-hooks/static-components: components created during render reset).
function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="rail no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
      {children}
    </div>
  );
}

function RailItem({ children }: { children: React.ReactNode }) {
  return <div className="w-[240px] shrink-0 sm:w-[260px] lg:w-auto">{children}</div>;
}

export default function HomeScreen() {
  const inventory = useRuchi((s) => s.inventory);
  const addItem = useRuchi((s) => s.addItem);
  const removeItem = useRuchi((s) => s.removeItem);
  const prefs = useRuchi((s) => s.prefs);
  const history = useRuchi((s) => s.history);
  const go = useScreen((s) => s.go);

  // Derived (stable) — never map inside the selector, it breaks snapshots.
  const inventoryIds = useMemo(() => inventory.map((i) => i.ingredientId), [inventory]);

  const [query, setQuery] = useState("");
  const [intents, setIntents] = useState<Intent[]>(["high-protein"]);
  const [timeMax, setTimeMax] = useState<number>(30);
  const [budget, setBudget] = useState<number>(prefs.budget);
  const [people, setPeople] = useState<People>(prefs.defaultServings);
  const [showSearch, setShowSearch] = useState(false);

  const results = useMemo(() => searchIngredients(query), [query]);

  const filters = useMemo(
    () => ({
      hasIds: inventoryIds,
      intents,
      timeMax,
      budgetMax: budget,
      servings: people,
      diet: prefs.diet,
    }),
    [inventoryIds, intents, timeMax, budget, people, prefs.diet],
  );

  // Deterministic engine first — instant recommendations, never a blank UI.
  const recs = useMemo(() => recommend(filters), [filters]);

  // AI-refined list (falls back to the deterministic one until/unless AI lands).
  const [aiRecs, setAiRecs] = useState<ReturnType<typeof recommend> | null>(null);

  // Stale-AI-order reset: when filters change, the previous AI ordering no
  // longer applies — drop it during render (React's adjust-state-when-props-
  // change pattern) instead of a setState-in-effect.
  const [prevFilters, setPrevFilters] = useState(filters);
  if (prevFilters !== filters) {
    setPrevFilters(filters);
    setAiRecs(null);
  }

  // AI re-rank: refines order + copy over the SAME candidate set (null → deterministic).
  // Anything the AI returns is validated recipeIds; the engine re-renders
  // instantly if it fails. Never blocks or blocks-out the list.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!aiConfigured()) return; // deterministic list is final
        const picks = await getRecommendationService().rankRecommendations({
          availableIngredientIds: filters.hasIds,
          intents: filters.intents,
          timeMaxMin: filters.timeMax,
          budgetMaxInr: filters.budgetMax,
          servings: filters.servings,
          diet: filters.diet,
          skill: prefs.skill,
          candidates: matchRecipes(filters)
            .slice(0, 12)
            .map((m) => ({ recipeId: m.recipe.id, score: m.score })),
        });
        if (!cancelled && picks && picks.length > 0) {
          setAiRecs(recommend(filters, picks));
        }
      } catch {
        // deterministic recs stay on screen — no-op
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [filters, recs, prefs.skill]);
  const shown = aiRecs ?? recs;
  const week = useMemo(() => weeklyProgress({ history }), [history]);

  const has = (id: string) => inventoryIds.includes(id);
  const toggle = (id: string) => (has(id) ? removeItem(id) : addItem(id));

  const hasInventory = inventoryIds.length > 0;
  const isEmptyKitchen = inventoryIds.length === 0;

  // ── Editorial sections from the real catalog (deterministic, no AI) ──
  // Rail sections exclude drinks: the food rails read best as plated meals,
  // and drinks surface in Discover's own collections.
  const editorial = useMemo(() => {
    const food = RECIPES.filter((r) => r.category !== "drink");
    const perServingCost = (r: (typeof RECIPES)[number]) => computeCostPerServing(r, 1);
    const protein = (r: (typeof RECIPES)[number]) => computeNutrition(r, 1).protein;
    const byTime = [...food].sort((a, b) => a.timeMin - b.timeMin);
    return {
      good: [...food].sort((a, b) => protein(b) - protein(a)).slice(0, 6),
      quick: byTime.slice(0, 8),
      highProtein: [...food].sort((a, b) => protein(b) - protein(a)).slice(0, 8),
      budget: [...food].sort((a, b) => perServingCost(a) - perServingCost(b)).slice(0, 8),
    };
  }, []);

  return (
    <div className="pt-8 lg:pt-14">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
        <header>
          <div className="flex items-center gap-2.5 lg:hidden">
            <RuchiLogo size={28} priority />
            <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-flame">
              రుచి · RUCHI
            </p>
          </div>
          <h1 className="mt-4 font-display text-display-hero font-semibold lg:mt-0">
            <span className="block">Turn what you have</span>{" "}
            <span className="block">
              into{" "}
              <span className="relative inline-block text-flame">
                something
                {/* hand-drawn warmth: underline stroke */}
                <svg
                  aria-hidden
                  viewBox="0 0 110 10"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1.5 left-0 h-2 w-full text-flame/45"
                >
                  <path
                    d="M2 7 Q 28 2, 55 6 T 108 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>{" "}
              <span className="accent-italic whitespace-nowrap">worth eating.</span>
            </span>
          </h1>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-muted lg:text-[17px]">
            Show RUCHI your ingredients and get meals that actually fit your time, preferences
            and budget.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row lg:mt-9">
            <button
              onClick={() => go("scan")}
              className="relative inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-flame px-8 py-4 text-[16px] font-bold text-white shadow-cta transition-all duration-200 hover:bg-flame-deep active:scale-[0.98]"
            >
              <ShimmerSweep />
              <Camera size={18} strokeWidth={2.2} />
              <span className="relative">Scan ingredients</span>
            </button>
            <button
              onClick={() => go("discover")}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line-strong bg-surface px-8 py-4 text-[16px] font-semibold text-ink shadow-soft transition-all duration-200 hover:border-ink/25 hover:shadow-lifted active:scale-[0.98]"
            >
              Explore recipes
            </button>
          </div>

          {/* Social proof of simplicity — honest, no fabricated numbers */}
          <p className="mt-6 flex items-center gap-2 text-[13px] text-muted">
            <Sparkles size={14} className="text-flame" />
            No account needed. No clutter. Just dinner.
          </p>
        </header>

        {/* Hero visual: ingredients → meal, the product promise in one view */}
        <HeroVisual onScan={() => go("scan")} className="mt-12 lg:mt-0" />
      </section>

      {/* ── Weekly progress (only once they've cooked) ───── */}
      {week.meals > 0 && (
        <div className="mt-14 border-y border-line py-6">
          <div className="flex items-center justify-around gap-6 text-center sm:justify-start sm:gap-14 sm:text-left">
            <div>
              <p className="font-display text-[30px] font-semibold leading-none">
                {week.meals}
              </p>
              <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                cooked this week
              </p>
            </div>
            <div>
              <p className="font-display text-[30px] font-semibold leading-none text-gold">
                ₹{week.saved}
              </p>
              <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                saved (est.)
              </p>
            </div>
            <div>
              <p className="font-display text-[30px] font-semibold leading-none text-sage">
                {week.protein}g
              </p>
              <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                protein
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── What's in your kitchen? ──────────────────────── */}
      <section className="mt-14">
        <SectionTitle
          right={
            <span className="flex items-center gap-3">
              {hasInventory && (
                <button
                  onClick={() => useRuchi.getState().clearKitchen()}
                  className="-my-2 py-2 text-[13px] font-medium text-muted transition-colors hover:text-ink"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setShowSearch((v) => !v)}
                className="-my-2 py-2 text-[13px] font-semibold text-flame transition-colors hover:text-flame-deep"
              >
                {showSearch ? "Done" : "Search all"}
              </button>
            </span>
          }
        >
          What&apos;s in your kitchen?
        </SectionTitle>

        <AnimatePresence initial={false}>
          {showSearch && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="relative mb-3">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Try “paneer”, “anda”, “biyyam”…"
                  aria-label="Search ingredients"
                  className="w-full rounded-2xl border border-line bg-surface py-3 pl-10 pr-10 text-[15px] outline-none transition-colors placeholder:text-muted/60 focus:border-ink/40"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted"
                    aria-label="Clear search"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {query && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {results.length === 0 && (
                    <p className="text-sm text-muted">No match — try Telugu/Hindi spelling too.</p>
                  )}
                  {results.slice(0, 12).map((i) => (
                    <Chip key={i.id} selected={has(i.id)} onClick={() => toggle(i.id)}>
                      {has(i.id) ? "✓ " : "+ "}
                      {i.name}
                    </Chip>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((id) => {
            const ing = INGREDIENTS.find((i) => i.id === id);
            if (!ing) return null;
            return (
              <Chip key={id} selected={has(id)} onClick={() => toggle(id)}>
                {has(id) ? "✓ " : "+ "}
                {ing.name}
              </Chip>
            );
          })}
        </div>

        {/* Selected tray — only items added via search, not the quick chips */}
        {inventory.filter((item) => !SUGGESTED.includes(item.ingredientId)).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {inventory
              .filter((item) => !SUGGESTED.includes(item.ingredientId))
              .map((item) => {
                const ing = INGREDIENTS.find((i) => i.id === item.ingredientId);
                return (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[13px] font-semibold text-cream"
                  >
                    {ing?.name ?? item.ingredientId}
                    <button
                      onClick={() => removeItem(item.ingredientId)}
                      aria-label={`Remove ${ing?.name ?? item.ingredientId}`}
                    >
                      <X size={13} className="opacity-70 hover:opacity-100" />
                    </button>
                  </span>
                );
              })}
          </div>
        )}

        {/* Preferences — appear once there's something to cook with */}
        {hasInventory && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-8 space-y-6"
          >
            <div>
              <p className="mb-2 text-[15px] font-semibold">What are you feeling?</p>
              <div className="flex flex-wrap gap-2">
                {INTENTS.map((it) => (
                  <Chip
                    key={it.id}
                    selected={intents.includes(it.id)}
                    onClick={() =>
                      setIntents((cur) =>
                        cur.includes(it.id) ? cur.filter((x) => x !== it.id) : [...cur, it.id],
                      )
                    }
                  >
                    {it.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[15px] font-semibold">How much time do you have?</p>
              <div className="flex flex-wrap gap-2">
                {TIMES.map((t) => (
                  <Chip key={t} selected={timeMax === t} onClick={() => setTimeMax(t)}>
                    {t === 45 ? "No rush" : `${t} min`}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[15px] font-semibold">Budget</p>
                <div className="flex flex-wrap gap-2">
                  {BUDGETS.map((b) => (
                    <Chip key={b} selected={budget === b} onClick={() => setBudget(b)}>
                      ₹{b === 200 ? "200+" : b}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[15px] font-semibold">People</p>
                <div className="flex flex-wrap gap-2">
                  {PEOPLE.map((p) => (
                    <Chip key={p} selected={people === p} onClick={() => setPeople(p)}>
                      {p === 4 ? "4+" : p}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </section>

      {/* ── Recommendations ──────────────────────────────── */}
      {hasInventory && (
        <section className="mt-14" aria-live="polite">
          <SectionHeading
            eyebrow="From your kitchen"
            title="Cook this tonight"
            right={
              <span className="text-[12px] font-medium text-muted">
                {shown.length} pick{shown.length === 1 ? "" : "s"} for you
              </span>
            }
          />

          {shown.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={20} />}
              title="Nothing fits those filters — yet."
              body="Try more time, a bigger budget, or another ingredient or two."
            />
          ) : (
            <StaggerGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
              {shown.map((rec) => {
                const r = rec.recipe;
                const n = computeNutrition(r, people);
                const cost = computeCostPerServing(r, people);
                const missingNames = rec.missing
                  .map((m) => INGREDIENTS.find((i) => i.id === m)?.name ?? m)
                  .filter(Boolean);
                // Validated swap for a missing item — only what the recipe's own
                // substitution table declares, never invented.
                const swapFor = (id: string) => {
                  const rule = rec.recipe.substitutions.find(
                    (s) => s.missingId === id && s.useId,
                  );
                  return rule?.useId
                    ? INGREDIENTS.find((i) => i.id === rule.useId)?.name ?? null
                    : null;
                };
                return (
                  <StaggerItem key={r.id}>
                    <RecipeCard
                      recipe={r}
                      protein={n.protein}
                      costPerServing={cost}
                      missingCount={rec.missing.length}
                      canCookNow={rec.missing.length === 0}
                      coreMatched={rec.coreMatched}
                      coreTotal={rec.coreTotal}
                      reason={rec.reason}
                      onClick={() => go("meal", { recipeId: r.id })}
                    />
                    {/* Missing core items — tap to add to the kitchen. One tap
                        turns a one-away pick into a cook-now pick. */}
                    {rec.missing.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1.5">
                        <span className="text-[12px] text-muted">Missing:</span>
                        {rec.missing.map((id) => {
                          const name =
                            INGREDIENTS.find((i) => i.id === id)?.name ?? id;
                          const swapName = swapFor(id);
                          return (
                            <Chip key={id} onClick={() => addItem(id)}>
                              + {name}
                              {swapName && (
                                <span className="font-normal text-muted">
                                 {" "}· or {swapName.toLowerCase()}
                                </span>
                              )}
                            </Chip>
                          );
                        })}
                      </div>
                    )}
                    {/* Why this one — makes the pick feel intelligent */}
                    <div className="mt-2 px-1.5">
                      <ul className="space-y-0.5">
                        {rec.why.slice(0, 3).map((w) => (
                          <li key={w} className="flex gap-2 text-[12.5px] leading-relaxed text-muted">
                            <span className="shrink-0 text-sage" aria-hidden>✓</span>
                            <span className="sr-only">Why: </span>
                            {w}
                          </li>
                        ))}
                      </ul>
                      {missingNames.length > 0 && rec.notNeeded.length > 0 && rec.notNeeded[0] && (
                        <p className="mt-1 text-[12.5px] text-muted">
                          — but you don&apos;t need {rec.notNeeded[0].toLowerCase()}.
                        </p>
                      )}
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerGroup>
          )}
        </section>
      )}

      {/* ── Empty-kitchen welcome ────────────────────────── */}
      {isEmptyKitchen && (
        <section className="mt-16">
          <Card className="warm-glow overflow-hidden p-7 sm:p-9">
            <p className="font-display text-display-md font-semibold leading-snug">
              The deal, simply.
            </p>
            <ul className="mt-4 space-y-2.5 text-[15px] leading-relaxed text-ink-soft">
              <li className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-flame" aria-hidden />
                Tap what&apos;s in your kitchen. No quantities needed.
              </li>
              <li className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-flame" aria-hidden />
                RUCHI picks 3–4 dishes you can actually make.
              </li>
              <li className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-flame" aria-hidden />
                Exact quantities, beginner steps, protein and cost — no guessing.
              </li>
            </ul>
            <div className="mt-6 flex items-center gap-2 text-[13px] font-semibold text-flame-deep">
              <Sparkles size={15} /> No account. No clutter. Just dinner.
            </div>
          </Card>
        </section>
      )}

      {/* ── Cook something good — editorial rows ─────────── */}
      <section className="mt-16">
        <SectionHeading
          eyebrow="The kitchen, decided"
          title="Cook something good"
          right={
            <button
              onClick={() => go("discover")}
              className="text-[13px] font-semibold text-flame transition-colors hover:text-flame-deep"
            >
              All recipes →
            </button>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {editorial.good.slice(0, 6).map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              protein={computeNutrition(r, 1).protein}
              costPerServing={computeCostPerServing(r, 1)}
              missingCount={0}
              canCookNow={false}
              size="lg"
              onClick={() => go("meal", { recipeId: r.id })}
            />
          ))}
        </div>
      </section>

      {/* ── Quick meals ──────────────────────────────────── */}
      <section className="mt-16">
        <SectionHeading
          eyebrow="Faster than delivery"
          title="Quick meals"
          right={
            <button
              onClick={() => go("discover")}
              className="text-[13px] font-semibold text-flame transition-colors hover:text-flame-deep"
            >
              Browse →
            </button>
          }
        />
        <Rail>
          {editorial.quick.map((r) => (
            <RailItem key={r.id}>
              <RecipeCard
                recipe={r}
                layout="vertical"
                protein={computeNutrition(r, 1).protein}
                costPerServing={computeCostPerServing(r, 1)}
                missingCount={0}
                canCookNow={false}
                onClick={() => go("meal", { recipeId: r.id })}
              />
            </RailItem>
          ))}
        </Rail>
      </section>

      {/* ── High-protein meals ───────────────────────────── */}
      <section className="mt-14">
        <SectionHeading eyebrow="20g+ per serving" title="High-protein meals" />
        <Rail>
          {editorial.highProtein.map((r) => (
            <RailItem key={r.id}>
              <RecipeCard
                recipe={r}
                layout="vertical"
                protein={computeNutrition(r, 1).protein}
                costPerServing={computeCostPerServing(r, 1)}
                missingCount={0}
                canCookNow={false}
                onClick={() => go("meal", { recipeId: r.id })}
              />
            </RailItem>
          ))}
        </Rail>
      </section>

      {/* ── Budget-friendly meals ────────────────────────── */}
      <section className="mt-14">
        <SectionHeading eyebrow="Full plates, small bill" title="Budget-friendly meals" />
        <Rail>
          {editorial.budget.map((r) => (
            <RailItem key={r.id}>
              <RecipeCard
                recipe={r}
                layout="vertical"
                protein={computeNutrition(r, 1).protein}
                costPerServing={computeCostPerServing(r, 1)}
                missingCount={0}
                canCookNow={false}
                onClick={() => go("meal", { recipeId: r.id })}
              />
            </RailItem>
          ))}
        </Rail>
      </section>

      {/* ── Final CTA ────────────────────────────────────── */}
      <section className="mt-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-ink px-6 py-12 text-center text-cream sm:px-10 sm:py-16">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(560px 260px at 20% -10%, rgb(228 87 46 / 0.25), transparent 60%), radial-gradient(480px 240px at 85% 110%, rgb(67 117 90 / 0.2), transparent 60%)",
            }}
          />
          <p className="relative font-display text-display-lg font-semibold leading-tight">
            Your kitchen already has<br />
            <span className="accent-italic text-flame">tonight&apos;s dinner.</span>
          </p>
          <p className="relative mx-auto mt-3.5 max-w-sm text-[15px] leading-relaxed text-cream/70">
            One photo, three picks, one pan. That&apos;s the whole product.
          </p>
          <button
            onClick={() => go("scan")}
            className="relative mt-7 inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-flame px-8 py-4 text-[16px] font-bold text-white shadow-cta transition-all duration-200 hover:bg-flame-deep active:scale-[0.98]"
          >
            <ShimmerSweep />
            <Camera size={18} strokeWidth={2.2} />
            <span className="relative">Scan ingredients</span>
          </button>
        </div>
      </section>
    </div>
  );
}

// ── Hero visual ─────────────────────────────────────────────
// The product demo as composition: ingredient chips cascade into a
// floating meal card with real engine numbers. Purely presentational.

const DEMO_INGREDIENTS = ["egg", "paneer", "tomato", "onion"] as const;
/** Pinned demo dish — the hero's worked example (id exists in the catalog). */
const DEMO_RECIPE_ID = "paneer-egg-bhurji";

function HeroVisual({ onScan, className = "" }: { onScan: () => void; className?: string }) {
  const demo = INGREDIENTS.filter((i) => (DEMO_INGREDIENTS as readonly string[]).includes(i.id));
  const topRec = useMemo(() => {
    const recs = recommend({
      hasIds: [...DEMO_INGREDIENTS],
      intents: ["high-protein"],
      timeMax: 0,
      budgetMax: 0,
      servings: 1,
      diet: "eggetarian",
    });
    return recs.find((rec) => rec.recipe.id === DEMO_RECIPE_ID) ?? recs[0];
  }, []);

  if (!topRec) return null;
  const r = topRec.recipe;
  const n = computeNutrition(r, 1);
  const cost = computeCostPerServing(r, 1);

  return (
    <div aria-hidden className={`relative ${className}`}>
      <div className="relative rounded-[2rem] border border-line bg-surface p-5 shadow-lifted sm:p-7">
        {/* Ingredient row */}
        <div className="flex flex-wrap items-center gap-2">
          {demo.map((ing, i) => (
            <motion.span
              key={ing.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.08, duration: 0.35 }}
              className="rounded-full border border-line bg-cream px-3.5 py-2 text-[13px] font-semibold text-ink-soft"
            >
              {ing.name}
            </motion.span>
          ))}
        </div>

        {/* Arrow */}
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-flame-soft text-[13px] font-bold text-flame-deep">
            ↓
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>

        {/* Meal card */}
        <motion.button
          onClick={onScan}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4 }}
          className="group block w-full text-left"
        >
          <FoodVisual recipe={r} zoom emojiClassName="text-6xl" className="aspect-[16/9] w-full rounded-2xl" />
          <div className="mt-4 flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-[21px] font-semibold leading-snug transition-colors duration-200 group-hover:text-flame-deep">
                {r.name}
              </p>
              <p className="mt-1.5 text-[13px] font-medium text-muted">
                {r.timeMin} min
                <span aria-hidden className="mx-1.5 text-line-strong">·</span>
                {n.protein}g protein
                <span aria-hidden className="mx-1.5 text-line-strong">·</span>
                High protein
              </p>
            </div>
            <span className="font-display text-[24px] font-semibold text-ink">₹{cost}</span>
          </div>
        </motion.button>
      </div>

      {/* Floating accent chip — the AI whisper */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1, y: [0, -6, 0] }}
        transition={{
          opacity: { delay: 0.8, duration: 0.3 },
          scale: { delay: 0.8, duration: 0.3 },
          y: { duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 1.2 },
        }}
        className="absolute -top-4 right-4 rounded-full border border-line bg-surface px-3.5 py-2 text-[12px] font-semibold text-ink shadow-lifted sm:-right-3"
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-sage align-middle" aria-hidden />
        Cook tonight
      </motion.div>
    </div>
  );
}
