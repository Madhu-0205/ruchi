// Tests for lib/engine/match — the decision engine.
// The spec's hero scenario is asserted verbatim: student kitchen,
// high-protein, 15 min, ₹100 → Paneer Egg Bhurji must lead.

import { describe, expect, it } from "vitest";
import { matchRecipes, recommend, whyThis } from "@/lib/engine/match";
import { computeCostPerServing } from "@/lib/engine/nutrition";
import { isAssumedPantry } from "@/lib/data/ingredients";
import type { MatchFilters } from "@/lib/engine/match";

// The spec's exact user: 2 eggs, paneer, tomato, onion, rice, ₹100, 20 min,
// high protein, beginner, cooking for 1.
const STUDENT: MatchFilters = {
  hasIds: ["egg", "paneer", "tomato", "onion", "rice"],
  intents: ["high-protein"],
  timeMax: 15,
  budgetMax: 100,
  servings: 1,
  diet: "eggetarian",
};

describe("matchRecipes — hero scenario", () => {
  const recs = recommend(STUDENT);

  it("returns 3–4 recommendations, never a wall of options", () => {
    expect(recs.length).toBeGreaterThanOrEqual(3);
    expect(recs.length).toBeLessThanOrEqual(4);
  });

  it("ranks Paneer Egg Bhurji first — protein breaks ties", () => {
    expect(recs[0]?.recipe.id).toBe("paneer-egg-bhurji");
  });

  it("every recommendation carries real numbers and why-lines", () => {
    for (const r of recs) {
      expect(r.protein).toBeGreaterThan(0);
      expect(r.costPerServing).toBeGreaterThan(0);
      expect(r.minutes).toBeGreaterThan(0);
      expect(r.why.length).toBeGreaterThan(0);
      expect(r.reason.length).toBeGreaterThan(0);
      // cost must agree with the cost engine
      expect(r.costPerServing).toBe(computeCostPerServing(r.recipe, STUDENT.servings));
    }
  });

  it("top pick scores above the low-protein alternatives", () => {
    const scores = matchRecipes(STUDENT);
    const top = scores[0];
    const omelette = scores.find((s) => s.recipe.id === "masala-omelette");
    if (top && omelette) expect(top.score).toBeGreaterThan(omelette.score);
  });
});

describe("assumed pantry", () => {
  it("salt/oil/spices never count as missing", () => {
    const missing = matchRecipes({ ...STUDENT, timeMax: 0, budgetMax: 0 })
      .flatMap((m) => m.missing);
    for (const id of missing) expect(isAssumedPantry(id)).toBe(false);
  });

  it("whyThis reports the core-ingredient count, not raw ingredients", () => {
    const m = matchRecipes(STUDENT)[0];
    if (!m) throw new Error("expected a match");
    const why = whyThis(m, STUDENT);
    expect(why[0]).toMatch(/^Uses (all \d+|\d+ of \d+) ingredient/);
    // bhurji core = egg, paneer, onion, tomato → "Uses all 4"
    expect(why[0]).toContain("4");
  });

  it("whyThis includes protein and beginner cues", () => {
    const m = matchRecipes(STUDENT)[0];
    if (!m) throw new Error("expected a match");
    const why = whyThis(m, STUDENT);
    expect(why.some((w) => /\d+g protein/.test(w))).toBe(true);
    expect(why.some((w) => /Beginner friendly/.test(w))).toBe(true);
  });
});

describe("missing-ingredient logic", () => {
  it("soft-recommends recipes with a missing core item", () => {
    // No rice → egg-fried-rice still matches, with rice + soy-sauce listed as missing
    const noRice = { ...STUDENT, hasIds: ["egg", "paneer", "tomato", "onion"], timeMax: 0, budgetMax: 0 };
    const fried = matchRecipes(noRice).find((m) => m.recipe.id === "egg-fried-rice");
    if (fried) {
      expect(fried.missing).toContain("rice");
      expect(fried.missingCount).toBeGreaterThan(0);
    }
  });

  it("distinguishes core-missing from pantry items", () => {
    const m = matchRecipes({ ...STUDENT, timeMax: 0, budgetMax: 0 }).find(
      (x) => x.recipe.id === "egg-fried-rice",
    );
    if (!m) throw new Error("expected egg-fried-rice to match");
    expect(m.missing).toContain("soy-sauce"); // real gap, shown to the user
    expect(m.missing).not.toContain("oil");
    expect(m.missing).not.toContain("salt");
  });

  it("drops recipes where less than half the core is missing... i.e. coverage < 50%", () => {
    const onlyRice = matchRecipes({
      hasIds: ["rice"],
      intents: [],
      timeMax: 0,
      budgetMax: 0,
      servings: 2,
      diet: "non-vegetarian",
    });
    expect(onlyRice.find((m) => m.recipe.id === "chicken-stir-fry")).toBeUndefined();
  });
});

describe("diet gates", () => {
  it("vegetarian never sees nonveg OR egg dishes (binary policy: egg = non-veg)", () => {
    // Even with an egg-heavy pantry, strict vegetarian mode returns only veg.
    const recs = matchRecipes({ ...STUDENT, diet: "vegetarian", timeMax: 0, budgetMax: 0 });
    expect(recs.length).toBeGreaterThan(0);
    for (const m of recs) expect(m.recipe.diet).toBe("veg");
  });

  it("eggetarian never sees nonveg dishes but keeps egg dishes", () => {
    const recs = matchRecipes(STUDENT);
    for (const m of recs) expect(m.recipe.diet).not.toBe("nonveg");
    expect(recs.some((m) => m.recipe.diet === "egg")).toBe(true);
  });

  it("eggetarian never unlocks meat recipes even with the full chicken kit", () => {
    const recs = matchRecipes({
      ...STUDENT,
      hasIds: ["chicken-breast", "capsicum", "onion", "garlic", "soy-sauce", "vinegar"],
      diet: "eggetarian",
      timeMax: 0,
      budgetMax: 0,
    });
    for (const m of recs) expect(m.recipe.diet).not.toBe("nonveg");
  });

  it("non-vegetarian unlocks chicken recipes when the full stir-fry kit is present", () => {
    // chicken-stir-fry core: chicken, capsicum, onion, garlic, soy-sauce, vinegar
    const recs = matchRecipes({
      ...STUDENT,
      hasIds: ["chicken-breast", "capsicum", "onion", "garlic", "soy-sauce", "vinegar"],
      diet: "non-vegetarian",
      timeMax: 0,
      budgetMax: 0,
    });
    const stir = recs.find((m) => m.recipe.id === "chicken-stir-fry");
    expect(stir).toBeDefined();
    expect(stir?.missing ?? []).toHaveLength(0);
  });
});

describe("filters shape the ranking", () => {
  it("a 10-min window ranks the omelette above slower dishes (soft time gate)", () => {
    const quick = matchRecipes({ ...STUDENT, timeMax: 10 });
    const omelette = quick.findIndex((m) => m.recipe.id === "masala-omelette");
    const dal = quick.findIndex((m) => m.recipe.id === "dal-rice");
    expect(omelette).toBeGreaterThanOrEqual(0); // fits the window, must surface
    if (dal >= 0) expect(omelette).toBeLessThan(dal); // overshoot dishes sink, not vanish
  });

  it("intent matching adds reasons the user understands", () => {
    const m = matchRecipes(STUDENT).find((x) => x.recipe.id === "paneer-egg-bhurji");
    if (!m) throw new Error("expected bhurji");
    expect(m.reasons.join(" ")).toMatch(/High protein|15-min meal/);
  });

  it("recommend() marks optional ingredients as notNeeded per the shipped contract", () => {
    // notNeeded = optional recipe ingredients the user HAS (e.g. green chili):
    // the card says "you don't need it" for garnish-level items.
    const recs = recommend({ ...STUDENT, hasIds: [...STUDENT.hasIds, "green-chili"] });
    const bhurji = recs.find((r) => r.recipe.id === "paneer-egg-bhurji");
    if (bhurji) expect(bhurji.notNeeded).toContain("Green chili");
  });
});
