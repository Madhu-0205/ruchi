// Tests for lib/engine/units — quantity formatting + serving scaling.
// The invariant that matters most: users never do portion math.

import { describe, expect, it } from "vitest";
import {
  formatNumber,
  formatQuantity,
  quantityForGrams,
  scaleForServings,
  scaleStepText,
  unitLabel,
} from "@/lib/engine/units";
import type { Ingredient, RecipeIngredient } from "@/lib/types";

const egg: Ingredient = {
  id: "egg",
  name: "Eggs",
  aliases: ["egg"],
  category: "protein",
  nutritionPer100: { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 },
  avgPieceG: 55,
  costPer100: 12,
  tags: [],
};

const onion: Ingredient = {
  ...egg,
  id: "onion",
  name: "Onion",
  avgPieceG: 110,
};

const paneer: Ingredient = {
  ...egg,
  id: "paneer",
  name: "Paneer",
  avgPieceG: undefined,
};

const count = (ingredientId: string, qty: number, scalable = true): RecipeIngredient => ({
  ingredientId,
  qty,
  unit: "count",
  scalable,
});

describe("formatNumber", () => {
  it("snaps to beginner-friendly fractions", () => {
    expect(formatNumber(1)).toBe("1");
    expect(formatNumber(0.5)).toBe("½");
    expect(formatNumber(1.5)).toBe("1½");
    expect(formatNumber(0.75)).toBe("¾");
    expect(formatNumber(1.26)).toBe("1¼");
  });

  it("falls back to one decimal for non-quarter values", () => {
    expect(formatNumber(2.4)).toBe("2.4");
  });
});

describe("unitLabel", () => {
  it("pluralizes countable units", () => {
    expect(unitLabel("clove", 1)).toBe("clove");
    expect(unitLabel("clove", 3)).toBe("cloves");
    expect(unitLabel("cup", 2)).toBe("cups");
    expect(unitLabel("tbsp", 2)).toBe("tbsp");
  });
});

describe("formatQuantity", () => {
  it("scales scalable counts with servings", () => {
    expect(formatQuantity(count("egg", 4), 2, egg)).toBe("4");
    expect(formatQuantity(count("egg", 4), 1, egg)).toBe("2");
    expect(formatQuantity(count("egg", 4), 4, egg)).toBe("8");
  });

  it("formats count-based produce as ½ medium Onion, not 0.5", () => {
    expect(formatQuantity(count("onion", 1), 2, onion)).toBe("1 medium");
    expect(formatQuantity(count("onion", 1), 1, onion)).toBe("½ medium");
  });

  it("does not scale non-scalable quantities beyond the cap", () => {
    const oil: RecipeIngredient = { ingredientId: "oil", qty: 1.5, unit: "tbsp", scalable: false };
    expect(formatQuantity(oil, 1)).toBe("1½ tbsp");
    expect(formatQuantity(oil, 4)).toBe("2¼ tbsp"); // capped 1.5× growth
  });

  it("formats gram quantities", () => {
    const p: RecipeIngredient = { ingredientId: "paneer", qty: 200, unit: "g", scalable: true };
    expect(formatQuantity(p, 1, paneer)).toBe("100 g");
    expect(formatQuantity(p, 4, paneer)).toBe("400 g");
  });
});

describe("quantityForGrams", () => {
  it("converts every unit through grams", () => {
    expect(quantityForGrams(count("egg", 4), 2, egg)).toBeCloseTo(220); // 4 × 55g
    expect(quantityForGrams(count("egg", 4), 1, egg)).toBeCloseTo(110);
    const g: RecipeIngredient = { ingredientId: "paneer", qty: 200, unit: "g", scalable: true };
    expect(quantityForGrams(g, 2, paneer)).toBeCloseTo(200);
    const tbsp: RecipeIngredient = { ingredientId: "oil", qty: 1.5, unit: "tbsp", scalable: false };
    expect(quantityForGrams(tbsp, 2, paneer)).toBeCloseTo(22.5); // 1.5 × 15g
    const tsp: RecipeIngredient = { ingredientId: "salt", qty: 0.25, unit: "tsp", scalable: false };
    expect(quantityForGrams(tsp, 2, paneer)).toBeCloseTo(1.25);
  });

  it("keeps non-scalable quantities constant across servings", () => {
    const salt: RecipeIngredient = { ingredientId: "salt", qty: 0.75, unit: "tsp", scalable: false };
    expect(quantityForGrams(salt, 1, paneer)).toBe(quantityForGrams(salt, 4, paneer));
  });
});

describe("scaleForServings", () => {
  it("returns numeric scaled quantities", () => {
    expect(scaleForServings(count("egg", 4), 1)).toBe(2);
    expect(scaleForServings(count("egg", 4), 4)).toBe(8);
  });
});

describe("scaleStepText", () => {
  const S1 = "Beat 4 eggs with a pinch of salt. Crumble 200g paneer. Chop 1 onion, 1 tomato.";
  const MASALA = "Add ¼ tsp turmeric, ½ tsp chili powder and ¾ tsp salt. Cook 3 minutes.";
  const RICE = "Boil 3 cups of water and cook 90 seconds more.";

  it("is a no-op at the 2-serving baseline", () => {
    expect(scaleStepText(S1, 1)).toBe(S1);
  });

  it("scales half servings inside the text — no portion math for the user", () => {
    const out = scaleStepText(S1, 0.5);
    expect(out).toContain("Beat 2 eggs");
    expect(out).toContain("100 g paneer");
    expect(out).toContain("½ onion");
    expect(out).toContain("½ tomato");
  });

  it("scales up and keeps unit spelling natural", () => {
    const out = scaleStepText(S1, 2);
    expect(out).toContain("Beat 8 eggs");
    expect(out).toContain("400 g paneer");
  });

  it("scales fractions (¼ tsp → ½ tsp) but never times or temperatures", () => {
    const out = scaleStepText(MASALA, 2);
    expect(out).toContain("½ tsp turmeric");
    expect(out).toContain("1 tsp chili powder"); // ½ × 2 = 1, singular
    expect(out).toContain("1½ tsp salt"); // ¾ × 2
    expect(out).toContain("Cook 3 minutes"); // time untouched
  });

  it("scales cups but leaves seconds alone", () => {
    const out = scaleStepText(RICE, 2 / 3);
    expect(out).toContain("2 cups");
    expect(out).toContain("90 seconds");
  });

  it("keeps grammar sane at 1 (" + "2 eggs → 1 egg" + ")", () => {
    const out = scaleStepText("Beat 2 eggs and add 1 onions", 0.5);
    expect(out).toContain("1 egg");
    expect(out).not.toContain("1 onions");
  });
});
