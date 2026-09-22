"use client";

import { useEffect, useMemo, useState } from "react";
import { Refrigerator, Search, X } from "lucide-react";
import { Button, Card, Chip, EmptyState, Note, SectionHeading, SectionTitle } from "@/components/ui";
import { useRuchi } from "@/lib/store";
import { useScreen } from "@/lib/store/screens";
import { INGREDIENTS, searchIngredients } from "@/lib/data/ingredients";
import { recommend } from "@/lib/engine/match";
import { RecipeCard } from "@/components/RecipeCard";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import type { KitchenItem } from "@/lib/types";

function ExpiryEditor({ item, onDone }: { item: KitchenItem; onDone: () => void }) {
  const setExpiry = useRuchi((s) => s.setItemExpiry);
  const now = useNow();
  const days = (d: number) => () => {
    setExpiry(item.ingredientId, d > 0 ? now + d * 86400000 : undefined);
    onDone();
  };
  const current = item.expiresAt
    ? Math.max(0, Math.ceil((item.expiresAt - now) / 86400000))
    : null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-semibold text-muted">Expires in:</span>
      {[1, 2, 4, 7].map((d) => (
        <button
          key={d}
          onClick={days(d)}
          className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
            current === d ? "bg-ink text-cream" : "border border-line bg-surface"
          }`}
        >
          {d}d
        </button>
      ))}
      {current !== null && (
        <button onClick={days(0)} className="text-[12px] text-muted underline">
          clear
        </button>
      )}
    </div>
  );
}

// Ticks once per mount — gives render-safe "now" for expiry math.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function emojiFor(ingredientId: string): string {
  const map: Record<string, string> = {
    egg: "🥚", paneer: "🧀", tomato: "🍅", onion: "🧅", potato: "🥔",
    rice: "🍚", bread: "🍞", curd: "🥛", milk: "🥛", carrot: "🥕",
    "green-chili": "🌶️", capsicum: "🫑", lemon: "🍋", "chicken-breast": "🍗",
    "coriander-leaves": "🌿", spinach: "🥬", cabbage: "🥬", peas: "🫛",
    "spring-onion": "🧅", garlic: "🧄", ginger: "🫚", butter: "🧈",
    "toor-dal": "🟡", "moong-dal": "🟢", oats: "🥣", poha: "🍚", atta: "🌾",
  };
  return map[ingredientId] ?? "🥘";
}

export default function KitchenScreen() {
  const inventory = useRuchi((s) => s.inventory);
  const prefsDiet = useRuchi((s) => s.prefs.diet);
  const addItem = useRuchi((s) => s.addItem);
  const removeItem = useRuchi((s) => s.removeItem);
  const clearKitchen = useRuchi((s) => s.clearKitchen);
  const go = useScreen((s) => s.go);
  const now = useNow();

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const results = useMemo(() => searchIngredients(query), [query]);

  const expiringSoon = useMemo(
    () =>
      inventory.filter(
        (i) => i.expiresAt && i.expiresAt - now < 2 * 86400000,
      ),
    [inventory, now],
  );

  const inventoryIds = useMemo(
    () => inventory.map((i) => i.ingredientId),
    [inventory],
  );

  const recs = useMemo(
    () =>
      recommend({
        hasIds: inventoryIds,
        intents: [],
        timeMax: 0,
        budgetMax: 0,
        servings: 1,
        diet: prefsDiet,
      }),
    [inventoryIds, prefsDiet],
  );

  return (
    <div className="pt-8 lg:pt-14">
      <header className="mb-7 lg:mb-10">
        <h1 className="font-display text-display-xl font-semibold">Kitchen</h1>
        <p className="mt-2 max-w-lg text-[15.5px] leading-relaxed text-muted">
          What you have, saved. RUCHI uses this to filter every recommendation.
        </p>
      </header>

      {/* ── What can I make right now? (the point of this screen) ── */}
      {inventory.length >= 2 && (
        <section className="mb-12">
          <SectionHeading
            eyebrow="From what you have"
            title="What can I make right now?"
            right={
              <span className="text-[12px] font-medium text-muted">
                {recs.length} ready or close
              </span>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {recs.slice(0, 3).map((rec) => {
              const n = computeNutrition(rec.recipe, 1);
              const cost = computeCostPerServing(rec.recipe, 1);
              return (
                <RecipeCard
                  key={rec.recipe.id}
                  recipe={rec.recipe}
                  protein={n.protein}
                  costPerServing={cost}
                  missingCount={rec.missing.length}
                  canCookNow={rec.missing.length === 0}
                  reason={rec.reason}
                  onClick={() => go("meal", { recipeId: rec.recipe.id })}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Search + add */}
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add an ingredient — English, తెలుగు, हिंदी…"
          aria-label="Add an ingredient"
          className="w-full rounded-2xl border border-line bg-surface py-3 pl-10 pr-10 text-[15px] shadow-soft outline-none placeholder:text-muted/60 focus:border-ink/40"
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
        <div className="mb-5 flex flex-wrap gap-2">
          {results.slice(0, 10).map((i) => (
            <Chip
              key={i.id}
              selected={inventory.some((it) => it.ingredientId === i.id)}
              onClick={() => {
                if (!inventory.some((it) => it.ingredientId === i.id)) {
                  addItem(i.id);
                }
                setQuery("");
              }}
            >
              + {i.name}
            </Chip>
          ))}
          {results.length === 0 && (
            <p className="text-sm text-muted">Nothing found — try another spelling.</p>
          )}
        </div>
      )}

      {/* Inventory */}
      {inventory.length === 0 ? (
        <div className="mt-2">
          <EmptyState
            icon={<Refrigerator size={20} />}
            title="Your kitchen is empty."
            body="Add whatever you actually have — eggs, rice, that sad onion in the corner. RUCHI will remember and only suggest meals that fit."
            action={<Button onClick={() => go("scan")}>Scan ingredients instead</Button>}
          />
        </div>
      ) : (
        <>
          {expiringSoon.length > 0 && (
            <div className="mb-4">
              <Note tone="gold">
                {expiringSoon.length} item{expiringSoon.length > 1 ? "s" : ""} expiring soon 👀 —
                cook these first.
              </Note>
            </div>
          )}

          <SectionTitle
            right={
              <button
                onClick={clearKitchen}
                className="text-[12px] font-medium text-muted transition-colors hover:text-ink"
              >
                Clear all
              </button>
            }
          >
            {inventory.length} ingredient{inventory.length === 1 ? "" : "s"}
          </SectionTitle>

          <Card className="divide-y divide-line overflow-hidden">
            {inventory.map((item) => {
              const ing = INGREDIENTS.find((i) => i.id === item.ingredientId);
              const expDays = item.expiresAt
                ? Math.ceil((item.expiresAt - now) / 86400000)
                : null;
              return (
                <div key={item.id} className="px-4 py-3.5 sm:px-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-xl" aria-hidden>{emojiFor(item.ingredientId)}</span>
                      <div className="min-w-0">
                        <span className="text-[15px] font-semibold">
                          {ing?.name ?? item.ingredientId}
                        </span>
                        {expDays !== null && (
                          <span
                            className={`ml-2 text-[12px] font-semibold ${
                              expDays <= 2 ? "text-flame-deep" : "text-muted"
                            }`}
                          >
                            {expDays <= 0 ? "expires today" : `${expDays}d left`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                        className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-muted transition-colors hover:text-ink"
                      >
                        expiry
                      </button>
                      <button
                        onClick={() => removeItem(item.ingredientId)}
                        className="rounded-full p-1.5 text-muted transition-colors hover:text-ink"
                        aria-label={`Remove ${ing?.name ?? item.ingredientId}`}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                  {expanded === item.id && (
                    <ExpiryEditor item={item} onDone={() => setExpanded(null)} />
                  )}
                </div>
              );
            })}
          </Card>
        </>
      )}

      {inventory.length === 0 && (
        <Button variant="secondary" className="mt-5 w-full" onClick={() => go("home")}>
          Add from Home instead
        </Button>
      )}
    </div>
  );
}
