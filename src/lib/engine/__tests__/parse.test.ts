// Tests for lib/engine/parse — "I have eggs, 3 tomatoes, some paneer"
// must find EVERY ingredient. Dropping one silently breaks recommendations.

import { describe, expect, it } from "vitest";
import { bestMatch, parseIngredientText } from "@/lib/engine/parse";

const ids = (text: string) => parseIngredientText(text).map((p) => p.ingredient.id);
const qtyOf = (text: string, id: string) =>
  parseIngredientText(text).find((p) => p.ingredient.id === id)?.estimatedQty;

describe("parseIngredientText", () => {
  it("finds every ingredient in the canonical example", () => {
    expect(ids("I have eggs, 3 tomatoes, some paneer and rice")).toEqual([
      "egg",
      "tomato",
      "paneer",
      "rice",
    ]);
  });

  it("reads quantities before the ingredient", () => {
    const text = "4 eggs some paneer 2 tomatoes onion";
    expect(qtyOf(text, "egg")).toBe("4");
    expect(qtyOf(text, "paneer")).toBe("some");
    expect(qtyOf(text, "tomato")).toBe("2");
    expect(qtyOf(text, "onion")).toBeUndefined();
  });

  it("handles plural forms (tomatoes, potatoes) and es-plurals", () => {
    expect(ids("tomatoes and potatoes")).toEqual(["tomato", "potato"]);
  });

  it("understands 'half a lemon' and '3 cloves garlic'", () => {
    expect(qtyOf("half a lemon", "lemon")).toBe("½");
    expect(qtyOf("3 cloves garlic", "garlic")).toBe("3");
  });

  it("longest alias wins and spans don't double-count", () => {
    expect(ids("spring onion and onion")).toEqual(["spring-onion", "onion"]);
    expect(ids("cottage cheese")).toEqual(["paneer"]);
  });

  it("matches Telugu and Hindi aliases users actually type", () => {
    expect(ids("ulli tamata biyyam")).toEqual(["onion", "tomato", "rice"]);
    expect(ids("anda")).toEqual(["egg"]);
    expect(ids("paneer aur dahi")).toEqual(["paneer", "curd"]); // hinglish filler ignored
  });

  it("maps chicken to chicken-breast", () => {
    expect(ids("chicken")).toEqual(["chicken-breast"]);
  });

  it("ignores unknown words instead of inventing ingredients", () => {
    expect(parseIngredientText("hello world")).toEqual([]);
    expect(parseIngredientText("12345")).toEqual([]);
    expect(parseIngredientText("")).toEqual([]);
  });

  it("is idempotent on repeated ingredients (no duplicates)", () => {
    expect(ids("eggs and more eggs")).toEqual(["egg"]);
  });
});

describe("bestMatch", () => {
  it("returns a single catalog ingredient for the add-row search", () => {
    expect(bestMatch("some palak")?.id).toBe("spinach");
    expect(bestMatch("eggs")?.id).toBe("egg");
    expect(bestMatch("zzz")).toBeUndefined();
  });
});
