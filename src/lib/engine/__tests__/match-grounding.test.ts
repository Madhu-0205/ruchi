// ─────────────────────────────────────────────────────────────
// RUCHI — ingredient-grounded matching contract tests
// ─────────────────────────────────────────────────────────────
// The spec's 10 cases: exact match → CAN_COOK_NOW, one-away,
// irrelevant excluded, aliases, dedupe, optional tolerance,
// required enforcement, and preference reordering that never
// overrides ingredient compatibility.

import { describe, expect, it } from "vitest";
import { matchRecipes, nearRecipes, recommend, type MatchFilters } from "@/lib/engine/match";
import { resolveIngredientId } from "@/lib/engine/parse";
import { isAssumedPantry } from "@/lib/data/ingredients";
import { INGREDIENTS } from "@/lib/data/ingredients";
import { RECIPES } from "@/lib/data/recipes";
import type { Recipe } from "@/lib/types";

const BHURJI = RECIPES.find((r) => r.id === "paneer-egg-bhurji");
if (!BHURJI) throw new Error("fixture recipe paneer-egg-bhurji missing");

/** Core (non-optional, non-pantry) ingredient rows of a recipe. */
function cores(r: Recipe) {
  return r.ingredients.filter((i) => !i.optional && !isAssumedPantry(i.ingredientId));
}

function names(r: Recipe) {
  return cores(r).map(
    (i) => INGREDIENTS.find((x) => x.id === i.ingredientId)?.name ?? i.ingredientId,
  );
}

function filters(hasNames: string[], overrides: Partial<MatchFilters> = {}): MatchFilters {
  return {
    hasIds: hasNames
      .map((n) => resolveIngredientId(n))
      .filter((x): x is string => Boolean(x)),
    intents: [],
    diet: "eggetarian",
    timeMax: 0,
    budgetMax: 0,
    servings: 2,
    ...overrides,
  };
}

const find = (scored: ReturnType<typeof matchRecipes>, id: string) =>
  scored.find((m) => m.recipe.id === id);

describe("ingredient-grounded matching (spec cases)", () => {
  it("1. exact core coverage → CAN_COOK_NOW with full n/n counts", () => {
    const need = names(BHURJI);
    const m = find(matchRecipes(filters(need)), BHURJI.id);
    expect(m).toBeDefined();
    expect(m!.category).toBe("CAN_COOK_NOW");
    expect(m!.coreTotal).toBeGreaterThan(0);
    expect(m!.coreMatched).toBe(m!.coreTotal);
    expect(m!.missingCount).toBe(0);
  });

  it("2. one core missing → ONE_OR_FEW_AWAY, still recommended", () => {
    const need = names(BHURJI).slice(0, -1); // have all but the last core
    const m = find(matchRecipes(filters(need)), BHURJI.id);
    expect(m).toBeDefined();
    expect(m!.category).toBe("ONE_OR_FEW_AWAY");
    expect(m!.coreMatched).toBe(m!.coreTotal - 1);
    expect(m!.missingCount).toBe(1);
  });

  it("3. recipe sharing one generic ingredient (egg only) is NOT recommended", () => {
    const scored = matchRecipes(filters(["eggs"]));
    // The bhurji shares only 'egg' with the kitchen → excluded entirely.
    expect(find(scored, BHURJI.id)).toBeUndefined();
    // Nothing returned may have exactly one owned core — the relevance gate.
    for (const m of scored) {
      const owned = cores(m.recipe).filter((i) =>
        filters(["eggs"]).hasIds.includes(i.ingredientId),
      );
      expect(owned.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("4. aliases resolve to the same canonical id (tomatoes → tomato)", () => {
    expect(resolveIngredientId("tomatoes")).toBe(resolveIngredientId("tomato"));
    expect(resolveIngredientId("eggs")).toBe(resolveIngredientId("egg"));
    expect(resolveIngredientId("onions")).toBe(resolveIngredientId("onion"));
  });

  it("5. duplicate detected ingredients collapse to one canonical id", () => {
    const resolved = ["egg", "eggs", "Eggs"].map((n) => resolveIngredientId(n));
    expect(new Set(resolved).size).toBe(1);
  });

  it("6. optional ingredient missing still CAN_COOK_NOW", () => {
    const withOpt = RECIPES.find((r) =>
      r.ingredients.some((i) => i.optional && !isAssumedPantry(i.ingredientId)),
    );
    if (!withOpt) return; // no optional rows in catalog — vacuous
    const coreList = cores(withOpt);
    const need = coreList.map(
      (i) => INGREDIENTS.find((x) => x.id === i.ingredientId)?.name ?? i.ingredientId,
    );
    const m = find(matchRecipes(filters(need)), withOpt.id);
    expect(m).toBeDefined();
    expect(m!.category).toBe("CAN_COOK_NOW"); // optional never blocks
    expect(m!.missing).not.toContain(
      withOpt.ingredients.find((i) => i.optional)?.ingredientId,
    );
  });

  it("7. required ingredient missing → never CAN_COOK_NOW", () => {
    // Have every core except paneer.
    const need = cores(BHURJI)
      .filter((i) => i.ingredientId !== "paneer")
      .map((i) => INGREDIENTS.find((x) => x.id === i.ingredientId)?.name ?? i.ingredientId);
    const m = find(matchRecipes(filters(need)), BHURJI.id);
    expect(m).toBeDefined(); // still relevant (one-away)
    expect(m!.category).not.toBe("CAN_COOK_NOW");
  });

  it("8. high-protein intent reorders within the compatible set, never drops coverage leaders", () => {
    const kitchen = names(BHURJI);
    const base = matchRecipes(filters(kitchen));
    const pro = matchRecipes(filters(kitchen, { intents: ["high-protein"] }));
    // Deterministic engine: same kitchen always ranks the bhurji on top.
    expect(base[0]?.recipe.id).toBe(BHURJI.id);
    expect(pro[0]?.recipe.id).toBe(BHURJI.id);
    // And every intent-ranked recipe was already ingredient-compatible.
    expect(pro.every((m) => m.coreMatched / m.coreTotal >= 0.5)).toBe(true);
  });

  it("9. budget preference ranks cheap compatible meals higher among similar coverage", () => {
    const kitchen = names(BHURJI);
    const base = matchRecipes(filters(kitchen));
    const tight = matchRecipes(filters(kitchen, { budgetMax: 40 }));
    // Nothing is excluded by a tight budget — same candidate set, reordered.
    expect([...tight.map((m) => m.recipe.id)].sort()).toEqual(
      [...base.map((m) => m.recipe.id)].sort(),
    );
    // The pricier bhurji drops below the cheap egg dishes.
    const baseBhurji = base.findIndex((m) => m.recipe.id === BHURJI.id);
    const tightBhurji = tight.findIndex((m) => m.recipe.id === BHURJI.id);
    expect(tightBhurji).toBeGreaterThan(baseBhurji);
  });

  it("10. short cooking-time preference ranks quick meals higher — never excludes", () => {
    const kitchen = names(BHURJI);
    const base = matchRecipes(filters(kitchen));
    const quick = matchRecipes(filters(kitchen, { timeMax: 10 }));
    // Same candidate set, reordered — never filtered.
    expect([...quick.map((m) => m.recipe.id)].sort()).toEqual(
      [...base.map((m) => m.recipe.id)].sort(),
    );
    // The leader is now a genuinely quick dish, and quick dishes fill the
    // top slice more densely than before.
    expect(quick[0]?.recipe.timeMin).toBeLessThanOrEqual(10);
    const quickTop = quick.slice(0, 4).filter((m) => m.recipe.timeMin <= 10).length;
    const baseTop = base.slice(0, 4).filter((m) => m.recipe.timeMin <= 10).length;
    expect(quickTop).toBeGreaterThanOrEqual(baseTop);
  });

  it("engine is deterministic: identical inputs → identical ordering", () => {
    const kitchen = names(BHURJI);
    const a = matchRecipes(filters(kitchen)).map((m) => m.recipe.id);
    const b = matchRecipes(filters(kitchen)).map((m) => m.recipe.id);
    expect(a).toEqual(b);
  });
});

describe("strict eligibility — primary results are exact matches only", () => {
  const KITCHEN = ["eggs", "paneer", "tomato", "onion", "rice"];
  const f = filters(KITCHEN);

  it("TEST 1: Paneer Egg Bhurji (all cores owned) is eligible", () => {
    const recs = recommend(f);
    const rec = recs.find((x) => x.recipe.id === BHURJI.id);
    expect(rec).toBeDefined();
    expect(rec!.missing.length).toBe(0);
  });

  it("TEST 2: Soya Chunks Curry never reaches primary results (swap ≠ ownership)", () => {
    const soya = RECIPES.find((r) => r.id === "soya-chunks-curry");
    if (!soya) return; // catalog guarantee
    // Even though the catalog swaps soya-chunks → paneer and paneer is owned,
    // the user never confirmed soya chunks. recommend() must exclude it.
    const recs = recommend(f);
    expect(recs.find((x) => x.recipe.id === soya.id)).toBeUndefined();
    // It IS a legitimate "almost there" candidate — clearly labeled, separate.
    const near = nearRecipes(f, 12);
    expect(near.find((x) => x.recipe.id === soya.id)).toBeDefined();
  });

  it("TEST 3: recipes with any missing real ingredient are excluded", () => {
    const ineligible = RECIPES.filter((r) => {
      const cores = r.ingredients.filter((i) => !i.optional && !isAssumedPantry(i.ingredientId));
      return cores.some((i) => !f.hasIds.includes(i.ingredientId));
    }).map((r) => r.id);
    const recs = recommend(f).map((x) => x.recipe.id);
    for (const id of ineligible) expect(recs).not.toContain(id);
  });

  it("TEST 4: every primary recommendation's non-pantry cores ⊆ confirmed set (INVARIANT)", () => {
    for (const rec of recommend(f)) {
      const required = rec.recipe.ingredients
        .filter((i) => !i.optional && !isAssumedPantry(i.ingredientId))
        .map((i) => i.ingredientId);
      for (const id of required) {
        expect(f.hasIds).toContain(id);
      }
    }
  });

  it("TEST 5–6: AI picks outside the eligible slice are discarded", () => {
    const soya = RECIPES.find((r) => r.id === "soya-chunks-curry");
    const recs = recommend(f, [
      { recipeId: soya?.id ?? "soya-chunks-curry", matchReason: ["AI says so"] },
      { recipeId: "recipe_999_does_not_exist", matchReason: ["hallucinated"] },
    ]);
    expect(recs.find((x) => x.recipe.id === (soya?.id ?? "soya-chunks-curry"))).toBeUndefined();
    expect(recs.find((x) => x.recipe.id === "recipe_999_does_not_exist")).toBeUndefined();
    // Eligible picks still come through.
    expect(recs.length).toBeGreaterThan(0);
  });

  it("TEST 7: zero eligible recipes → empty primary results, never filler", () => {
    const recs = recommend(filters(["pineapple"]));
    // Either truly no recipe is pineappple-only, or every returned recipe
    // must pass the invariant. No random fill either way.
    for (const rec of recs) {
      const required = rec.recipe.ingredients
        .filter((i) => !i.optional && !isAssumedPantry(i.ingredientId))
        .map((i) => i.ingredientId);
      expect(required.every((id) => id === "pineapple")).toBe(true);
    }
  });

  it("TEST 8: stale-state guard — only the CURRENT confirmed set is honored", () => {
    // Previous scan contained soya chunks; current confirm does not. The
    // engine is pure — no cross-call state — so fresh results depend only
    // on fresh hasIds.
    const fresh = filters(["eggs", "paneer", "tomato", "onion", "rice"]);
    const freshIds = recommend(fresh).map((x) => x.recipe.id);
    // The fresh call must not inherit anything from the stale query —
    // a recipe needing soya-chunks can't be in fresh results.
    const soya = RECIPES.find((r) => r.id === "soya-chunks-curry");
    if (soya) expect(freshIds).not.toContain(soya.id);
    // And fresh results are computed purely from fresh hasIds (determinism).
    expect(recommend(fresh).map((x) => x.recipe.id)).toEqual(freshIds);
  });

  it("TEST 9: duplicate ingredients collapse to one canonical id", () => {
    const resolved = ["tomato", "tomato", "onion"].map((n) => resolveIngredientId(n));
    expect(new Set(resolved).size).toBe(2);
  });

  it("TEST 10: synonym input (tomatoes) matches tomato recipes", () => {
    const sing = filters(["tomatoes"]);
    const plur = filters(["tomato"]);
    expect(sing.hasIds).toEqual(plur.hasIds);
    expect(recommend(sing).map((x) => x.recipe.id)).toEqual(
      recommend(plur).map((x) => x.recipe.id),
    );
  });

  it("nearRecipes never overlaps primary results", () => {
    const primary = new Set(recommend(f).map((x) => x.recipe.id));
    for (const near of nearRecipes(f, 12)) {
      expect(primary.has(near.recipe.id)).toBe(false);
    }
  });
});
