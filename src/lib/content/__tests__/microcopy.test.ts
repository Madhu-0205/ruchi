// ─────────────────────────────────────────────────────────────
// RUCHI — micro-copy tests (personality engine extension)
// ─────────────────────────────────────────────────────────────
// Locks the small-moments voice contract: occasional (not every tap),
// deterministic rotation, no immediate repetition, real-kitchen-size
// keying for the reveal, and no fabricated claims in any line.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from "vitest";

const storage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => {
    storage[k] = v;
  },
  removeItem: (k: string) => {
    delete storage[k];
  },
  clear: () => {
    for (const k of Object.keys(storage)) delete storage[k];
  },
});

import { ingredientQuip, findMyMealRevealLine, shouldQuip } from "@/lib/content/microcopy";
import { resetContentMemoryForTests } from "@/lib/content/memory";

describe("ingredient quips — occasional by design", () => {
  beforeEach(resetContentMemoryForTests);

  it("stays silent except roughly every 3rd tap", () => {
    const withQuip = [2, 5, 8];
    const silent = [0, 1, 3, 4, 6, 7, 9];
    for (const t of withQuip) expect(shouldQuip(t)).toBe(true);
    for (const t of silent) expect(shouldQuip(t)).toBe(false);
  });

  it("returns null on silent taps and unknown ingredients", () => {
    expect(ingredientQuip("egg", 1)).toBeNull(); // silent tap
    expect(ingredientQuip("dragon-fruit", 2)).toBeNull(); // no voice for it
  });

  it("rotates per ingredient without immediate repetition", () => {
    const egg = [2, 5, 8, 11, 14].map((t) => ingredientQuip("egg", t));
    expect(egg[0]).toBeTruthy();
    for (let i = 1; i < egg.length; i++) {
      expect(egg[i]).not.toBe(egg[i - 1]);
    }
  });

  it("no quip claims a user fact (count, streak, favorite)", () => {
    for (const t of [2, 5, 8, 11, 14, 17, 20]) {
      const q = ingredientQuip("egg", t) ?? ingredientQuip("onion", t) ?? ingredientQuip("paneer", t);
      if (q) {
        expect(q).not.toMatch(/\d+/);
        expect(q).not.toMatch(/favorite|always|you usually/i);
      }
    }
  });
});

describe("Find My Meal reveal lines", () => {
  beforeEach(resetContentMemoryForTests);

  it("full kitchen gets full-kitchen energy", () => {
    const line = findMyMealRevealLine(6, 1);
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/working with what/i);
  });

  it("sparse kitchen gets encouraging energy", () => {
    const line = findMyMealRevealLine(1, 1);
    expect(["Let's see what we can do…", "Working with what's here."]).toContain(line);
  });

  it("consecutive uses never repeat the same line", () => {
    const seen: string[] = [];
    for (let u = 1; u <= 5; u++) {
      const line = findMyMealRevealLine(6, u);
      expect(line).not.toBe(seen[seen.length - 1]);
      seen.push(line);
    }
  });
});
