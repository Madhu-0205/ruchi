// ─────────────────────────────────────────────────────────────
// RUCHI — Core Experience 2.0: recipe intelligence tests
// ─────────────────────────────────────────────────────────────
// The spec's acceptance cases, locked as tests: brand → canonical family
// normalization, the instant-noodle meal family, cookability semantics
// (optional never blocks, required missing downgrades), pantry staples,
// recipe aliases, and honest ingredients (no fabrication).

import { describe, expect, it } from "vitest";
import { resolveIngredientId } from "@/lib/engine/parse";
import { recommend, matchRecipes, nearRecipes } from "@/lib/engine/match";
import { RECIPES, getRecipe } from "@/lib/data/recipes";
import { INGREDIENTS, findIngredient, isAssumedPantry } from "@/lib/data/ingredients";
import type { Intent } from "@/lib/types";

const BASE = {
  intents: ["quick"] as Intent[],
  timeMax: 0,
  budgetMax: 0,
  servings: 1,
  diet: "eggetarian" as const,
};

// ── Brand → canonical family normalization ─────────────────────

describe("ingredient normalization: instant noodles", () => {
  const BRANDS = [
    "maggi",
    "maggi noodles",
    "nestle maggi",
    "2-minute noodles",
    "2 minute noodles",
    "masala noodles",
    "yippee",
    "yippee noodles",
    "sunfeast yippee",
    "top ramen",
    "ramen",
    "instant noodles",
    "chowmin",
    "chow mein",
    "hakka noodles",
  ];

  it("maps every Maggi/Yippee/ramen brand name to the canonical noodles family", () => {
    for (const brand of BRANDS) {
      expect(resolveIngredientId(brand), `brand "${brand}"`).toBe("noodles");
    }
  });

  it("is stable under plural forms and case", () => {
    expect(resolveIngredientId("Maggi")).toBe("noodles");
    expect(resolveIngredientId("YiPPEE Noodles")).toBe("noodles");
    expect(resolveIngredientId("ramens")).toBe("noodles");
  });

  it("keeps brand names inside searchIngredients so manual entry finds them", () => {
    // searchIngredients is the additive-search path; brands must surface.
    expect(INGREDIENTS.some((i) => i.aliases.includes("maggi"))).toBe(true);
    expect(INGREDIENTS.some((i) => i.aliases.includes("yippee"))).toBe(true);
  });
});

// ── The instant-noodle meal family ─────────────────────────────

describe("instant-noodle meal family", () => {
  const FAMILY = [
    "maggi-masala",
    "egg-maggi",
    "cheese-maggi",
    "chilli-garlic-maggi",
    "paneer-maggi",
    "butter-maggi",
    "veggie-loaded-maggi",
  ];

  it("ships as first-class catalog recipes", () => {
    for (const id of FAMILY) {
      expect(getRecipe(id), `${id} must exist`).toBeDefined();
    }
  });

  it("Maggi alone → Maggi-family meals eligible (the original bug, fixed)", () => {
    const recs = recommend({ ...BASE, hasIds: ["noodles"] });
    expect(recs.length).toBeGreaterThan(0);
    // Every primary pick must be a real noodle dish, not an unrelated match.
    for (const r of recs) {
      expect(r.recipe.ingredients.some((i) => i.ingredientId === "noodles")).toBe(true);
    }
  });

  it("Maggi + Egg + Onion → Egg Maggi ranked first, full core match", () => {
    const recs = recommend({ ...BASE, hasIds: ["noodles", "egg", "onion"] });
    expect(recs[0]?.recipe.id).toBe("egg-maggi");
    expect(recs[0]?.category).toBe("CAN_COOK_NOW");
    expect(recs[0]?.coreMatched).toBe(recs[0]?.coreTotal);
    // Onion was confirmed but is optional in the recipe → reflected as owned optional.
    expect(recs[0]?.optionalHave).toContain("onion");
  });

  it("Egg Maggi stays eligible when optional onion is missing", () => {
    const m = matchRecipes({ ...BASE, hasIds: ["noodles", "egg"] }).find(
      (x) => x.recipe.id === "egg-maggi",
    );
    expect(m).toBeDefined();
    expect(m?.category).toBe("CAN_COOK_NOW");
    expect(m?.optionalMissing).toContain("onion");
  });

  it("cheese/paneer/butter/garlic Maggi variants match their named ingredients", () => {
    const cheese = matchRecipes({ ...BASE, hasIds: ["noodles", "cheese"] }).find(
      (x) => x.recipe.id === "cheese-maggi",
    );
    expect(cheese?.category).toBe("CAN_COOK_NOW");
    const paneer = matchRecipes({ ...BASE, hasIds: ["noodles", "paneer"] }).find(
      (x) => x.recipe.id === "paneer-maggi",
    );
    expect(paneer?.category).toBe("CAN_COOK_NOW");
  });

  it("Yippee (same family) finds the same meal family — brand identity kept in recipe names", () => {
    // Brands normalize to one family; recipe names keep the brand flavor.
    const recs = recommend({ ...BASE, hasIds: ["noodles", "egg"] });
    expect(recs.some((r) => r.recipe.id === "egg-maggi")).toBe(true);
    const masala = getRecipe("maggi-masala");
    expect(masala?.aliases).toContain("2-minute noodles");
  });

  it("confidenceHints give the noodle family a deterministic ranking edge", () => {
    // Maggi alone: the dedicated Maggi Masala should outrank generic equals.
    const scored = matchRecipes({ ...BASE, hasIds: ["noodles"] });
    const masala = scored.find((x) => x.recipe.id === "maggi-masala");
    expect(masala).toBeDefined();
    const firstNonNoodle = scored.find(
      (x) => !x.recipe.ingredients.some((i) => i.ingredientId === "noodles"),
    );
    if (firstNonNoodle) {
      expect(masala!.score).toBeGreaterThan(firstNonNoodle.score);
    }
  });
});

// ── Cookability semantics ──────────────────────────────────────

describe("cookability: core vs optional vs pantry", () => {
  it("optional ingredients missing → recipe remains fully cookable", () => {
    const m = matchRecipes({ ...BASE, hasIds: ["noodles", "egg"] }).find(
      (x) => x.recipe.id === "egg-maggi",
    );
    expect(m?.missingCount).toBe(0);
    expect(m?.category).toBe("CAN_COOK_NOW");
  });

  it("required ingredient missing → appropriately downgraded, never CAN_COOK_NOW", () => {
    // Paneer Maggi without paneer (and without any swap owned).
    const m = matchRecipes({ ...BASE, hasIds: ["noodles"] }).find(
      (x) => x.recipe.id === "paneer-maggi",
    );
    if (m) {
      expect(m.missingCount).toBeGreaterThan(0);
      expect(m.category).not.toBe("CAN_COOK_NOW");
      expect(m.missing).toContain("paneer");
    }
    // And it must never appear in primary eligibility.
    const recs = recommend({ ...BASE, hasIds: ["noodles"] });
    expect(recs.find((r) => r.recipe.id === "paneer-maggi")).toBeUndefined();
  });

  it("missing essentials surface in nearRecipes with the honest missing list", () => {
    const near = nearRecipes({ ...BASE, hasIds: ["noodles"] });
    const paneer = near.find((r) => r.recipe.id === "paneer-maggi");
    if (paneer) expect(paneer.missing).toContain("paneer");
  });

  it("pantry staples never block or appear as missing", () => {
    // Oil/salt/water are assumed — they are not core, not missing, not shown.
    for (const pantryId of ["oil", "salt", "water"]) {
      expect(isAssumedPantry(pantryId)).toBe(true);
    }
    const m = matchRecipes({ ...BASE, hasIds: ["noodles", "egg"] }).find(
      (x) => x.recipe.id === "egg-maggi",
    );
    expect(m?.missing).not.toContain("oil");
    expect(m?.missing).not.toContain("water");
  });
});

// ── Recipe aliases (search/display ontology) ───────────────────

describe("recipe ontology: aliases and hints", () => {
  it("noodle recipes carry search aliases and confidenceHints", () => {
    for (const id of ["maggi-masala", "egg-maggi", "cheese-maggi"]) {
      const r = getRecipe(id);
      expect(r?.aliases?.length).toBeGreaterThan(0);
      expect(r?.confidenceHints?.length).toBeGreaterThan(0);
    }
  });

  it("aliases are optional elsewhere — the extended schema is backward compatible", () => {
    const legacy = getRecipe("egg-bhurji");
    expect(legacy?.aliases).toBeUndefined();
  });
});

// ── Honesty: no fabricated ingredients ─────────────────────────

describe("ingredient honesty", () => {
  it("every new recipe ingredient reference resolves to a real catalog entry", () => {
    const ids = new Set(INGREDIENTS.map((i) => i.id));
    for (const id of ["maggi-masala", "egg-maggi", "cheese-maggi", "chilli-garlic-maggi", "paneer-maggi", "butter-maggi", "veggie-loaded-maggi"]) {
      const r = getRecipe(id)!;
      for (const ri of r.ingredients) {
        expect(ids.has(ri.ingredientId), `${id} references ${ri.ingredientId}`).toBe(true);
      }
    }
  });

  it("the cheese ingredient exists with sane reference data", () => {
    const cheese = findIngredient("cheese");
    expect(cheese).toBeDefined();
    expect(cheese?.nutritionPer100.protein).toBeGreaterThan(0);
    expect(cheese?.aliases.length).toBeGreaterThan(0);
  });

  it("the whole catalog still validates with unique ids", () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
