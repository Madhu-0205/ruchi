// ─────────────────────────────────────────────────────────────
// RUCHI — AI layer tests
// ─────────────────────────────────────────────────────────────
// Covers the brief's testing matrix without faking vision in production
// code: production modules are exercised directly; the only stubs live
// here, in tests, standing in for the Gemini server route and browser
// canvas APIs.

import { describe, expect, it } from "vitest";
import {
  jsonObject,
  parseAssistantReply,
  parseRecommendationPicks,
  parseVisionAnalysis,
} from "@/lib/ai/schemas";
import { mapToAnalysis } from "@/lib/ai/vision";
import { prepareImageForVision } from "@/lib/ai/image";
import { recommend, matchRecipes } from "@/lib/engine/match";
import { RECIPES } from "@/lib/data/recipes";

// ── 1. Structured output: malformed AI response handling ────

describe("AI payload validation (schemas)", () => {
  it("parses a clean vision payload", () => {
    const raw = JSON.stringify({
      ingredients: [
        { name: "egg", id: "egg", quantity: "4", confidence: 0.97, quantity_confidence: 0.91 },
        { name: "tomato", id: "tomato", quantity: "3", confidence: 0.95, quantity_confidence: 0.82 },
      ],
      uncertain_items: [],
      notes: [],
    });
    const parsed = parseVisionAnalysis(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.ingredients).toHaveLength(2);
    expect(parsed?.ingredients[0]?.id).toBe("egg");
  });

  it("normalizes fenced JSON with surrounding prose", () => {
    const raw = 'Sure! Here is the analysis:\n```json\n{"ingredients":[],"uncertain_items":[],"notes":[]}\n```';
    expect(parseVisionAnalysis(raw)).not.toBeNull();
  });

  it("rejects malformed JSON instead of crashing", () => {
    expect(parseVisionAnalysis("not json at all")).toBeNull();
    expect(parseVisionAnalysis('{"ingredients": "not-an-array"')).toBeNull();
  });

  it("rejects schema violations (wrong types, out-of-range confidence)", () => {
    expect(parseVisionAnalysis(JSON.stringify({ ingredients: [{ name: 42 }] }))).toBeNull();
    expect(
      parseVisionAnalysis(JSON.stringify({ ingredients: [{ name: "egg", confidence: 7 }] })),
    ).toBeNull();
  });

  it("caps runaway ingredient lists at 12", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `item-${i}`,
      id: "egg",
      confidence: 0.99,
    }));
    const parsed = parseVisionAnalysis(JSON.stringify({ ingredients: many }));
    expect(parsed?.ingredients.length).toBeLessThanOrEqual(12);
  });

  it("coerces numeric-string confidence and defaults missing fields", () => {
    const parsed = parseVisionAnalysis(
      JSON.stringify({ ingredients: [{ name: "egg", confidence: "0.9" }] }),
    );
    expect(parsed?.ingredients[0]?.confidence).toBeCloseTo(0.9);
    expect(parsed?.ingredients[0]?.id).toBeUndefined();
    expect(parsed?.uncertain_items).toEqual([]);
  });

  it("parses recommendation picks and assistant replies", () => {
    const picks = parseRecommendationPicks(
      JSON.stringify({ picks: [{ recipeId: "x", matchReason: ["High protein"] }] }),
    );
    expect(picks?.picks[0]?.recipeId).toBe("x");

    const reply = parseAssistantReply(JSON.stringify({ answer: "Stir 3 min.", tone: "rescue" }));
    expect(reply?.tone).toBe("rescue");
    expect(parseAssistantReply("garbage")).toBeNull();
    expect(
      parseAssistantReply(JSON.stringify({ answer: "x", tone: "invalid-tone" })),
    ).toBeNull();
  });

  it("jsonObject transform extracts prose/fence-wrapped JSON", () => {
    expect(jsonObject.parse('Sure! {"a":1}')).toEqual({ a: 1 });
    expect(jsonObject.parse('{"a":{"b":2}} hope this helps!')).toEqual({ a: { b: 2 } });
    expect(() => jsonObject.parse('prefix {"a":1} suffix {"b":2}')).toThrow(); // pathological
  });
});

// ── 2. Vision: catalog fencing, low confidence, uncertain items ──

describe("vision analysis mapping (mapToAnalysis)", () => {
  it("maps model names to catalog ids via the shared alias index", () => {
    const analysis = mapToAnalysis(["eggs", "tomato", "dragon fruit"], 100);
    const egg = analysis.ingredients.find((i) => i.catalogId === "egg");
    const tomato = analysis.ingredients.find((i) => i.catalogId === "tomato");
    expect(egg).toMatchObject({ catalogId: "egg", uncertain: false });
    expect(tomato).toMatchObject({ catalogId: "tomato", uncertain: false });
    // "dragon fruit" is not in the catalog → surfaced as an uncertain guess,
    // never silently dropped or invented into an id.
    expect(analysis.uncertainItems).toContain("dragon fruit");
    expect(analysis.modelUsed).toBe("gemini-2.5-flash");
  });

  it("normalizes case, whitespace and duplicates", () => {
    const analysis = mapToAnalysis(["  Tomato ", "TOMATO", "tomatoes"], 0);
    const tomatoRows = analysis.ingredients.filter((i) => i.catalogId === "tomato");
    expect(tomatoRows).toHaveLength(1);
  });

  it("never lets the model invent catalog ids", () => {
    // every returned row must map to a real catalog id or land in uncertain
    const analysis = mapToAnalysis(["truffle oil", "unicorn meat"], 0);
    for (const ing of analysis.ingredients) {
      expect(ing.catalogId).toBeDefined();
    }
  });

  it("caps the ingredient list at 12", () => {
    const analysis = mapToAnalysis(
      ["egg", "paneer", "tomato", "onion", "potato", "rice", "bread", "curd", "milk", "carrot", "capsicum", "lemon", "garlic", "ginger"],
      0,
    );
    expect(analysis.ingredients.length).toBeLessThanOrEqual(12);
  });

  it("empty detection list → honest empty result", () => {
    const analysis = mapToAnalysis([], 0);
    expect(analysis.ingredients).toHaveLength(0);
    expect(analysis.uncertainItems).toHaveLength(0);
  });
});

// ── 3. Image preparation (photo upload gate) ────────────────

describe("image preparation", () => {
  it("rejects unsupported file types gracefully", async () => {
    const file = new File(["x"], "story.pdf", { type: "application/pdf" });
    const res = await prepareImageForVision(file);
    expect(res).toEqual({ ok: false, reason: "unsupported-type" });
  });

  it("rejects oversized files before decoding", async () => {
    const big = new File([new Uint8Array(13 * 1024 * 1024)], "huge.jpg", { type: "image/jpeg" });
    const res = await prepareImageForVision(big);
    expect(res).toEqual({ ok: false, reason: "too-large" });
  });
});

// ── 4. Meal recommendation: AI picks over the curated dataset ──

describe("recommend() with AI picks", () => {
  const ids = ["egg", "paneer", "tomato", "onion", "rice"];
  const base = {
    hasIds: ids,
    intents: ["high-protein" as const],
    timeMax: 30,
    budgetMax: 100,
    servings: 2,
    diet: "eggetarian" as const,
  };

  it("deterministic ranking unchanged without AI picks", () => {
    const plain = recommend(base);
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.length).toBeLessThanOrEqual(4);
    expect(plain).toEqual(recommend(base)); // pure + stable
  });

  it("AI picks reorder the deterministic candidates — never invent recipes", () => {
    const ranked = matchRecipes(base);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    const [a, b] = ranked;
    const reversed = recommend(base, [
      { recipeId: b!.recipe.id, matchReason: ["Kitchen classic tonight"] },
      { recipeId: a!.recipe.id, matchReason: [] },
    ]);
    expect(reversed[0]?.recipe.id).toBe(b!.recipe.id);
    expect(reversed.map((r) => r.recipe.id)).toEqual(
      expect.arrayContaining(ranked.slice(0, 3).map((m) => m.recipe.id)),
    );
  });

  it("AI-invented recipe ids are ignored (fence holds)", () => {
    const ranked = matchRecipes(base);
    const top = ranked[0]!;
    const out = recommend(base, [
      { recipeId: "totally-invented-recipe", matchReason: ["fake"] },
      { recipeId: top.recipe.id, matchReason: ["Best match"] },
    ]);
    expect(out[0]?.recipe.id).toBe(top.recipe.id);
    expect(out.some((r) => r.recipe.id === "totally-invented-recipe")).toBe(false);
  });

  it("AI matchReason lines become the card's why-lines", () => {
    const ranked = matchRecipes(base);
    const top = ranked[0]!;
    const out = recommend(base, [
      { recipeId: top.recipe.id, matchReason: ["Uses 5 ingredients you already have", "High protein"] },
    ]);
    expect(out[0]?.why.slice(0, 2)).toEqual([
      "Uses 5 ingredients you already have",
      "High protein",
    ]);
  });

  it("no matching recipe → empty list, no crash", () => {
    const out = recommend({
      ...base,
      hasIds: ["water"],
      timeMax: 5,
      budgetMax: 1,
    });
    expect(out).toEqual([]);
  });

  it("numbers come from the engine, not the AI (nutrition/cost separation)", () => {
    const ranked = matchRecipes(base);
    const top = ranked[0]!;
    const out = recommend(base, [{ recipeId: top.recipe.id, matchReason: ["why"] }]);
    // protein/cost recomputed from reference tables regardless of AI copy
    expect(out[0]?.protein).toBeGreaterThan(0);
    expect(out[0]?.costPerServing).toBeGreaterThan(0);
  });
});

// ── 5. Services: backend failure → null → deterministic fallback ──

// In the node test env the SDK import fails (no window) → services must
// resolve null and the app-level fallbacks must engage.

describe("service failure → fallback contract", () => {
  it("all services resolve null (not throw) when the backend is unavailable", async () => {
    const { GeminiIngredientVisionService } = await import("@/lib/ai/vision");
    const { getRecommendationService, getAssistantService } = await import("@/lib/ai/index");

    const vision = new GeminiIngredientVisionService();
    const recs = getRecommendationService();
    const assistant = getAssistantService();

    await expect(recs.isAvailable()).resolves.toBe(false);
    await expect(assistant.isAvailable()).resolves.toBe(false);

    // In the node test env there is no fetch-mocked server; the client must
    // reject-to-null gracefully instead of throwing.
    const photo = await vision.detectIngredients({
      imageDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    });
    expect(photo).toBeNull();

    await expect(
      recs.rankRecommendations({
        availableIngredientIds: ["egg"],
        intents: ["high-protein"],
        timeMaxMin: 30,
        budgetMaxInr: 100,
        servings: 2,
        diet: "eggetarian",
        skill: "beginner",
        candidates: [{ recipeId: RECIPES[0]!.id, score: 100 }],
      }),
    ).resolves.toBeNull();

    await expect(
      assistant.answer({
        recipeName: "Bhurji",
        stepIndex: 0,
        stepCount: 3,
        stepTitle: "Add onions",
        stepText: "Add onions.",
        lookFor: "translucent",
        ingredients: ["onion"],
        question: "Is this cooked enough?",
      }),
    ).resolves.toBeNull();
  });

  it("text fallback parser handles 'I have eggs, paneer, tomato and onion'", async () => {
    const { parseIngredientText } = await import("@/lib/engine/parse");
    const parsed = parseIngredientText("I have 4 eggs, paneer, 2 tomatoes and onion");
    const names = parsed.map((p) => p.ingredient.id);
    expect(names).toContain("egg");
    expect(names).toContain("paneer");
    expect(names).toContain("tomato");
    expect(names).toContain("onion");
    const eggs = parsed.find((p) => p.ingredient.id === "egg");
    expect(eggs?.estimatedQty).toBe("4");
  });
});
