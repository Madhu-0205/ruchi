"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChefHat, Flame, ShoppingBag, Sparkles } from "lucide-react";
import { Button, Card, Pill, SectionTitle, Stat } from "@/components/ui";
import { FoodVisual } from "@/components/FoodVisual";
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
    <div className="pb-8 lg:pb-16">
      {/* Back bar */}
      <div className="-mx-4 mb-2 flex items-center justify-between px-4 pt-4 lg:mx-0 lg:px-0 lg:pt-8 sm:-mx-4 sm:px-4">
        <button
          onClick={back}
          className="flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-2 text-[14px] font-semibold text-muted shadow-soft transition-colors hover:text-ink"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <Pill className="capitalize">{recipe.difficulty} · {recipe.cuisine}</Pill>
      </div>

      {/* ── Editorial hero ───────────────────────────────── */}
      <div className="lg:grid lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-12">
        <FoodVisual
          recipe={recipe}
          emojiClassName="text-7xl sm:text-8xl lg:text-9xl"
          className="aspect-[4/3] w-full rounded-[2rem] sm:aspect-[16/9] lg:aspect-[4/3]"
        />

        <div className="mt-6 lg:mt-0">
          <h1 className="font-display text-[34px] font-semibold leading-[1.05] tracking-tight sm:text-[42px] lg:text-[48px]">
            {recipe.name}
          </h1>
          {recipe.teluguName && (
            <p className="mt-1.5 text-[15px] text-muted">{recipe.teluguName}</p>
          )}
          <p className="mt-3 max-w-md text-[15.5px] leading-relaxed text-ink-soft sm:text-[16px]">
            {recipe.description}
          </p>

          {/* Metadata line — typographic, not pills */}
          <p className="mt-4 text-[14px] font-medium text-muted">
            {recipe.timeMin} min
            <span aria-hidden className="mx-2 text-line-strong">·</span>
            {nutrition.protein}g protein
            <span aria-hidden className="mx-2 text-line-strong">·</span>
            ₹{costPerServing} / serving
            <span aria-hidden className="mx-2 text-line-strong">·</span>
            <span className="capitalize">{recipe.diet === "veg" ? "Vegetarian" : recipe.diet === "egg" ? "Egg" : "Non-veg"}</span>
          </p>

          <div className="mt-6 hidden lg:block">
            <Button
              variant="flame"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => {
                useRuchi.getState().setPrefs({ defaultServings: people });
                go("cooking", { recipeId: recipe.id });
              }}
            >
              <ChefHat size={18} /> Start cooking
            </Button>
          </div>
        </div>
      </div>

      {/* ── Nutrition band ───────────────────────────────── */}
      <Card className="mt-8 p-5 lg:mt-10">
        <div className="grid grid-cols-4 gap-3">
          <Stat value={`${nutrition.protein}g`} label="protein" tone="protein" />
          <Stat value={nutrition.calories} label="kcal" />
          <Stat value={`${recipe.timeMin}m`} label="time" tone="time" />
          <Stat value={`₹${costPerServing}`} label="/ serving" tone="savings" />
        </div>
        <p className="mt-4 border-t border-line pt-3.5 text-[13px] leading-relaxed text-muted">
          {proteinLine} Nutrition is an estimate, not a lab report.
        </p>
      </Card>

      {/* ── Servings scaler ──────────────────────────────── */}
      <div className="mt-9">
        <SectionTitle>Servings</SectionTitle>
        <div className="flex items-center gap-2.5">
          {PEOPLE_OPTIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPeople(p)}
              aria-pressed={people === p}
              className={`h-12 flex-1 rounded-2xl border text-[15px] font-semibold transition-all ${
                people === p
                  ? "border-ink bg-ink text-cream shadow-soft"
                  : "border-line bg-surface text-ink hover:border-line-strong"
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

      {/* ── Ingredients ──────────────────────────────────── */}
      <div className="mt-9">
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
              <div key={ri.ingredientId} className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <span className="text-[15px] font-semibold">
                    {name}
                    {ri.optional && (
                      <span className="ml-1.5 text-[11px] font-medium text-muted">optional</span>
                    )}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <span className="text-[15px] font-bold text-flame-deep">{qty}</span>
                  {!have && !ri.optional && !assumed && (
                    <button
                      onClick={() => addItem(ri.ingredientId)}
                      className="rounded-full bg-ink/[0.055] px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-ink/10"
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
          <Card className="mt-3 border-dashed p-5">
            <p className="text-[14px] font-semibold">
              {missing.length === 1
                ? "You're missing 1 thing."
                : `You're missing ${missing.length} things.`}
            </p>
            <div className="mt-2.5 space-y-2">
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

      {/* ── The delivery math ────────────────────────────── */}
      <div className="mt-9">
        <SectionTitle>The delivery math</SectionTitle>
        <Card className="warm-glow p-5 sm:p-6">
          <p className="text-[15.5px] leading-relaxed">
            You almost ordered {recipe.deliveryCompare.name.toLowerCase()} for{" "}
            <span className="font-bold">₹{recipe.deliveryCompare.cost}</span>.
            <br />
            This meal: about <span className="font-bold text-flame-deep">₹{costPerServing}</span> per
            person.
          </p>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-gold-soft px-4 py-3.5">
            <span className="text-[14px] font-semibold text-gold">Potential saving</span>
            <span className="font-display text-[22px] font-semibold text-gold">₹{save}</span>
          </div>
          <p className="mt-2.5 text-[12px] text-muted">
            Cost estimated from typical metro India ingredient prices. Estimates, not invoices.
          </p>
        </Card>
      </div>

      {/* ── Before you start ─────────────────────────────── */}
      <div className="mt-9">
        <SectionTitle>Before you start</SectionTitle>
        <Card className="p-5 sm:p-6">
          <ul className="space-y-2.5">
            {recipe.beginnerTips.map((tip) => (
              <li key={tip} className="flex gap-2.5 text-[14.5px] leading-relaxed">
                <Sparkles size={15} className="mt-0.5 shrink-0 text-flame" aria-hidden />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
          {recipe.equipment.length > 0 && (
            <p className="mt-4 border-t border-line pt-3.5 text-[13px] text-muted">
              You&apos;ll need: {recipe.equipment.map((e) => e.replace("_", " ")).join(", ")}.
            </p>
          )}
        </Card>
      </div>

      {/* Ordering empathy footer */}
      <p className="mb-4 mt-8 text-center text-[13px] leading-relaxed text-muted">
        <ShoppingBag size={12} className="mr-1 inline" />
        {recipe.timeMin <= 15
          ? `${recipe.timeMin} minutes of cooking beats 30 minutes of waiting for delivery.`
          : "Ordering is fine. Cooking this is faster than you think — and you'll learn it once."}
      </p>

      {/* ── Sticky Start Cooking (mobile) ────────────────── */}
      <div className="sticky bottom-4 z-30 mt-6 lg:hidden">
        <Button
          variant="flame"
          size="lg"
          className="w-full py-4 shadow-cta"
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
    </div>
  );
}
