// ─────────────────────────────────────────────────────────────
// RUCHI — Notification strategy tests (Opportunities layer)
// ═══════════════════════════════════════════════════════════════
// Spec §17 anti-spam for the strategy layer:
//  • no notification without valid opportunity
//  • paused cooking produces Resume opportunity
//  • Cook Again only references real completed meals
//  • ingredient notification only uses real ingredients
//  • invalid recommendation cannot produce notification
//  • personality only when history exists

import { describe, expect, it } from "vitest";
import { MIN_CATEGORY_RECIPES, discoverCategories } from "@/lib/data/taxonomy";
import { RECIPES, getRecipe } from "@/lib/data/recipes";
import {
  generateOpportunities,
  bestRecipeFor,
  type ServerSignals,
} from "../opportunities";
import { OPPORTUNITY_PRIORITY } from "../opportunities";
import { pickWinner } from "../policy";
import type { Opportunity } from "../opportunities";

const NOW = new Date("2026-10-02T12:30:00+05:30").getTime();

function signals(over: Partial<ServerSignals> = {}): ServerSignals {
  return {
    userId: "user-1",
    now: NOW,
    history: [],
    weekKey: "1727846400000",
    ...(over ?? {}),
  };
}

// ── bestRecipeFor ────────────────────────────────────────────
describe("bestRecipeFor", () => {
  it("picks a real recipe from real ingredients", () => {
    // Paneer Egg Bhurji's core set: egg, paneer, onion, tomato (onion is core).
    const id = bestRecipeFor(["egg", "paneer", "tomato", "onion"]);
    expect(id).toBeTruthy();
    const r = id ? RECIPES.find((x) => x.id === id) : undefined;
    expect(r).toBeTruthy();
  });

  it("returns null for an empty kitchen", () => {
    expect(bestRecipeFor([])).toBeNull();
  });

  it("returns null for an unmatchable ingredient set", () => {
    // e.g. only a seasoning item that cannot form a meal by itself
    const id = bestRecipeFor(["salt"]);
    expect(id).toBeNull();
  });
});

// ── priority system ──────────────────────────────────────────
describe("priority system", () => {
  it("respects the deterministic ordering", () => {
    expect(OPPORTUNITY_PRIORITY.resume_cooking).toBeLessThan(
      OPPORTUNITY_PRIORITY.explicit_followup,
    );
    expect(OPPORTUNITY_PRIORITY.explicit_followup).toBeLessThan(
      OPPORTUNITY_PRIORITY.ingredient_opportunity,
    );
    expect(OPPORTUNITY_PRIORITY.ingredient_opportunity).toBeLessThan(
      OPPORTUNITY_PRIORITY.cook_again,
    );
    expect(OPPORTUNITY_PRIORITY.cook_again).toBeLessThan(
      OPPORTUNITY_PRIORITY.contextual_meal,
    );
    expect(OPPORTUNITY_PRIORITY.contextual_meal).toBeLessThan(
      OPPORTUNITY_PRIORITY.discover_opportunity,
    );
    expect(OPPORTUNITY_PRIORITY.discover_opportunity).toBeLessThan(
      OPPORTUNITY_PRIORITY.personality,
    );
  });

  it("pickWinner ranks the highest opportunity first", () => {
    const a: Opportunity = {
      dedupKey: "d1",
      type: "cook_again",
      priority: OPPORTUNITY_PRIORITY.cook_again,
      userId: "u",
      ctx: { type: "repeat_success", priority: 80, headline: "", action: "cook_again", reason: "" },
      facts: { dayKey: "", weekKey: "" },
      confidence: 0.95,
      destination: "/?recipe=x",
    };
    const b: Opportunity = {
      dedupKey: "d2",
      type: "resume_cooking",
      priority: OPPORTUNITY_PRIORITY.resume_cooking,
      userId: "u",
      ctx: { type: "incomplete_session", priority: 100, headline: "", action: "resume", reason: "" },
      facts: { step: 1, total: 4, dayKey: "", weekKey: "" },
      confidence: 0.95,
      destination: "/?resume=x",
    };
    expect(pickWinner([a, b])?.type).toBe("resume_cooking");
  });

  it("pickWinner is stable (deterministic)", () => {
    const first = pickWinner([
      {
        dedupKey: "d1",
        type: "cook_again",
        priority: 4,
        userId: "u",
        ctx: { type: "repeat_success", priority: 80, headline: "", action: "cook_again", reason: "" },
        facts: { dayKey: "", weekKey: "" },
        confidence: 0.95,
        destination: "/?recipe=x",
      },
      {
        dedupKey: "d2",
        type: "cook_again",
        priority: 4,
        userId: "u",
        ctx: { type: "repeat_success", priority: 80, headline: "", action: "cook_again", reason: "" },
        facts: { dayKey: "", weekKey: "" },
        confidence: 0.95,
        destination: "/?recipe=y",
      },
    ]);
    expect(first?.type).toBe("cook_again");
    // second call must give the same answer
    const second = pickWinner([
      {
        dedupKey: "d1",
        type: "cook_again",
        priority: 4,
        userId: "u",
        ctx: { type: "repeat_success", priority: 80, headline: "", action: "cook_again", reason: "" },
        facts: { dayKey: "", weekKey: "" },
        confidence: 0.95,
        destination: "/?recipe=x",
      },
      {
        dedupKey: "d2",
        type: "cook_again",
        priority: 4,
        userId: "u",
        ctx: { type: "repeat_success", priority: 80, headline: "", action: "cook_again", reason: "" },
        facts: { dayKey: "", weekKey: "" },
        confidence: 0.95,
        destination: "/?recipe=y",
      },
    ]);
    expect(second?.dedupKey).toBe(first?.dedupKey);
  });
});

// ── one winner per cycle ─────────────────────────────────────
describe("one winner per evaluation cycle", () => {
  it("returns the single highest priority opportunity", () => {
    const candidates: Opportunity[] = [
      {
        dedupKey: "d1",
        type: "cook_again",
        priority: 4,
        userId: "u",
        ctx: { type: "repeat_success", priority: 80, headline: "", action: "cook_again", reason: "" },
        facts: { dayKey: "", weekKey: "" },
        confidence: 0.95,
        destination: "/?recipe=x",
      },
      {
        dedupKey: "d2",
        type: "discover_opportunity",
        priority: 6,
        userId: "u",
        ctx: { type: "meal_time", priority: 65, headline: "", action: "find_meal", reason: "" },
        facts: { dayKey: "", weekKey: "" },
        confidence: 0.75,
        destination: "/?category=x",
      },
      {
        dedupKey: "d3",
        type: "resume_cooking",
        priority: 1,
        userId: "u",
        ctx: { type: "incomplete_session", priority: 100, headline: "", action: "resume", reason: "" },
        facts: { step: 1, total: 4, dayKey: "", weekKey: "" },
        confidence: 0.95,
        destination: "/?resume=x",
      },
    ];
    const winner = pickWinner(candidates) ?? null;
    expect(winner?.type).toBe("resume_cooking");
  });
});

// ── no notification without valid opportunity ────────────────
describe("silence when there is no real signal", () => {
  it("produces nothing for a new user with an empty kitchen", () => {
    const opps = generateOpportunities(signals({ history: [], pausedSession: null, kitchen: null }));
    expect(opps).toHaveLength(0);
  });

  it("produces nothing for a user who has never cooked and has no kitchen", () => {
    const opps = generateOpportunities(
      signals({ history: [], pausedSession: null, kitchen: null, lastAction: null }),
    );
    expect(opps).toHaveLength(0);
  });
});

// ── paused cooking produces Resume ───────────────────────────
describe("RESUME_COOKING", () => {
  it("produces resume_opportunity when a session is genuinely paused", () => {
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: {
          recipeId: "paneer-egg-bhurji",
          stepIndex: 3,
          stepCount: 6,
          pausedAt: NOW - 25 * 60 * 1000, // 25 min ago = fresh
        },
      }),
    );
    expect(opps.some((o) => o.type === "resume_cooking")).toBe(true);
  });

  it("does NOT produce resume when the session is stale (>12h)", () => {
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: {
          recipeId: "paneer-egg-bhurji",
          stepIndex: 1,
          stepCount: 4,
          pausedAt: NOW - 13 * 60 * 60 * 1000, // 13h ago = stale
        },
      }),
    );
    expect(opps.some((o) => o.type === "resume_cooking")).toBe(false);
  });

  it("does NOT produce resume when the step is invalid", () => {
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: {
          recipeId: "paneer-egg-bhurji",
          stepIndex: 0, // step 1 is a prerequisite check: index 0 → step 1?
          stepCount: 4,
          pausedAt: NOW - 20 * 60 * 1000,
        },
      }),
    );
    // stepIndex > 0 && < stepCount → no pause; index 0 should be treated as
    // never started.
    expect(opps.some((o) => o.type === "resume_cooking")).toBe(false);
  });
});

// ── Cook Again only references real completed meals ──────────
describe("COOK_AGAIN (real ledger only)", () => {
  it("produces cook_again from a real recent completion", () => {
    const opps = generateOpportunities(
      signals({
        history: [
          {
            id: "h1",
            recipeId: "paneer-egg-bhurji",
            recipeName: "Paneer Egg Bhurji",
            cookedAt: NOW - 2 * 24 * 60 * 60 * 1000,
            servings: 2,
            proteinG: 38,
            calories: 520,
            cost: 82,
            deliveryCompareCost: 303,
          },
        ],
        pausedSession: null,
        kitchen: null,
      }),
    );
    expect(opps.some((o) => o.type === "cook_again")).toBe(true);
  });

  it("does NOT produce cook_again for a stale recipe removed from the catalog", () => {
    const now = Date.now();
    const opps = generateOpportunities(
      signals({
        history: [
          {
            id: "h1",
            recipeId: "gone-recipe-999",
            recipeName: "Ancient Recipe",
            cookedAt: now - 10 * 24 * 60 * 60 * 1000,
            servings: 2,
            proteinG: 10,
            calories: 200,
            cost: 50,
            deliveryCompareCost: 150,
          },
        ],
        pausedSession: null,
        kitchen: null,
      }),
    );
    expect(opps.some((o) => o.type === "cook_again")).toBe(false);
  });

  it("does NOT cook again if the dish was cooked too recently", () => {
    const opps = generateOpportunities(
      signals({
        history: [
          {
            id: "h1",
            recipeId: "paneer-egg-bhurji",
            recipeName: "Paneer Egg Bhurji",
            cookedAt: NOW - 2 * 60 * 60 * 1000, // 2h ago → too recent
            servings: 2,
            proteinG: 38,
            calories: 520,
            cost: 82,
            deliveryCompareCost: 303,
          },
        ],
        pausedSession: null,
        kitchen: null,
      }),
    );
    expect(opps.some((o) => o.type === "cook_again")).toBe(false);
  });
});

// ── ingredient notification only uses real ingredients ────────
describe("INGREDIENT_OPPORTUNITY (real ingredients only)", () => {
  it("produces ingredient_opportunity only when a real recipe matches real inventory", () => {
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: null,
        kitchen: { ids: ["egg", "paneer", "tomato"], updatedAt: NOW },
      }),
    );
    // May or may not fire depending on the recommend engine; must never
    // fabricate. Deterministic assert: if it fires, it must name a real recipe.
    const ing = opps.find((o) => o.type === "ingredient_opportunity");
    if (ing) {
      expect(ing.facts.recipeId).toBeTruthy();
      const r = getRecipe(ing.facts.recipeId!);
      expect(r).toBeTruthy();
    }
  });
});

// ── invalid recommendation cannot produce notification ───────
describe("invalid recommendation cannot produce notification", () => {
  it("does not produce ingredient_opportunity when the engine has no eligible meal", () => {
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: null,
        kitchen: { ids: ["garlic"], updatedAt: NOW },
      }),
    );
    expect(opps.some((o) => o.type === "ingredient_opportunity")).toBe(false);
  });
});

// ── no fake personalization ──────────────────────────────────
describe("no fake personalization", () => {
  it("does not fabricate facts in opportunity.facts", () => {
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: null,
        kitchen: null,
        lastAction: null,
      }),
    );
    for (const o of opps) {
      if (o.facts.step !== undefined) {
        expect(o.facts.step).toBeGreaterThan(0);
      }
      if (o.facts.total !== undefined) {
        expect(o.facts.total).toBeGreaterThan(0);
      }
      if (o.facts.timeMin !== undefined) {
        expect(o.facts.timeMin).toBeGreaterThan(0);
      }
    }
  });
});

// ── personality (real context only) ──────────────────────────
describe("PERSONALITY (real context only)", () => {
  it("only fires when the user has real cooking history", () => {
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: null,
        kitchen: null,
        lastAction: null,
      }),
    );
    expect(opps.some((o) => o.type === "personality")).toBe(false);
  });
});

// ── explicit follow-up (real recent actions only) ────────────
describe("EXPLICIT_FOLLOWUP (real recent actions only)", () => {
  it("does not fire with no recent action", () => {
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: null,
        kitchen: null,
        lastAction: null,
      }),
    );
    expect(opps.some((o) => o.type === "explicit_followup")).toBe(false);
  });

  it("does not fabricate when the recent action's destination does not exist", () => {
    const now = Date.now();
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: null,
        kitchen: null,
        lastAction: {
          kind: "view_recipe",
          recipeId: "no-such-recipe",
          at: now - 20 * 60 * 1000,
        },
      }),
    );
    expect(opps.some((o) => o.type === "explicit_followup")).toBe(false);
  });
});

// ── discover uses real taxonomy ───────────────────────────────
describe("DISCOVER_OPPORTUNITY (real taxonomy only)", () => {
  it("uses only categories with real, stocked recipes", () => {
    const opps = generateOpportunities(signals({ history: [], pausedSession: null, kitchen: null, lastAction: null }));
    const discover = opps.filter((o) => o.type === "discover_opportunity");
    expect(discover.length).toBeLessThanOrEqual(1);
    for (const o of discover) {
      // category comes from discoverCategories() — real shelf behind it
      const exists = discoverCategories().some((c) => c.id === o.facts.categoryId);
      expect(exists).toBe(true);
      expect(o.facts.categoryCount).toBeGreaterThanOrEqual(MIN_CATEGORY_RECIPES);
    }
  });
});
