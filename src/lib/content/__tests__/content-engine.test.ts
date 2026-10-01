// ─────────────────────────────────────────────────────────────
// RUCHI — content engine tests (personality engine)
// ─────────────────────────────────────────────────────────────
// Locks the personality engine's contract: deterministic selection,
// session rotation (no immediate repetition), cooldowns, time-aware
// windows, real-context gating (first-time vs returning vs cook-again),
// and the absolute rule that content selection NEVER fabricates user
// data — every line is a factual observation, none claims a count,
// streak or preference.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from "vitest";

// A localStorage shim — memory persists within the module under test's
// cache, but each test resets via resetContentMemoryForTests.
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
// The memory module is loaded once; window check is satisfied by Node
// globals being present — no window stub needed since memory.ts checks
// typeof window for storage only via localStorage global.

import {
  pickContent,
  pickAndNote,
  buildContentContext,
  advanceSession,
  POOLS,
  type ContentContext,
} from "@/lib/content";
import { resetContentMemoryForTests } from "@/lib/content/memory";

const CTX_FIRST: ContentContext = {
  hour: 13,
  isFirstTime: true,
  hasHistory: false,
  cookedRecently: false,
  hasCookAgain: false,
};

const CTX_RETURNING: ContentContext = {
  hour: 13,
  isFirstTime: false,
  hasHistory: true,
  cookedRecently: true,
  hasCookAgain: true,
};

describe("deterministic selection", () => {
  beforeEach(resetContentMemoryForTests);

  it("same pool + context + session → identical pick (SSR/hydration safe)", () => {
    const a = pickContent("greetings", CTX_RETURNING);
    const b = pickContent("greetings", CTX_RETURNING);
    expect(a).not.toBeNull();
    expect(a!.item.id).toBe(b!.item.id);
  });

  it("pickAndNote twice in one session returns the same line", () => {
    const a = pickAndNote("thoughts", CTX_RETURNING);
    const b = pickAndNote("thoughts", CTX_RETURNING);
    expect(a!.item.id).toBe(b!.item.id);
  });

  it("picks are always from the requested pool (context-matched)", () => {
    // Context-gated pools need a matching context: firstTime ↔ first visit.
    const ctxFor = (pool: keyof typeof POOLS): ContentContext =>
      pool === "firstTime" ? CTX_FIRST : CTX_RETURNING;
    for (const pool of Object.keys(POOLS) as (keyof typeof POOLS)[]) {
      const pick = pickContent(pool, ctxFor(pool));
      expect(pick, `pool ${pool} returned null`).not.toBeNull();
      const ids = POOLS[pool].map((i) => i.id);
      expect(ids).toContain(pick!.item.id);
    }
  });
});

describe("session rotation — every open feels fresh", () => {
  beforeEach(resetContentMemoryForTests);

  it("consecutive sessions do not repeat the immediately-previous pick", () => {
    const picks: string[] = [];
    for (let s = 0; s < 6; s++) {
      const pick = pickAndNote("greetings", CTX_RETURNING);
      if (s > 0) {
        expect(pick!.item.id).not.toBe(picks[s - 1]);
      }
      picks.push(pick!.item.id);
      advanceSession();
    }
  });

  it("a session of picks shows meaningful variety across the pool", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 6; s++) {
      seen.add(pickAndNote("greetings", CTX_RETURNING)!.item.id);
      advanceSession();
    }
    // 6 sessions over 13 usable greetings must yield more than 3 lines.
    expect(seen.size).toBeGreaterThan(3);
  });

  it("thoughts and humor pools rotate without immediate repetition", () => {
    for (const pool of ["thoughts", "humor"] as const) {
      let prev: string | null = null;
      for (let s = 0; s < 5; s++) {
        const pick = pickAndNote(pool, CTX_RETURNING);
        expect(pick!.item.id).not.toBe(prev);
        prev = pick!.item.id;
        advanceSession();
      }
    }
  });
});

describe("cooldown behavior", () => {
  beforeEach(resetContentMemoryForTests);

  it("a shown item stays retired for its cooldown window", () => {
    const first = pickAndNote("completion", CTX_RETURNING)!.item;
    // completion pool has 5 items, default cooldown 4 → in sessions 2..4
    // (while cooldown still binds) the first pick cannot reappear.
    advanceSession();
    const second = pickAndNote("completion", CTX_RETURNING)!.item;
    expect(second.id).not.toBe(first.id);
    advanceSession();
    const third = pickAndNote("completion", CTX_RETURNING)!.item;
    expect(third.id).not.toBe(first.id);
    expect(third.id).not.toBe(second.id);
  });
});

describe("time-aware selection", () => {
  beforeEach(resetContentMemoryForTests);

  it("a morning context can pick the morning greeting; late night picks late-night", () => {
    const morning = pickContent("greetings", { ...CTX_RETURNING, hour: 8 });
    const late = pickContent("greetings", { ...CTX_RETURNING, hour: 23 });
    // Both windows have priority-7 items that outrank evergreens there.
    const morningIds = POOLS.greetings.filter((i) => i.hours?.[0] === 5).map((i) => i.id);
    const lateIds = POOLS.greetings.filter((i) => (i.hours?.[0] ?? -1) >= 22 || (i.hours?.[1] ?? -1) <= 5).map((i) => i.id);
    expect(morningIds).toContain(morning!.item.id);
    expect(lateIds).toContain(late!.item.id);
  });

  it("evergreen greetings remain available at any hour", () => {
    for (const hour of [0, 6, 13, 19, 23]) {
      const pick = pickContent("greetings", { ...CTX_RETURNING, hour });
      expect(pick).not.toBeNull();
    }
  });
});

describe("real-context gating — never fabricate user state", () => {
  beforeEach(resetContentMemoryForTests);

  it("first-time user NEVER receives returning-user or cook-again lines", () => {
    for (let s = 0; s < 6; s++) {
      const returning = pickContent("returning", CTX_FIRST);
      const again = pickContent("cookAgain", CTX_FIRST);
      expect(returning).toBeNull();
      expect(again).toBeNull();
      advanceSession();
    }
  });

  it("returning user NEVER receives first-time lines", () => {
    for (let s = 0; s < 6; s++) {
      const pick = pickContent("firstTime", CTX_RETURNING);
      expect(pick).toBeNull();
      advanceSession();
    }
  });

  it("buildContentContext derives first-time from an empty real history", () => {
    const ctx = buildContentContext({ hour: 9, historyLength: 0, now: Date.now() });
    expect(ctx.isFirstTime).toBe(true);
    expect(ctx.hasCookAgain).toBe(false);
    expect(ctx.cookedRecently).toBe(false);
  });

  it("buildContentContext marks cooked-recently only from a real recent completion", () => {
    const now = Date.now();
    const fresh = buildContentContext({
      hour: 9,
      historyLength: 3,
      lastCookedAt: now - 12 * 60 * 60 * 1000,
      now,
    });
    expect(fresh.cookedRecently).toBe(true);
    const stale = buildContentContext({
      hour: 9,
      historyLength: 3,
      lastCookedAt: now - 10 * 24 * 60 * 60 * 1000,
      now,
    });
    expect(stale.cookedRecently).toBe(false);
  });

  it("no content item claims a user count, streak, or preference", () => {
    const all = Object.values(POOLS).flat();
    for (const item of all) {
      // Numeric claims like "7 meals", "3 day streak", "your favorite" are
      // database statements — none may exist in curated voice.
      expect(item.text).not.toMatch(/\d+ (meals?|day|days|streak)/i);
      expect(item.text).not.toMatch(/favorite/i);
      expect(item.text).not.toMatch(/you('ve| have) cooked \d+/i);
      expect(item.text).not.toMatch(/₹\d/);
    }
  });
});

describe("fallbacks and content hygiene", () => {
  beforeEach(resetContentMemoryForTests);

  it("tone filtering falls back to the pool when the tone has no items", () => {
    const pick = pickContent("greetings", CTX_RETURNING, "wise");
    // 'wise' greetings exist (g-fix-the-day) — must pick within pool.
    expect(pick).not.toBeNull();
    const ids = POOLS.greetings.map((i) => i.id);
    expect(ids).toContain(pick!.item.id);
  });

  it("every content item has complete, valid metadata", () => {
    const seen = new Set<string>();
    for (const item of Object.values(POOLS).flat()) {
      expect(item.id).toBeTruthy();
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
      expect(item.text.length).toBeGreaterThan(3);
      expect(item.text.length).toBeLessThan(120);
      expect(item.tone).toBeTruthy();
      if (item.hours) {
        const [start, end] = item.hours;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start).toBeLessThanOrEqual(24);
        expect(end).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(24);
        expect(start).not.toBe(end);
      }
      if (item.cooldown !== undefined) expect(item.cooldown).toBeGreaterThan(0);
    }
  });

  it("every pool is non-empty and starts with a usable line", () => {
    for (const [name, items] of Object.entries(POOLS)) {
      expect(items.length, `pool ${name} empty`).toBeGreaterThan(0);
      expect(items[0]!.text).toBeTruthy();
    }
  });
});
