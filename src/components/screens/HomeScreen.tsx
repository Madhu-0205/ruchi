"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X, Sparkles, Camera } from "lucide-react";
import { Card, Chip, Pill, SectionTitle, Stat } from "@/components/ui";
import { useRuchi, weeklyProgress } from "@/lib/store";
import { useScreen } from "@/lib/store/screens";
import { INGREDIENTS, searchIngredients } from "@/lib/data/ingredients";
import { recommend } from "@/lib/engine/match";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import type { Intent, People } from "@/lib/types";

const INTENTS: { id: Intent; label: string }[] = [
  { id: "high-protein", label: "💪 High Protein" },
  { id: "healthy", label: "🥗 Healthy" },
  { id: "quick", label: "⚡ Quick" },
  { id: "budget", label: "💰 Budget" },
  { id: "comfort", label: "🍛 Comfort" },
  { id: "spicy", label: "🌶️ Spicy" },
];

const TIMES = [10, 15, 30, 45] as const;
const BUDGETS = [50, 100, 150, 200] as const;
const PEOPLE: People[] = [1, 2, 3, 4];

const SUGGESTED = ["egg", "paneer", "tomato", "onion", "rice", "bread", "potato", "curd", "capsicum", "toor-dal"];

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

  const recs = useMemo(
    () =>
      recommend({
        hasIds: inventoryIds,
        intents,
        timeMax,
        budgetMax: budget,
        servings: people,
        diet: prefs.diet,
      }),
    [inventoryIds, intents, timeMax, budget, people, prefs.diet],
  );

  const week = useMemo(() => weeklyProgress({ history }), [history]);

  const has = (id: string) => inventoryIds.includes(id);
  const toggle = (id: string) => (has(id) ? removeItem(id) : addItem(id));

  const stage = inventoryIds.length === 0 ? 0 : 1; // 0 = add ingredients, 1 = choose prefs

  return (
    <div className="pt-6">
      {/* Hero */}
      <header className="mb-6">
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-flame">రుచి · RUCHI</p>
        <h1 className="mt-2 font-display text-[34px] leading-[1.08] font-bold tracking-tight">
          What&apos;s in your kitchen?
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          {stage === 0
            ? "Add what you have. RUCHI handles the rest — what to cook, how much, and how."
            : "Nice. Now — what are you feeling?"}
        </p>
      </header>

      {/* Hero photo entry — the defining interaction */}
      <motion.button
        onClick={() => go("scan")}
        whileTap={{ scale: 0.985 }}
        className="mb-6 flex w-full items-center gap-4 rounded-3xl bg-ink p-4 text-left text-cream"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cream/10">
          <Camera size={22} strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-bold">Show me what you&apos;ve got</span>
          <span className="mt-0.5 block text-[13px] text-cream/60">
            Snap your kitchen — RUCHI finds dinner.
          </span>
        </span>
        <motion.span
          aria-hidden
          className="text-2xl"
          animate={{ rotate: [0, -8, 8, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }}
        >
          📸
        </motion.span>
      </motion.button>

      {/* Weekly strip (only once they've cooked) */}
      {week.meals > 0 && (
        <Card className="mb-6 p-4">
          <div className="flex items-center justify-between">
            <Stat value={week.meals} label="cooked this week" />
            <Stat value={`₹${week.saved}`} label="saved" tone="savings" />
            <Stat value={`${week.protein}g`} label="protein" tone="protein" />
          </div>
        </Card>
      )}

      {/* Ingredient add */}
      <SectionTitle
        right={
          <span className="flex items-center gap-3">
            {inventoryIds.length > 0 && (
              <button
                onClick={() => useRuchi.getState().clearKitchen()}
                className="text-[13px] font-medium text-muted hover:text-ink"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setShowSearch((v) => !v)}
              className="text-[13px] font-semibold text-flame"
            >
              {showSearch ? "Done" : "Search all"}
            </button>
          </span>
        }
      >
        Your ingredients
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
                className="w-full rounded-2xl border border-line bg-white py-3 pl-10 pr-10 text-[15px] outline-none placeholder:text-muted/60 focus:border-ink/40"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted"
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

      {/* Quick-add chips */}
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

      {/* Selected tray — only shows items added via search, not the quick chips */
      inventory.filter((item) => !SUGGESTED.includes(item.ingredientId)).length > 0 && (
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
                  <button onClick={() => removeItem(item.ingredientId)}>
                    <X size={13} className="opacity-70 hover:opacity-100" />
                  </button>
                </span>
              );
            })}
        </div>
      )}

      {/* Preferences */}
      {inventoryIds.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
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

          <div className="grid grid-cols-2 gap-4">
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

      {/* Recommendations */}
      {inventoryIds.length > 0 && (
        <div className="mt-10">
          <SectionTitle
            right={
              <span className="text-[12px] font-medium text-muted">
                {recs.length} pick{recs.length === 1 ? "" : "s"} for you
              </span>
            }
          >
            Cook this tonight
          </SectionTitle>

          {recs.length === 0 ? (
            <Card className="p-5">
              <p className="font-semibold">Nothing fits those filters — yet.</p>
              <p className="mt-1 text-sm text-muted">
                Try more time, a bigger budget, or another ingredient or two.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {recs.map((rec, idx) => {
                const r = rec.recipe;
                const n = computeNutrition(r, people);
                const cost = computeCostPerServing(r, people);
                const missingNames = rec.missing
                  .map((m) => INGREDIENTS.find((i) => i.id === m)?.name ?? m)
                  .filter(Boolean);
                return (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <Card
                      className="overflow-hidden p-5"
                      onClick={() => go("meal", { recipeId: r.id })}
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-flame-soft text-3xl">
                          {r.heroEmoji}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="truncate text-[17px] font-bold">{r.name}</h3>
                            {idx === 0 && recs.length > 1 && (
                              <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cream">
                                Top pick
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{rec.reason}</p>
                          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <Pill tone="protein">{n.protein}g protein</Pill>
                            <Pill>{n.calories} kcal</Pill>
                            <Pill tone="time">{r.timeMin} min</Pill>
                            <Pill tone="savings">₹{cost}/serving</Pill>
                            <Pill className="capitalize">{r.difficulty}</Pill>
                          </div>
                        </div>
                      </div>
                      {/* Why this one — makes the pick feel intelligent */}
                      <ul className="mt-3 space-y-1 border-t border-line pt-3">
                        {rec.why.slice(0, 4).map((w) => (
                          <li key={w} className="flex gap-2 text-[13px] leading-relaxed text-muted">
                            <span className="shrink-0 text-sage">✓</span>
                            {w}
                          </li>
                        ))}
                      </ul>
                      {missingNames.length > 0 && (
                        <p className="mt-2 text-[13px] text-muted">
                          {rec.notNeeded.length > 0 && missingNames.length === 0 ? null : (
                            <>
                              Missing: {missingNames.join(", ")}
                              {rec.notNeeded.length > 0 && rec.notNeeded[0] && (
                                <> — but you don&apos;t need {rec.notNeeded[0].toLowerCase()}.</>
                              )}
                            </>
                          )}
                        </p>
                      )}
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty-kitchen nudge */}
      {inventoryIds.length === 0 && (
        <Card className="mt-10 p-5">
          <p className="font-semibold">The deal, simply.</p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-muted">
            <li>· Tap what&apos;s in your kitchen. No quantities needed.</li>
            <li>· RUCHI picks 3–4 dishes you can actually make.</li>
            <li>· Exact quantities, beginner steps, protein and cost — no guessing.</li>
          </ul>
          <div className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-flame">
            <Sparkles size={15} /> No account. No clutter. Just dinner. 🔥
          </div>
        </Card>
      )}

    </div>
  );
}
