import { describe, expect, it } from "vitest";

import { filterRecipes, searchRecipes } from "@/lib/engine/search";
import { RECIPE_COUNT } from "@/lib/data/recipes";

describe("searchRecipes", () => {
  it("returns the full catalog for an empty query", () => {
    expect(searchRecipes("")).toHaveLength(RECIPE_COUNT);
    expect(searchRecipes("   ")).toHaveLength(RECIPE_COUNT);
  });

  it("finds recipes by exact name", () => {
    const top = searchRecipes("Paneer Egg Bhurji");
    expect(top[0]?.id).toBe("paneer-egg-bhurji");
  });

  it("finds recipes by partial name", () => {
    const results = searchRecipes("bhurji");
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.some((r) => r.name.toLowerCase().includes("bhurji"))).toBe(true);
  });

  it("finds recipes by ingredient", () => {
    const results = searchRecipes("mushroom");
    expect(results[0]?.id).toBe("mushroom-masala");
    expect(results.every((r) => r.ingredients.some((i) => i.ingredientId === "mushroom"))).toBe(
      true,
    );
  });

  it("handles plural ingredient queries", () => {
    const results = searchRecipes("eggs");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.ingredients.some((i) => i.ingredientId === "egg"))).toBe(true);
  });

  it("understands 'under 100' as a budget filter", () => {
    const results = searchRecipes("under 100");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.nutritionPerServing.calories > 0)).toBe(true);
    // every result is tagged budget OR genuinely cheap — verified via engine cost
    for (const r of results.slice(0, 5)) {
      expect(r.tags.includes("budget") || r.deliveryCompare.cost < 200).toBe(true);
    }
  });

  it("understands '15 min' as a time filter", () => {
    const results = searchRecipes("15 min");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.timeMin <= 15)).toBe(true);
  });

  it("understands 'high protein'", () => {
    const results = searchRecipes("high protein");
    expect(results.length).toBeGreaterThan(0);
    // top hits either carry the tag or genuinely have 20g+ protein
    for (const r of results.slice(0, 5)) {
      expect(
        r.tags.includes("high-protein") || r.nutritionPerServing.protein >= 20,
      ).toBe(true);
    }
  });

  it("understands meal categories", () => {
    const breakfast = searchRecipes("breakfast");
    expect(breakfast[0]?.category).toBe("breakfast");
    const dinner = searchRecipes("dinner");
    expect(dinner.every((r) => r.category === "dinner")).toBe(true);
  });

  it("returns nothing for gibberish instead of everything", () => {
    expect(searchRecipes("xyzzy-plugh")).toHaveLength(0);
  });
});

describe("filterRecipes", () => {
  it("filters by category", () => {
    const breakfast = filterRecipes({ category: "breakfast" });
    expect(breakfast.length).toBeGreaterThan(0);
    expect(breakfast.every((r) => r.category === "breakfast")).toBe(true);
  });

  it("filters by diet", () => {
    const veg = filterRecipes({ diet: "veg" });
    expect(veg.every((r) => r.diet === "veg")).toBe(true);
  });

  it("filters by max time", () => {
    const fast = filterRecipes({ maxTime: 15 });
    expect(fast.every((r) => r.timeMin <= 15)).toBe(true);
  });

  it("combines filters", () => {
    const quickVegBreakfast = filterRecipes({ category: "breakfast", diet: "veg", maxTime: 20 });
    expect(quickVegBreakfast.length).toBeGreaterThan(0);
    expect(
      quickVegBreakfast.every(
        (r) => r.category === "breakfast" && r.diet === "veg" && r.timeMin <= 20,
      ),
    ).toBe(true);
  });
});
