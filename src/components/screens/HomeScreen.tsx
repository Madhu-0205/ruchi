"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Search, Sparkles, X, Shuffle } from "lucide-react";
import { Card, Chip, EmptyState, SectionHeading, SectionTitle, ShimmerSweep } from "@/components/ui";
import { RuchiLogo } from "@/components/RuchiLogo";
import { FoodVisual } from "@/components/FoodVisual";
import { RecipeCard } from "@/components/RecipeCard";
import { StaggerGroup, StaggerItem } from "@/components/motion";
import { useRuchi } from "@/lib/store";
import { useScreen } from "@/lib/store/screens";
import { INGREDIENTS, searchIngredients } from "@/lib/data/ingredients";
import { RECIPES } from "@/lib/data/recipes";
import { recommend, matchRecipes, nearRecipes, chooseForMe } from "@/lib/engine/match";
import { getRecommendationService, aiConfigured } from "@/lib/ai";
import {
  homeHeadline,
  homeSubLine,
  returnVisitLine,
  keptInPocket,
  FEATURED_CTA_HINT,
  RECENTLY_COOKED_HEADING,
  COOK_AGAIN_LABEL,
  kitchenGoodLine,
  intentWhisper,
  proteinPatternLine,
  LET_RUCHI_CHOOSE_LABEL,
  LET_RUCHI_CHOOSE_SUB,
} from "@/lib/personality";
import { track } from "@/lib/engine/analytics";
import {
  evaluateAttention,
  isSuppressed,
  type AttentionContext,
  type AttentionRecipeFacts,
} from "@/lib/context/attention";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import type { Intent, People, Recipe } from "@/lib/types";

const INTENTS: { id: Intent; label: string }[] = [
  { id: "high-protein", label: "💪 High Protein" },
  { id: "healthy", label: "🥗 Healthy" },
  { id: "quick", label: "⚡ Under 15 min" },
  { id: "budget", label: "💰 Budget" },
  { id: "indian", label: "🍛 Indian" },
  { id: "comfort", label: "😋 Comfort Food" },
];

const TIMES = [10, 15, 30, 45] as const;
const BUDGETS = [50, 100, 150, 200] as const;
const PEOPLE: People[] = [1, 2, 3, 4];

const SUGGESTED = [
  "egg", "paneer", "tomato", "onion", "rice", "bread", "potato", "curd", "capsicum", "toor-dal",
];

/** Captured once per module load — stable across renders (no clock churn). */
const NOW_MS = Date.now();

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
  const recentCooked = useRuchi((s) => s.recentCooked);
  const cloudStats = useRuchi((s) => s.cloudStats);
  const go = useScreen((s) => s.go);

  // Derived (stable) — never map inside the selector, it breaks snapshots.
  const inventoryIds = useMemo(() => inventory.map((i) => i.ingredientId), [inventory]);

  const [query, setQuery] = useState("");
  const [intents, setIntents] = useState<Intent[]>(["high-protein"]);
  const [timeMax, setTimeMax] = useState<number>(30);
  const [budget, setBudget] = useState<number>(prefs.budget);
  const [people, setPeople] = useState<People>(prefs.defaultServings);
  const [showSearch, setShowSearch] = useState(false);
  // Find My Meal is an explicit action (Phase 5/23): the deterministic list is
  // always computed (never a blank UI), but the results section only reveals
  // once the user presses the CTA — changing chips afterwards never fires a
  // request on its own.
  const [findMyMealUsed, setFindMyMealUsed] = useState(false);

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
  // "Almost there" — 1–2 ingredients away, ALWAYS a separate labeled
  // section. Never mixed into primary results (strict eligibility gate in
  // recommend()).
  const nearRecs = useMemo(() => nearRecipes(filters, 4), [filters]);

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

  const has = (id: string) => inventoryIds.includes(id);
  const toggle = (id: string) => (has(id) ? removeItem(id) : addItem(id));

  const hasInventory = inventoryIds.length > 0;
  const isEmptyKitchen = inventoryIds.length === 0;

  // Find My Meal is the one primary action. It reveals the results section
  // and scrolls to it; the deterministic list itself was already computed
  // (instant), so the press never waits on anything. Funnel events fire
  // here — click + loaded pair marks the top of the core funnel.
  const findMyMeal = () => {
    track("find_my_meal_clicked", { kitchen: inventoryIds.length, intents: intents.join(",") });
    track("recommendations_loaded", { count: recs.length });
    setFindMyMealUsed(true);
    requestAnimationFrame(() => {
      document
        .getElementById("ruchi-results")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // "Let RUCHI Choose" — the engine's single best pick, straight into
  // cooking mode. No comparing, no second-guessing. Strict eligibility
  // holds: chooseForMe returns null rather than a near-miss.
  const ruchiChooses = () => {
    const best = chooseForMe(filters);
    track("ruchi_choose_clicked", { found: !!best });
    if (best) go("cooking", { recipeId: best.recipe.id });
  };

  // Behavior-based personalization (evidence-gated): acknowledges a real
  // protein pattern once 2+ cooked meals support it. Null → silent.
  const proteinNudge = useMemo(
    () => proteinPatternLine(history.map((h) => ({
      recipeId: h.recipeId,
      recipeName: h.recipeName,
      proteinG: h.proteinG,
      cost: h.cost,
      deliveryCompareCost: h.deliveryCompareCost,
    }))),
    [history],
  );

  // ── Featured meal: the user's real top pick, or null when nothing is eligible ──
  const featured = shown[0] ?? null;

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

  // ── Voice: deterministic, context-aware ─────────────────────
  const attention = useRuchi((s) => s.attention);
  const pausedCooking = useRuchi((s) => s.pausedCooking);
  const markAttentionShown = useRuchi((s) => s.markAttentionShown);
  const dismissAttention = useRuchi((s) => s.dismissAttention);

  // Featured-meal facts for the context engine (existing utilities, no extra
  // engine runs — `shown[0]` was already computed above).
  const featuredFacts: AttentionRecipeFacts | null = useMemo(() => {
    if (!featured) return null;
    return {
      timeMin: featured.recipe.timeMin,
      proteinPerServing: computeNutrition(featured.recipe, 1).protein,
      costPerServing: computeCostPerServing(featured.recipe, 1),
    };
  }, [featured]);

  // ONE re-attention opportunity per visit — computed in render (pure),
  // shown only after mount so the "shown" event fires exactly once per
  // real visit (never during SSR/hydration).
  const rawContext = useMemo(
    () =>
      evaluateAttention(
        {
          now: NOW_MS,
          inventoryIds,
          diet: prefs.diet,
          history,
          pausedSession: pausedCooking,
          lastShown: attention.lastShown,
        },
        featured,
        featuredFacts,
      ),
    // NOW_MS is module scope (stable) — intentionally not a dependency.
    [inventoryIds, prefs.diet, history, pausedCooking, attention.lastShown, featured, featuredFacts],
  );

  // Suppression is decided against the state AS OF page load — the
  // "shown" effect below updates the store, and the live state must never
  // mute a context on the same visit it was shown (show-then-vanish bug).
  const [attentionAtLoad] = useState(attention);

  // Suppression check (pure). "Shown" tracking fires in the effect below,
  // once per context per real visit — never during render or SSR.
  const context: AttentionContext = useMemo((): AttentionContext => {
    if (rawContext.type === "none") return rawContext;
    if (isSuppressed(rawContext, attentionAtLoad, NOW_MS)) {
      return { ...rawContext, type: "none" };
    }
    return rawContext;
    // attentionAtLoad is a mount-time snapshot by design (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawContext]);

  // Register the impression exactly once per context change.
  useEffect(() => {
    if (context.type === "none") return;
    track("re_attention_shown", {
      context_type: context.type,
      surface: "home",
      recipe_id: context.recipeId ?? "",
    });
    markAttentionShown(context.type, context.recipeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.type, context.recipeId]);

  // The context drives the hero when it has a real headline; the premium
  // defaults (homeHeadline) carry first-visit/empty states.
  const headline =
    context.type === "none" || !context.headline
      ? homeHeadline(inventoryIds.length, history.length)
      : context.headline.replace(/\./g, ".\n").replace(/\n\n/g, "\n");
  const supportLine = context.type !== "none" && context.supportingText
    ? context.supportingText
    : returnVisitLine(inventoryIds.length, history.length) ?? homeSubLine(inventoryIds.length);
  const hasRealStats = !!cloudStats && cloudStats.mealsCooked > 0;

  // Context CTA — one tap from observation to cooking.
  const contextAction = () => {
    track("re_attention_clicked", {
      context_type: context.type,
      surface: "home",
      recipe_id: context.recipeId ?? "",
    });
    if (context.recipeId) {
      track("re_attention_recipe_selected", { context_type: context.type, recipe_id: context.recipeId });
    }
    if (context.action === "resume" && context.recipeId) {
      go("cooking", { recipeId: context.recipeId });
    } else if (context.action === "cook_again" && context.recipeId) {
      go("cooking", { recipeId: context.recipeId });
    } else if (context.action === "cook" && context.recipeId) {
      go("cooking", { recipeId: context.recipeId });
    } else {
      setFindMyMealUsed(true);
      requestAnimationFrame(() => {
        document.getElementById("ruchi-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  return (
    <div className="pt-8 lg:pt-14">
      {/* ── Hero: statement + featured meal ───────────────────── */}
      <section className="lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
        <header>
          <div className="flex items-center gap-2.5 lg:hidden">
            <RuchiLogo size={28} priority />
            <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-flame">
              రుచి · RUCHI
            </p>
          </div>
          <h1 className="mt-4 font-display text-display-hero font-semibold lg:mt-0">
            {headline.split("\n").map((line, i) => (
              <span key={i} className="block">
                {i === 0 ? (
                  line
                ) : (
                  <span className="accent-italic text-flame">{line}</span>
                )}
              </span>
            ))}
          </h1>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-muted lg:text-[17px]">
            {supportLine}
          </p>
          {/* The context's one action — quiet, next to its own evidence line. */}
          {context.type !== "none" && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={contextAction}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink px-6 py-3 text-[15px] font-semibold text-cream shadow-soft transition-all duration-200 hover:bg-ink-soft active:scale-[0.98]"
              >
                {context.action === "resume" ? "Resume cooking →" : null}
                {context.action === "cook_again" ? "Cook again →" : null}
                {context.action === "cook" ? "Cook this →" : null}
                {context.action === "find_meal" ? "See what you can make →" : null}
              </button>
              <button
                onClick={() => {
                  track("re_attention_dismissed", { context_type: context.type, surface: "home" });
                  dismissAttention();
                }}
                className="inline-flex min-h-[44px] items-center px-3 text-[14px] font-medium text-muted transition-colors hover:text-ink"
              >
                Not now
              </button>
            </div>
          )}
          {hasRealStats && (
            <p className="mt-3 text-[15px] font-medium text-ink-soft">
              {keptInPocket(cloudStats.totalSaved)}
              {cloudStats.mealsCooked > 1 ? ` ${cloudStats.mealsCooked} meals down.` : ""}
            </p>
          )}

          {/* Social proof of simplicity — honest, no fabricated numbers */}
          <p className="mt-6 hidden items-center gap-2 text-[13px] text-muted sm:flex">
            <Sparkles size={14} className="text-flame" />
            No account needed. No clutter. Just dinner.
          </p>
        </header>

        {/* Featured meal — the decision, already made for them */}
        {featured ? (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="mt-12 lg:mt-0"
          >
            <FeaturedMeal
              recipe={featured.recipe}
              protein={computeNutrition(featured.recipe, people).protein}
              costPerServing={computeCostPerServing(featured.recipe, people)}
              matchedLine={
                featured.coreMatched != null
                  ? `You already have ${featured.coreMatched}/${featured.coreTotal} ingredients.`
                  : featured.reason ?? null
              }
              onCook={() => {
                track("meal_selected", { recipeId: featured.recipe.id, via: "featured-cook" });
                if (context.recipeId === featured.recipe.id) {
                  track("re_attention_cooking_started", {
                    context_type: context.type,
                    recipe_id: featured.recipe.id,
                  });
                }
                go("cooking", { recipeId: featured.recipe.id });
              }}
              onDetails={() => {
                track("meal_selected", { recipeId: featured.recipe.id, via: "featured-details" });
                go("meal", { recipeId: featured.recipe.id });
              }}
            />
          </motion.div>
        ) : (
          <HeroVisual onScan={() => go("scan")} className="mt-12 lg:mt-0" />
        )}
      </section>

      {/* ── Real cooking stats — the re-attention strip (server data only) ── */}
      {hasRealStats && (
        <div className="mt-12 border-y border-line py-6">
          <div className="flex items-center justify-around gap-6 text-center sm:justify-start sm:gap-14 sm:text-left">
            <div>
              <p className="font-display text-[30px] font-semibold leading-none">
                {cloudStats.mealsCooked}
              </p>
              <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                meals cooked
              </p>
            </div>
            <div>
              <p className="font-display text-[30px] font-semibold leading-none text-flame-deep">
                🔥 {cloudStats.currentStreak} day{cloudStats.currentStreak === 1 ? "" : "s"}
              </p>
              <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                cooking streak
              </p>
            </div>
            <div>
              <p className="font-display text-[30px] font-semibold leading-none text-gold">
                ₹{cloudStats.totalSaved.toLocaleString("en-IN")}
              </p>
              <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                estimated saved
              </p>
            </div>
          </div>
          <p className="mt-4 text-[11.5px] text-muted">
            Counted from meals you actually finished, synced from your account.
          </p>
        </div>
      )}

      {/* ── Recently cooked — real completions only, one tap to repeat ── */}
      {recentCooked.length > 0 && (
        <section className="mt-14" aria-label={RECENTLY_COOKED_HEADING}>
          <SectionHeading
            eyebrow="From your kitchen"
            title={RECENTLY_COOKED_HEADING}
            right={
              <button
                onClick={() => go("profile")}
                className="text-[13px] font-semibold text-flame transition-colors hover:text-flame-deep"
              >
                All cooks →
              </button>
            }
          />
          <Rail>
            {recentCooked.slice(0, 8).map((h) => {
              const r = RECIPES.find((x) => x.id === h.recipeId);
              return (
                <RailItem key={h.id}>
                  <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-3.5 shadow-soft">
                    {r ? (
                      <FoodVisual recipe={r} emojiClassName="text-3xl" className="h-14 w-14 shrink-0 rounded-2xl" />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-cream-deep text-2xl">🍽️</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-semibold">{r?.name ?? h.recipeName}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {r ? `${r.timeMin} min` : ""}{r && h.cost ? " · " : ""}₹{h.cost}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        track("meal_selected", { recipeId: h.recipeId, via: "cook-again" });
                        go("cooking", { recipeId: h.recipeId });
                      }}
                      disabled={!r}
                      className="shrink-0 rounded-full bg-flame-soft px-3.5 py-2 text-[12.5px] font-bold text-flame-deep transition-colors hover:bg-flame hover:text-white disabled:pointer-events-none disabled:opacity-40"
                      aria-label={`Cook ${r?.name ?? h.recipeName} again`}
                    >
                      {COOK_AGAIN_LABEL}
                    </button>
                  </div>
                </RailItem>
              );
            })}
          </Rail>
        </section>
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
        {hasInventory && (
          <p className="-mt-1 mb-3 text-[14.5px] font-medium text-ink-soft">
            {kitchenGoodLine(inventoryIds.length)}
          </p>
        )}

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
              <p className="mb-2 text-[15px] font-semibold">What are you looking for?</p>
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

            {/* The one primary action — everything above is optional. */}
            <div className="rounded-3xl border border-line bg-surface p-5 shadow-soft">
              <button
                onClick={findMyMeal}
                className="relative inline-flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-flame px-8 py-4 text-[16px] font-bold text-white shadow-cta transition-all duration-200 hover:bg-flame-deep active:scale-[0.98]"
              >
                <ShimmerSweep />
                <Sparkles size={18} strokeWidth={2.2} />
                <span className="relative">Find My Meal ✨</span>
              </button>
              <p className="mt-3 text-center text-[13.5px] font-medium text-muted">
                {proteinNudge ?? intentWhisper(intents)}
              </p>
            </div>

            {/* Fast lane for the hungry: one tap, decided, cooking. */}
            <button
              onClick={ruchiChooses}
              disabled={!hasInventory}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-line-strong bg-surface px-6 py-3 text-[15px] font-semibold text-ink shadow-soft transition-all duration-200 hover:border-ink/25 hover:shadow-lifted active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              <Shuffle size={16} className="text-flame" aria-hidden />
              {LET_RUCHI_CHOOSE_LABEL}
            </button>
            <p className="mt-1.5 text-center text-[12.5px] text-muted">{LET_RUCHI_CHOOSE_SUB}</p>
          </motion.div>
        )}
      </section>

      {/* ── Recommendations — revealed by Find My Meal (the featured pick leads) ── */}
      {hasInventory && findMyMealUsed && (
        <section className="mt-14 scroll-mt-24" id="ruchi-results" aria-live="polite">
          <SectionHeading
            eyebrow="From your kitchen"
            title={`I found ${shown.length} meal${shown.length === 1 ? "" : "s"} for you.`}
          />

          {shown.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={20} />}
              title="I couldn't find a great match"
              body="Try adding another ingredient or relaxing your filters — RUCHI only shows meals you can actually cook right now."
            />
          ) : (
            <StaggerGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((rec) => {
                const r = rec.recipe;
                const n = computeNutrition(r, people);
                const cost = computeCostPerServing(r, people);
                return (
                  <StaggerItem key={r.id}>
                    <RecipeCard
                      recipe={r}
                      protein={n.protein}
                      calories={n.calories}
                      costPerServing={cost}
                      missingCount={rec.missing.length}
                      canCookNow={rec.missing.length === 0}
                      coreMatched={rec.coreMatched}
                      coreTotal={rec.coreTotal}
                      reason={rec.reason}
                      tags={r.tags}
                      why={rec.why}
                      notNeeded={rec.notNeeded}
                      deliveryCompareCost={r.deliveryCompare.cost}
                      onClick={() => {
                        track("meal_selected", { recipeId: r.id, via: "home" });
                        go("meal", { recipeId: r.id });
                      }}
                      onCook={() => {
                        track("meal_selected", { recipeId: r.id, via: "cook-direct" });
                        go("cooking", { recipeId: r.id });
                      }}
                    />
                  </StaggerItem>
                );
              })}
            </StaggerGroup>
          )}

          {/* Phase 6: can't decide? The engine picks, cooking starts. */}
          {shown.length > 0 && (
            <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <button
                onClick={ruchiChooses}
                className="inline-flex items-center gap-2 rounded-2xl border border-line-strong bg-surface px-6 py-3.5 text-[15px] font-semibold text-ink shadow-soft transition-all duration-200 hover:border-ink/25 hover:shadow-lifted active:scale-[0.98]"
              >
                <Shuffle size={16} className="text-flame" aria-hidden />
                Not sure? Let RUCHI choose ✨
              </button>
              <p className="text-[13px] leading-relaxed text-muted">
                Picks the best match from your kitchen and starts the step-by-step cook.
              </p>
            </div>
          )}

          {/* ── Almost there — clearly labeled, NEVER mixed into primary ── */}
          {nearRecs.length > 0 && (
            <section className="mt-10" aria-label="Almost there">
              <SectionHeading
                eyebrow="Almost there"
                title="One or two ingredients away"
                right={
                  <span className="text-[12px] font-medium text-muted">
                    Missing something? Tap to add.
                  </span>
                }
              />
              <div className="mt-4 space-y-3">
                {nearRecs.map((rec) => {
                  const r = rec.recipe;
                  const n = computeNutrition(r, people);
                  const cost = computeCostPerServing(r, people);
                  return (
                    <Card key={r.id} className="p-4">
                      <button
                        type="button"
                        onClick={() => go("meal", { recipeId: r.id })}
                        className="flex w-full items-start justify-between gap-3 text-left"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{r.name}</p>
                          <p className="mt-0.5 text-[12.5px] text-muted">
                            {rec.minutes} min · {n.protein}g protein · ₹{cost}
                          </p>
                        </div>
                        <span className="shrink-0 text-[12px] font-semibold text-flame">
                          {rec.reason}
                        </span>
                      </button>
                      {/* Missing core items — tap to add; validated swap shown
                          when the recipe's own table declares one. */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] text-muted">Missing:</span>
                        {rec.missing.map((id) => {
                          const name = INGREDIENTS.find((i) => i.id === id)?.name ?? id;
                          const swapName = (() => {
                            const rule = r.substitutions.find(
                              (s) => s.missingId === id && s.useId,
                            );
                            return rule?.useId
                              ? INGREDIENTS.find((i) => i.id === rule.useId)?.name ?? null
                              : null;
                          })();
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
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </section>
      )}

      {/* ── Empty-kitchen welcome (inviting, not broken) ────────── */}
      {isEmptyKitchen && (
        <section className="mt-16">
          <Card className="warm-glow overflow-hidden p-7 sm:p-9">
            <p className="font-display text-display-md font-semibold leading-snug">
              Nothing in the kitchen yet. Good — let&apos;s fix that.
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
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={() => go("scan")}
                className="relative inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-flame px-8 py-4 text-[16px] font-bold text-white shadow-cta transition-all duration-200 hover:bg-flame-deep active:scale-[0.98]"
              >
                <ShimmerSweep />
                <Camera size={18} strokeWidth={2.2} />
                <span className="relative">Scan ingredients</span>
              </button>
              <span className="hidden items-center text-[13px] text-muted sm:flex">
                or tap an ingredient below
              </span>
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
              calories={computeNutrition(r, 1).calories}
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
                calories={computeNutrition(r, 1).calories}
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
                calories={computeNutrition(r, 1).calories}
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
                calories={computeNutrition(r, 1).calories}
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

// ── FeaturedMeal — the decision, already made ───────────────
// The user's real top engine pick, presented as the product's answer:
// dominant visual, minimal stats, ONE primary CTA + quiet details link.

function FeaturedMeal({
  recipe,
  protein,
  costPerServing,
  matchedLine,
  onCook,
  onDetails,
}: {
  recipe: Recipe;
  protein: number;
  costPerServing: number;
  matchedLine: string | null;
  onCook: () => void;
  onDetails: () => void;
}) {
  return (
    <div aria-label={`Featured meal: ${recipe.name}`}>
      <div className="relative rounded-[2rem] border border-line bg-surface p-5 shadow-lifted sm:p-7">
        <FoodVisual
          recipe={recipe}
          zoom
          emojiClassName="text-7xl sm:text-8xl"
          className="aspect-[16/10] w-full rounded-2xl"
        />
        <div className="mt-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-display text-[24px] font-semibold leading-snug">{recipe.name}</p>
            <p className="mt-1.5 text-[13.5px] font-medium text-muted">
              {recipe.timeMin} min
              <span aria-hidden className="mx-1.5 text-line-strong">·</span>
              {protein}g protein
              <span aria-hidden className="mx-1.5 text-line-strong">·</span>
              ~₹{costPerServing}
            </p>
            {matchedLine && (
              <p className="mt-1 text-[13.5px] font-medium text-sage">{matchedLine}</p>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <button
            onClick={onCook}
            className="relative inline-flex flex-1 items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-flame px-8 py-4 text-[16px] font-bold text-white shadow-cta transition-all duration-200 hover:bg-flame-deep active:scale-[0.98]"
          >
            <ShimmerSweep />
            <span className="relative">Cook this →</span>
          </button>
          <button
            onClick={onDetails}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line-strong bg-surface px-6 py-4 text-[15px] font-semibold text-ink transition-all duration-200 hover:border-ink/25 active:scale-[0.98]"
          >
            View details
          </button>
        </div>
        <p className="mt-3 text-center text-[12.5px] text-muted">{FEATURED_CTA_HINT}</p>
      </div>
    </div>
  );
}

// ── Hero visual (empty kitchen) ─────────────────────────────
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

      {/* Floating accent chip — the product promise */}
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
