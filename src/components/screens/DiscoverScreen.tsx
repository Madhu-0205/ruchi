"use client";

import { useMemo, useState } from "react";
import { Card, Pill, SectionTitle } from "@/components/ui";
import { useScreen } from "@/lib/store/screens";
import { useRuchi } from "@/lib/store";
import { RECIPES } from "@/lib/data/recipes";
import { isAssumedPantry } from "@/lib/data/ingredients";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";

type CollectionId =
  | "high-protein"
  | "under-100"
  | "15-min"
  | "indian"
  | "beginner"
  | "one-pan"
  | "healthy";

const COLLECTIONS: { id: CollectionId; label: string; blurb: string }[] = [
  { id: "high-protein", label: "High Protein", blurb: "20g+ per serving. Gains included." },
  { id: "under-100", label: "Under ₹100", blurb: "Full meals that respect your wallet." },
  { id: "15-min", label: "15-Minute Meals", blurb: "Faster than any delivery promise." },
  { id: "indian", label: "Indian Favorites", blurb: "The classics, done properly." },
  { id: "beginner", label: "Beginner Friendly", blurb: "Zero-cooking-experience safe." },
  { id: "one-pan", label: "One-Pan Meals", blurb: "Less washing up. Non-negotiable." },
  { id: "healthy", label: "Healthy", blurb: "Balanced, not sad." },
];

export default function DiscoverScreen() {
  const [active, setActive] = useState<CollectionId>("high-protein");
  const go = useScreen((s) => s.go);
  const inventory = useRuchi((s) => s.inventory);
  const inventoryIds = useMemo(() => inventory.map((i) => i.ingredientId), [inventory]);

  const items = useMemo(() => {
    return RECIPES.filter((r) => {
      switch (active) {
        case "high-protein":
          return computeNutrition(r, 1).protein >= 20;
        case "under-100":
          return computeCostPerServing(r, 1) <= 100;
        case "15-min":
          return r.timeMin <= 15;
        case "indian":
          return r.cuisine === "Indian" || r.cuisine === "South Indian";
        case "beginner":
          return r.difficulty === "easy";
        case "one-pan":
          return r.equipment.filter((e) => e !== "stove").length <= 1;
        case "healthy":
          return r.tags.includes("healthy");
      }
    });
  }, [active]);

  const col = COLLECTIONS.find((c) => c.id === active)!;

  return (
    <div className="pt-6">
      <header className="mb-5">
        <h1 className="font-display text-[30px] font-bold tracking-tight">Discover</h1>
        <p className="mt-1 text-[15px] text-muted">
          Curated lists, not a bottomless feed. That&apos;s the point.
        </p>
      </header>

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

      <SectionTitle right={<span className="text-[12px] text-muted">{items.length} dishes</span>}>
        {col.label}
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
            <p className="text-[15px] font-semibold">This list is empty right now.</p>
            <p className="mt-1 text-sm text-muted">Try another collection.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
