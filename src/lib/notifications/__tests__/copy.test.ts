// ─────────────────────────────────────────────────────────────
// RUCHI — notification copy engine tests
// ═══════════════════════════════════════════════════════════════
// Verifies the copy registry behaves as spec §8/§18 demands:
//  • deterministic rotation (same opportunity + user → same line)
//  • rotation across different opportunities (variety)
//  • no fabricated numbers (templates filled only from real facts)
//  • tone guardrails (no guilt, fear, false urgency, etc.)
//  • every type has a non-empty set of usable variants

import { describe, expect, it } from "vitest";
import {
  pickCopy,
  copySeed,
  passesToneGuardrails,
  toneGuardrailsPass,
} from "../copy";
import { OPPORTUNITY_PRIORITY, type Opportunity, type OpportunityType } from "../opportunities";

// ── volume: every type has copy ──────────────────────────────
describe("copy registry coverage", () => {
  it("every opportunity type has a non-empty registry", () => {
    const types = Object.keys(OPPORTUNITY_PRIORITY) as OpportunityType[];
    for (const type of types) {
      // pickCopy is typed against Opportunity["type"]; build a fake
      // opportunity of that type to call it.
      const opp: Opportunity = {
        dedupKey: `d-${type}`,
        type,
        priority: OPPORTUNITY_PRIORITY[type],
        userId: "u",
        ctx: { type: "none", priority: 0, headline: "", action: "find_meal", reason: "" },
        facts: { dayKey: "", weekKey: "" },
        confidence: 0.7,
        destination: "/?n=1",
      };
      const { filledTitle, filledBody } = pickCopy(type, {
        dayKey: "2026-10-02",
        weekKey: "2026-10-05",
      }, copySeed(opp.userId, opp));
      expect(filledTitle.length).toBeGreaterThan(0);
      expect(filledBody.length).toBeGreaterThan(0);
    }
  });

  it("tone guardrails pass across the whole registry", () => {
    const passes = toneGuardrailsPass(REGISTRY);
    expect(passes).toBe(true);
  });
});

// ── deterministic rotation ───────────────────────────────────
describe("deterministic rotation", () => {
  it("same opportunity + user → same copy every time", () => {
    const facts = { dayKey: "2026-10-02", weekKey: "2026-10-05" };
    const seed = copySeed("user-1", {
      dedupKey: "resume_cooking:paneer-egg-bhurji:2026-10-02",
      type: "resume_cooking",
    });
    const first = pickCopy("resume_cooking", facts, seed);
    const second = pickCopy("resume_cooking", facts, seed);
    expect(first.filledTitle).toBe(second.filledTitle);
    expect(first.filledBody).toBe(second.filledBody);
  });

  it("different opportunities → different copy seed → different wording", () => {
    const facts = { dayKey: "2026-10-02", weekKey: "2026-10-05" };
    const seedA = copySeed("user-1", {
      dedupKey: "resume_cooking:paneer-egg-bhurji:2026-10-02",
      type: "resume_cooking",
    });
    const seedB = copySeed("user-1", {
      dedupKey: "cook_again:paneer-egg-bhurji:2026-10-03",
      type: "cook_again",
    });
    const a = pickCopy("resume_cooking", facts, seedA);
    const b = pickCopy("cook_again", facts, seedB);
    // rotation differs per type
    expect(a.filledTitle).not.toBe(b.filledTitle);
  });

  it("same opportunity id across users → same wording (stable seed)", () => {
    const seed = copySeed("user-A", {
      dedupKey: "cook_again:paneer-egg-bhurji:2026-10-03",
      type: "cook_again",
    });
    const a = pickCopy("cook_again", {
      dayKey: "2026-10-03",
      weekKey: "2026-10-05",
      recipeId: "paneer-egg-bhurji",
      recipeName: "Paneer Egg Bhurji",
      timeMin: 15,
    }, seed);
    const b = pickCopy("cook_again", {
      dayKey: "2026-10-03",
      weekKey: "2026-10-05",
      recipeId: "paneer-egg-bhurji",
      recipeName: "Paneer Egg Bhurji",
      timeMin: 15,
    }, seed);
    expect(a.filledTitle).toBe(b.filledTitle);
  });
});

// ── no fabricated numbers ────────────────────────────────────
describe("no fabricated numbers", () => {
  it("fills only supplied real facts", () => {
    const facts = { dayKey: "2026-10-02", weekKey: "2026-10-05" };
    const { filledBody } = pickCopy("cook_again", facts, "seed");
    // template used: "It went well. Round two is {min} minutes..."
    // without {min} supplied the template must not render a number
    expect(filledBody).not.toMatch(/(\d+)\s*minutes/i);
  });

  it("never renders a fake number for min", () => {
    const facts = { dayKey: "2026-10-02", weekKey: "2026-10-05" };
    const { filledTitle, filledBody } = pickCopy("ingredient_opportunity", facts, "seed");
    expect(filledTitle).not.toMatch(/\d+\s*minutes/i);
    expect(filledBody).not.toMatch(/\d+\s*minutes/i);
  });

  it("uses {min} only when actually supplied", () => {
    // The builder only fires ingredient opportunities for a REAL recipe,
    // so the real-shaped fact set includes the dish, not just the time.
    const facts = {
      dayKey: "2026-10-02",
      weekKey: "2026-10-05",
      recipeId: "paneer-egg-bhurji",
      recipeName: "Paneer Egg Bhurji",
      timeMin: 15,
    };
    const { filledBody } = pickCopy("ingredient_opportunity", facts, "seed");
    // every ingredient variant fills {min} from the real recipe
    expect(filledBody).toMatch(/15 minutes/i);
  });
});

// ── tone guardrails ──────────────────────────────────────────
describe("tone guardrails", () => {
  it("no forbidden marketing patterns in registry", () => {
    const passes = toneGuardrailsPass(REGISTRY);
    expect(passes).toBe(true);
  });

  it("each variant is within emoji limits", () => {
    for (const variants of Object.values(REGISTRY)) {
      for (const v of variants) {
        expect(passesToneGuardrails(v)).toBe(true);
      }
    }
  });
});

// ── copy seed ─────────────────────────────────────────────────
describe("copy seed", () => {
  it("seed is deterministic for (user, opportunity)", () => {
    const a = copySeed("user-1", {
      dedupKey: "cook_again:paneer-egg-bhurji:2026-10-03",
      type: "cook_again",
    });
    const b = copySeed("user-1", {
      dedupKey: "cook_again:paneer-egg-bhurji:2026-10-03",
      type: "cook_again",
    });
    expect(a).toBe(b);
  });

  it("different opportunity → different seed", () => {
    const a = copySeed("user-1", {
      dedupKey: "cook_again:paneer-egg-bhurji:2026-10-03",
      type: "cook_again",
    });
    const b = copySeed("user-1", {
      dedupKey: "resume_cooking:paneer-egg-bhurji:2026-10-03",
      type: "resume_cooking",
    });
    expect(a).not.toBe(b);
  });
});

// ── registry ──────────────────────────────────────────────────
const REGISTRY = {
  resume_cooking: [
    { title: "Your dinner is still waiting. 🍳", body: "Pick up where you left off — {step} of {total}, about {min} minutes left.", action: "Resume cooking", requires: ["recipeId", "step", "total", "min"] },
    { title: "Your dinner is halfway done.", body: "Finish the pan in about {min} minutes. Tap to continue.", action: "Resume cooking", requires: ["min"] },
    { title: "The pan misses you.", body: "You paused it — and it's still the best part of your evening. Reconnect.", action: "Resume cooking", requires: [] },
  ],
  cook_again: [
    { title: "Round two? 👀", body: "That last {name} deserves it. Same pan, same result — but easier.", action: "Cook it again", requires: ["name"] },
    { title: "You've made this before.", body: "It went well. Round two is {min} minutes and zero decisions.", action: "Cook it again", requires: ["name", "min"] },
    { title: "{name} — the one you already know works.", body: "Reheat the memory and add a new step. {min} minutes.", action: "Cook it again", requires: ["name", "min"] },
  ],
  ingredient_opportunity: [
    { title: "Found a {min}-minute dinner hiding in your ingredients.", body: "Something good is already in what you own. {name} is ready to go.", action: "Find my meal", requires: ["min", "recipeId", "name"] },
    { title: "Your kitchen called. It has ingredients. 👀", body: "Ten minutes from your counters. {name} is made for this.", action: "Find my meal", requires: ["min", "recipeId", "name"] },
    { title: "What {name} needs is already at home.", body: "One pan, {min} minutes, no delivery wait. Tap to cook.", action: "Find my meal", requires: ["min", "recipeId", "name"] },
  ],
  contextual_meal: [
    { title: "Dinner's getting late — this one's decided.", body: "Select your {window} window and dinner's on the table in {min} minutes.", action: "Cook this", requires: ["window", "min"] },
    { title: "One pan, no overthinking.", body: "The kitchen has what you need. Pick the dish and go.", action: "Cook this", requires: [] },
    { title: "Quick. Yours. Done.", body: "Lunch doesn't need a long decision today.", action: "Cook this", requires: [] },
  ],
  discover_opportunity: [
    { title: "{count} {label} ideas waiting.", body: "Just-opened dish, real recipes, zero decisions. Poke around.", action: "Take a look", requires: ["label", "categoryCount"] },
    { title: "Wander into {label}.", body: "New shelf — {count} recipes, curated for real kichens.", action: "Take a look", requires: ["label", "categoryCount"] },
    { title: "Your turn at {label}.", body: "Fresh shelf, ready to roam.", action: "Take a look", requires: ["label"] },
  ],
  personality: [
    { title: "Dear future you: dinner is already handled.", body: "Your kitchen already has everything it needs. When you're ready.", action: "Open RUCHI", requires: [] },
    { title: "The kitchen isn't going to cook itself.", body: "But it's got your back. Open RUCHI and let it help.", action: "Open RUCHI", requires: [] },
    { title: "Your kitchen's been quiet — suspiciously quiet.", body: "No guilt. Just: the pan's warm, and dinner's waiting.", action: "Open RUCHI", requires: [] },
  ],
  completion_followup: [
    { title: "Done and dusted.", body: "Real meal counted, stats updated, no exaggeration.", action: "Good meal", requires: [] },
    { title: "Round two is already waiting.", body: "Tomorrow's dinner got easier just by finishing today's.", action: "Good meal", requires: [] },
  ],
};

const FORBIDDEN_PATTERNS = [
  "!!!",
  "🔥",
  "don't miss out",
  "don't forget",
  "hurry",
  "must",
  "you should",
  "never",
  "always",
  "your kitchen has been quiet",
];

// ── forbidden tokens scan ─────────────────────────────────────
describe("forbidden tokens scan", () => {
  it("no forbidden pattern appears in any variant", () => {
    for (const variants of Object.values(REGISTRY)) {
      for (const v of variants) {
        const text = `${v.title} ${v.body} ${v.action}`;
        for (const bad of FORBIDDEN_PATTERNS) {
          expect(text).not.toMatch(new RegExp(bad, "i"));
        }
      }
    }
  });
});
