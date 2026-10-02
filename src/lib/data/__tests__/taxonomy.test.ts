// Discover taxonomy: every on-screen category must be a real, stocked,
// deterministic shelf. An empty or token category would be worse than none.

import { describe, expect, it } from "vitest";
import { computeCostPerServing, computeNutrition } from "@/lib/engine/nutrition";
import {
  DISCOVER_CATEGORIES,
  MIN_CATEGORY_RECIPES,
  discoverCategories,
  discoverCategoryById,
  understockedCategoryIds,
} from "@/lib/data/taxonomy";
import { RECIPES } from "@/lib/data/recipes";

describe("discover taxonomy", () => {
  it("declares unique category ids", () => {
    const ids = DISCOVER_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only ships categories the catalog can actually stock", () => {
    // Spec §19: never an empty or token category. Whatever is understocked
    // must be excluded from the resolved list — and today's catalog should
    // stock every declared shelf, keeping the rule honest rather than dead.
    const resolved = discoverCategories();
    const stocked = new Set(resolved.map((c) => c.id));
    for (const c of DISCOVER_CATEGORIES) {
      const n = RECIPES.filter((r) => c.matches(r)).length;
      if (n >= MIN_CATEGORY_RECIPES) expect(stocked.has(c.id), c.id).toBe(true);
      else expect(stocked.has(c.id), `${c.id} understocked (${n})`).toBe(false);
    }
    expect(understockedCategoryIds()).toEqual(
      DISCOVER_CATEGORIES.filter(
        (c) => RECIPES.filter((r) => c.matches(r)).length < MIN_CATEGORY_RECIPES,
      ).map((c) => c.id),
    );
  });

  it("membership is deterministic and pure", () => {
    const a = discoverCategories().map((c) => [c.id, c.recipes.map((r) => r.id)]);
    const b = discoverCategories().map((c) => [c.id, c.recipes.map((r) => r.id)]);
    expect(a).toEqual(b);
  });

  it("counts and membership agree with the raw predicates", () => {
    for (const c of discoverCategories()) {
      const declared = DISCOVER_CATEGORIES.find((d) => d.id === c.id)!;
      const expected = RECIPES.filter((r) => declared.matches(r));
      expect(c.recipes.length).toBe(expected.length);
      expect(new Set(c.recipes.map((r) => r.id))).toEqual(new Set(expected.map((r) => r.id)));
    }
  });

  it("ordering is deterministic and matches the declared order", () => {
    for (const c of discoverCategories()) {
      if (c.order === "time") {
        for (let i = 1; i < c.recipes.length; i++) {
          expect(c.recipes[i - 1]!.timeMin).toBeLessThanOrEqual(c.recipes[i]!.timeMin);
        }
      }
      if (c.order === "protein") {
        for (let i = 1; i < c.recipes.length; i++) {
          expect(
            computeNutrition(c.recipes[i - 1]!, 1).protein,
          ).toBeGreaterThanOrEqual(computeNutrition(c.recipes[i]!, 1).protein);
        }
      }
      if (c.order === "cost") {
        for (let i = 1; i < c.recipes.length; i++) {
          expect(
            computeCostPerServing(c.recipes[i - 1]!, 1),
          ).toBeLessThanOrEqual(computeCostPerServing(c.recipes[i]!, 1));
        }
      }
    }
  });

  it("covers the four discovery groups with the mood picks first", () => {
    const groups = new Set(discoverCategories().map((c) => c.group));
    expect([...groups].sort()).toEqual(["ingredient", "meal", "mood", "style"].sort());
    expect(discoverCategories()[0]!.id).toBe("quick-easy");
  });

  it("resolves by id and rejects unknown ids", () => {
    expect(discoverCategoryById("high-protein")?.label).toBe("High Protein");
    expect(discoverCategoryById("does-not-exist")).toBeUndefined();
  });

  it("no two shelves in the SAME group are label-duplicates of each other", () => {
    // Cross-axis overlap is natural (chai is quick AND a drink; a budget
    // dish can be beginner-friendly) — but two chips in one group answering
    // with the identical shelf is UI clutter, not IA.
    const resolved = discoverCategories();
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        if (resolved[i]!.group !== resolved[j]!.group) continue;
        const a = new Set(resolved[i]!.recipes.map((r) => r.id));
        const b = new Set(resolved[j]!.recipes.map((r) => r.id));
        const overlap = [...a].filter((id) => b.has(id)).length / Math.min(a.size, b.size);
        // Identical shelves under two labels would be UI clutter, not IA.
        expect(overlap, `${resolved[i]!.id} vs ${resolved[j]!.id}`).toBeLessThan(1);
      }
    }
  });
});
