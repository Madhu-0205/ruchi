// Tests for the deterministic cooking-help fallback — the path users get
// when Puter AI is unavailable, declined, or times out. The copy must stay
// natural and beginner-friendly: no "Safety:" boilerplate, no empty
// answers, no invented facts. Everything routes to the curated help
// library or the recipe's own cues/substitutions.

import { describe, expect, it } from "vitest";
import { fallbackAnswer } from "@/lib/engine/help-fallback";
import { getRecipe } from "@/lib/data/recipes";
import { getHelp, HELP_LIBRARY } from "@/lib/data/help";

const recipe = getRecipe("egg-bhurji")!;
const step = recipe.steps[1]!; // a mid-cook step with a look-for cue

describe("fallbackAnswer — sanity", () => {
  it("never returns an empty answer", () => {
    const questions = [
      "How do I know it's ready?",
      "I added too much salt",
      "I burned it",
      "Why is this watery?",
      "I don't have this ingredient",
      "I don't have this utensil",
      "What does medium heat mean?",
      "Can I get more protein from this?",
      "Something completely unrelated",
      "",
    ];
    for (const q of questions) {
      const a = fallbackAnswer(q, recipe, step);
      expect(a, `question: "${q}"`).not.toBe("");
      expect(a, `question: "${q}"`).toBeTypeOf("string");
    }
  });

  it("every help-library answer it can emit is non-empty", () => {
    for (const [id, entry] of Object.entries(HELP_LIBRARY)) {
      expect(entry.answer.length, `help id: ${id}`).toBeGreaterThan(10);
    }
  });
});

describe("fallbackAnswer — doneness questions", () => {
  it("answers with the step's look-for cue, phrased naturally", () => {
    const a = fallbackAnswer("How do I know it's ready?", recipe, step);
    // The cue is the whole answer — no mechanical "For this step:" echo.
    expect(a).toBe(step.lookFor);
    // No spec-sheet boilerplate: the cue stands on its own.
    expect(a).not.toMatch(/safety:|for this step:/i);
  });

  it("matches 'done' and 'know' phrasings to the cue", () => {
    for (const q of ["Is it done?", "How do I know when to move on?"]) {
      const a = fallbackAnswer(q, recipe, step);
      expect(a).toContain(step.lookFor);
    }
  });
});

describe("fallbackAnswer — substitution questions", () => {
  it("uses the recipe's own substitution rules", () => {
    const a = fallbackAnswer("I don't have this ingredient", recipe, step);
    // egg-bhurji has a substitutions table — its messages must appear.
    for (const sub of recipe.substitutions) {
      expect(a).toContain(sub.message);
    }
  });

  it("single substitution reads as one natural sentence — no name prefix", () => {
    const oneSub = { ...recipe, substitutions: recipe.substitutions.slice(0, 1) };
    const a = fallbackAnswer("I don't have this ingredient", oneSub, step);
    expect(a).toBe(oneSub.substitutions[0]!.message);
    expect(a).not.toMatch(/^For /);
  });

  it("multiple substitutions are framed naturally, not echoed", () => {
    const many = { ...recipe, substitutions: [...recipe.substitutions, ...recipe.substitutions] };
    const a = fallbackAnswer("I don't have this ingredient", many, step);
    expect(a).toContain("Here's what works for");
    for (const sub of many.substitutions) expect(a).toContain(sub.message);
  });

  it("falls back to the curated general advice when the recipe has no swaps", () => {
    const noSubs = { ...recipe, substitutions: [] };
    const a = fallbackAnswer("Can I substitute something?", noSubs, step);
    expect(a.length).toBeGreaterThan(20);
    expect(a).toBe(getHelp("substitute")?.answer);
  });
});

describe("fallbackAnswer — curated rescue questions", () => {
  it("too-salty routes to the curated fix", () => {
    const a = fallbackAnswer("I added too much salt", recipe, step);
    expect(a).toBe(getHelp("fix-too-salty")?.answer);
  });

  it("burned routes to the curated fix", () => {
    const a = fallbackAnswer("I burned it", recipe, step);
    expect(a).toBe(getHelp("fix-burnt")?.answer);
  });

  it("watery routes to a curated fix (either variant)", () => {
    const a = fallbackAnswer("Why is this watery?", recipe, step);
    expect([getHelp("why-watery-curry")?.answer, getHelp("fix-watery")?.answer]).toContain(a);
  });

  it("utensil and heat questions route to curated answers", () => {
    expect(fallbackAnswer("I don't have this utensil", recipe, step)).toBe(
      getHelp("utensil-missing")?.answer,
    );
    expect(fallbackAnswer("What does medium heat mean?", recipe, step)).toBe(
      getHelp("medium-flame")?.answer,
    );
  });
});

describe("fallbackAnswer — step-specific help", () => {
  it("prefers the step's own curated help for unrelated questions", () => {
    if ((step.helpIds ?? []).length === 0) return; // recipe-dependent
    const a = fallbackAnswer("something unrelated", recipe, step);
    const firstHelp = getHelp(step.helpIds![0]!)?.answer;
    expect(a).toBe(firstHelp);
  });
});
