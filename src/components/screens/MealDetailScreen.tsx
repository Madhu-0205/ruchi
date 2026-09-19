"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChefHat, Flame, ShoppingBag } from "lucide-react";
import { Button, Card, Pill, SectionTitle, Stat } from "@/components/ui";
import { useScreen } from "@/lib/store/screens";
import { useRuchi } from "@/lib/store";
import { getRecipe } from "@/lib/data/recipes";
import { findIngredient, isAssumedPantry } from "@/lib/data/ingredients";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import { formatQuantity } from "@/lib/engine/units";
import type { People } from "@/lib/types";

const PEOPLE_OPTIONS: People[] = [1, 2, 3, 4];

export default function MealDetailScreen() {
  const recipeId = useScreen((s) => s.recipeId);
  const back = useScreen((s) => s.back);
  const go = useScreen((s) => s.go);
  const addItem = useRuchi((s) => s.addItem);
  const inventory = useRuchi((s) => s.inventory);
  const inventoryIds = useMemo(() => inventory.map((i) => i.ingredientId), [inventory]);

  const [people, setPeople] = useState<People>(1);

  const recipe = recipeId ? getRecipe(recipeId) : undefined;

  useEffect(() => {
    if (!recipe) back();
  }, [recipe, back]);

  const servings = people;
  const nutrition = useMemo(
    () => (recipe ? computeNutrition(recipe, servings) : null),
    [recipe, servings],
  );
  const costPerServing = recipe ? computeCostPerServing(recipe, servings) : 0;
  const save = recipe ? Math.max(0, recipe.deliveryCompare.cost - costPerServing) : 0;

  const missing = useMemo(() => {
    if (!recipe) return [];
    return recipe.ingredients
      .filter(
        (ri) =>
          !ri.optional &&
          !isAssumedPantry(ri.ingredientId) &&
          !inventoryIds.includes(ri.ingredientId),
      )
      .map((ri) => ri.ingredientId);
  }, [recipe, inventoryIds]);

  if (!recipe || !nutrition) return null;

  const proteinLine =
    nutrition.protein >= 35
      ? `${nutrition.protein}g protein. Solid dinner. 💪`
      : nutrition.protein >= 20
        ? `${nutrition.protein}g protein. Good stuff.`
        : `${nutrition.protein}g protein — pair it with dal or curd for more.`;

  return (
    <div className="pt-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={back}
          className="flex items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink"
        >
          <ArrowLeft size={17} /> Back
        </button>
        <Pill className="capitalize">{recipe.difficulty} · {recipe.cuisine}</Pill>
      </div>

      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-flame-soft text-4xl">
          {recipe.heroEmoji}
        </div>
        <div>
          <h1 className="font-display text-[28px] font-bold leading-[1.1]">{recipe.name}</h1>
          {recipe.teluguName && (
            <p className="mt-1 text-[14px] text-muted">{recipe.teluguName}</p>
          )}
          <p className="mt-1 text-[14px] text-muted">{recipe.description}</p>
        </div>
      </div>

      {/* Stat band */}
      <Card className="mt-6 p-4">
        <div className="grid grid-cols-4 gap-2">
          <Stat value={`${nutrition.protein}g`} label="protein" tone="protein" />
          <Stat value={nutrition.calories} label="kcal" />
          <Stat value={`${recipe.timeMin}m`} label="time" tone="time" />
          <Stat value={`₹${costPerServing}`} label="/ serving" tone="savings" />
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-muted">
          {proteinLine} Nutrition is an estimate, not a lab report.
        </p>
      </Card>

      {/* Servings scaler */}
      <div className="mt-6">
        <SectionTitle>Servings</SectionTitle>
        <div className="flex items-center gap-3">
          {PEOPLE_OPTIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPeople(p)}
              className={`h-11 flex-1 rounded-2xl border text-[15px] font-semibold transition-all ${
                people === p
                  ? "border-ink bg-ink text-cream"
                  : "border-line bg-white text-ink hover:border-ink/30"
              }`}
            >
              {p === 4 ? "4+" : p}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted">
          Quantities and nutrition update instantly. No math for you.
        </p>
      </div>

      {/* Ingredients */}
      <div className="mt-8">
        <SectionTitle
          right={
            <span className="text-[12px] font-medium text-muted">
              exact amounts · {servings} {servings === 1 ? "person" : "people"}
            </span>
          }
        >
          Ingredients
        </SectionTitle>
        <Card className="divide-y divide-line overflow-hidden">
          {recipe.ingredients.map((ri) => {
            const ing = findIngredient(ri.ingredientId);
            const have = inventoryIds.includes(ri.ingredientId);
            const assumed = isAssumedPantry(ri.ingredientId);
            const qty = formatQuantity(ri, servings, ing);
            const name = ing?.name ?? ri.ingredientId;
            return (
              <div key={ri.ingredientId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-[15px] font-semibold">
                    {name}
                    {ri.optional && <span className="ml-1.5 text-[11px] font-medium text-muted">optional</span>}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[15px] font-bold text-flame-deep">{qty}</span>
                  {!have && !ri.optional && !assumed && (
                    <button
                      onClick={() => addItem(ri.ingredientId)}
                      className="rounded-full bg-black/5 px-2 py-1 text-[11px] font-semibold text-ink"
                    >
                      + I have it
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </Card>

        {missing.length > 0 && (
          <Card className="mt-3 border-dashed p-4">
            <p className="text-[14px] font-semibold">
              {missing.length === 1 ? "You're missing 1 thing." : `You're missing ${missing.length} things.`}
            </p>
            <div className="mt-2 space-y-2">
              {missing.map((mid) => {
                const sub = recipe.substitutions.find((s) => s.missingId === mid);
                const name = findIngredient(mid)?.name ?? mid;
                const swapOwned = sub?.useId ? inventoryIds.includes(sub.useId) : false;
                const swapName = sub?.useId ? findIngredient(sub.useId)?.name : undefined;
                return (
                  <div key={mid} className="text-[13px] leading-relaxed text-muted">
                    <span className="font-semibold text-ink">{name}:</span>{" "}
                    {swapOwned && swapName && sub ? (
                      <>
                        You have <span className="font-semibold text-sage">{swapName.toLowerCase()}</span> —{" "}
                        {sub.message}
                      </>
                    ) : (
                      sub?.message ?? "Check the fridge again — or improvise boldly."
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* Savings */}
      <div className="mt-8">
        <SectionTitle>The delivery math</SectionTitle>
        <Card className="p-5">
          <p className="text-[15px] leading-relaxed">
            You almost ordered {recipe.deliveryCompare.name.toLowerCase()} for{" "}
            <span className="font-bold">₹{recipe.deliveryCompare.cost}</span>.
            <br />
            This meal: about{" "}
            <span className="font-bold text-flame-deep">₹{costPerServing}</span> per person.
          </p>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-gold-soft px-4 py-3">
            <span className="text-[14px] font-semibold text-gold">Potential saving</span>
            <span className="text-xl font-bold text-gold">₹{save}</span>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Cost estimated from typical metro India ingredient prices. Estimates, not invoices.
          </p>
        </Card>
      </div>

      {/* Beginner tips */}
      <div className="mt-8">
        <SectionTitle>Before you start</SectionTitle>
        <Card className="p-5">
          <ul className="space-y-2">
            {recipe.beginnerTips.map((tip) => (
              <li key={tip} className="flex gap-2 text-[14px] leading-relaxed">
                <span className="text-flame">·</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
          {recipe.equipment.length > 0 && (
            <p className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
              You&apos;ll need: {recipe.equipment.map((e) => e.replace("_", " ")).join(", ")}.
            </p>
          )}
        </Card>
      </div>

      {/* Cook CTA */}
      <div className="sticky bottom-4 z-30 mt-8 pb-2">
        <Button
          className="w-full py-4 text-base shadow-lg shadow-ink/15"
          onClick={() => {
            useRuchi.getState().setPrefs({ defaultServings: people });
            go("cooking", { recipeId: recipe.id });
          }}
        >
          <ChefHat size={18} /> Start cooking
        </Button>
        <p className="mt-2 text-center text-[12px] text-muted">
          <Flame size={11} className="mr-1 inline" />
          Step-by-step guidance, one instruction at a time.
        </p>
      </div>

      {/* Ordering empathy footer */}
      <p className="mb-4 mt-6 text-center text-[13px] leading-relaxed text-muted">
        <ShoppingBag size={12} className="mr-1 inline" />
        {recipe.timeMin <= 15
          ? `${recipe.timeMin} minutes of cooking beats 30 minutes of waiting for delivery.`
          : "Ordering is fine. Cooking this is faster than you think — and you'll learn it once."}
      </p>
    </div>
  );
}
