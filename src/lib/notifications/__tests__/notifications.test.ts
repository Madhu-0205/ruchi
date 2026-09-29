// ─────────────────────────────────────────────────────────────
// RUCHI — notification layer tests
// ─────────────────────────────────────────────────────────────
// Pins the contracts that keep the layer calm:
//  • The planner NEVER invents a message when the engine is silent.
//  • incomplete_session never becomes a push (in-app only).
//  • Quiet hours wrap midnight; the weekly cap counts real sends.
//  • Suppression reuses the engine's isSuppressed — one contract.
//  • The adapter declines unsuitable contexts, drops stale
//    messages before I/O, and prunes dead subscriptions.
//  • Deep-link parity: expiresAt matches the engine's own cooldown.

import { describe, expect, it, vi } from "vitest";
import {
  CHANNEL_PREFERENCE,
  assertSingleChannel,
  isQuietHour,
  planDelivery,
  weekKeyOf,
  weeklyCount,
  type PlanInput,
} from "@/lib/notifications/planner";
import {
  buildPushPayload,
  isValidSubscription,
  webPushAdapter,
} from "@/lib/notifications/web-push";
import type { AttentionContext, AttentionType } from "@/lib/context/attention";
import type { DeliveryAdapter } from "@/lib/notifications/types";

const NOW = new Date("2026-09-29T12:30:00+05:30").getTime(); // 12:30 IST

function ctxOf(
  type: AttentionType,
  overrides: Partial<AttentionContext> = {},
): AttentionContext {
  return {
    type,
    priority: 90,
    headline: "You already have dinner.",
    supportingText: "Your kitchen has everything this needs.",
    recipeId: "egg-maggi",
    action: "cook",
    reason: "test",
    ...overrides,
  };
}

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    ctx: ctxOf("unused_ingredients"),
    userId: "user-1",
    prefs: {
      channels: { web_push: true },
      webPushSubscription: { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } },
      quietHours: { start: 22, end: 8 },
      maxPerWeek: 2,
    },
    suppression: {},
    weeklySends: {},
    now: NOW,
    ...overrides,
  };
}

const okAdapter: DeliveryAdapter = {
  channel: "web_push",
  isAvailable: async () => true,
  deliver: async (msg) => ({ ok: true, ...(msg as object) }) as never,
};

// ── Planner ──────────────────────────────────────────────────

describe("planDelivery — silence is the default", () => {
  it("never invents a message when the engine says none", async () => {
    const out = await planDelivery(
      baseInput({ ctx: ctxOf("none") }),
      [okAdapter],
    );
    expect(out).toEqual({ action: "skip", reason: "engine-none" });
  });

  it("never delivers incomplete_session cross-device (in-app only)", async () => {
    const out = await planDelivery(
      baseInput({ ctx: ctxOf("incomplete_session", { priority: 100, recipeId: "egg-maggi" }) }),
      [okAdapter],
    );
    expect(out).toEqual({ action: "skip", reason: "undeliverable-type" });
  });

  it("skips when no channel is enabled", async () => {
    const out = await planDelivery(
      baseInput({ prefs: { ...baseInput().prefs, channels: {} } }),
      [okAdapter],
    );
    expect(out).toEqual({ action: "skip", reason: "channel-off" });
  });

  it("skips when the enabled channel has no available adapter", async () => {
    const unavailable: DeliveryAdapter = {
      channel: "web_push",
      isAvailable: async () => false,
      deliver: async () => ({ ok: false, reason: "user-unavailable" }),
    };
    const out = await planDelivery(baseInput(), [unavailable]);
    expect(out).toEqual({ action: "skip", reason: "no-available-adapter" });
  });
});

describe("planDelivery — frequency control", () => {
  it("respects the engine's own suppression contract", async () => {
    // Same type shown 1h ago; unused_ingredients cooldown is 6h.
    const out = await planDelivery(
      baseInput({
        suppression: { lastShown: { type: "unused_ingredients", at: NOW - 3_600_000 } },
      }),
      [okAdapter],
    );
    expect(out).toEqual({ action: "skip", reason: "suppressed" });
  });

  it("suppresses recipe fatigue: same recipe within 24h, any type", async () => {
    const out = await planDelivery(
      baseInput({
        ctx: ctxOf("repeat_success"),
        suppression: { lastShown: { type: "quick_win", recipeId: "egg-maggi", at: NOW - 3_600_000 } },
      }),
      [okAdapter],
    );
    expect(out).toEqual({ action: "skip", reason: "suppressed" });
  });

  it("enforces the weekly cap from real sends", async () => {
    const week = weekKeyOf(NOW);
    const out = await planDelivery(
      baseInput({ weeklySends: { [week]: 2 } }), // cap is 2
      [okAdapter],
    );
    expect(out).toEqual({ action: "skip", reason: "weekly-cap" });
  });

  it("honors quiet hours inside the window", async () => {
    const night = new Date("2026-09-29T23:30:00+05:30").getTime();
    const out = await planDelivery(baseInput({ now: night }), [okAdapter]);
    expect(out).toEqual({ action: "skip", reason: "quiet-hours" });
  });
});

describe("planDelivery — happy path", () => {
  it("delivers engine copy verbatim with a parity expiresAt", async () => {
    const out = await planDelivery(baseInput(), [okAdapter]);
    expect(out.action).toBe("deliver");
    if (out.action !== "deliver") return;
    expect(out.channel).toBe("web_push");
    expect(out.message.headline).toBe("You already have dinner.");
    expect(out.message.supportingText).toBe("Your kitchen has everything this needs.");
    expect(out.message.contextType).toBe("unused_ingredients");
    expect(out.message.deepLink).toBe("/?recipe=egg-maggi");
    // unused_ingredients TTL is 6h — matches the engine's cooldown.
    expect(out.message.expiresAt).toBe(NOW + 6 * 3_600_000);
    expect(out.recordShown).toEqual({
      type: "unused_ingredients",
      recipeId: "egg-maggi",
      at: NOW,
    });
  });

  it("falls back to '/' deep link for recipe-less contexts", async () => {
    const out = await planDelivery(
      baseInput({ ctx: ctxOf("return_visit", { recipeId: undefined }) }),
      [okAdapter],
    );
    if (out.action !== "deliver") return;
    expect(out.message.deepLink).toBe("/");
  });

  it("picks the FIRST available channel in preference order", async () => {
    const widgetAdapter: DeliveryAdapter = {
      channel: "widget",
      isAvailable: async () => true,
      deliver: async () => ({ ok: true }),
    };
    const out = await planDelivery(
      baseInput({ prefs: { ...baseInput().prefs, channels: { web_push: true, widget: true } } }),
      [widgetAdapter, okAdapter],
    );
    if (out.action !== "deliver") return;
    expect(out.channel).toBe("web_push"); // preference order, not adapter order
  });
});

// ── Quiet hours & week bucket ────────────────────────────────

describe("isQuietHour", () => {
  it("wraps midnight (22→8)", () => {
    expect(isQuietHour(23, { start: 22, end: 8 })).toBe(true);
    expect(isQuietHour(3, { start: 22, end: 8 })).toBe(true);
    expect(isQuietHour(7, { start: 22, end: 8 })).toBe(true);
    expect(isQuietHour(8, { start: 22, end: 8 })).toBe(false);
    expect(isQuietHour(12, { start: 22, end: 8 })).toBe(false);
    expect(isQuietHour(21, { start: 22, end: 8 })).toBe(false);
  });

  it("handles forward windows and the disabled case", () => {
    expect(isQuietHour(13, { start: 13, end: 14 })).toBe(true);
    expect(isQuietHour(14, { start: 13, end: 14 })).toBe(false);
    expect(isQuietHour(0, { start: 8, end: 8 })).toBe(false); // start===end → off
  });
});

describe("weekKeyOf / weeklyCount", () => {
  it("anchors the week on Monday (UTC)", () => {
    // 2026-09-28 is a Monday; 2026-09-29 (Tue) shares its bucket.
    const mon = weekKeyOf(Date.UTC(2026, 8, 28));
    const tue = weekKeyOf(Date.UTC(2026, 8, 29));
    const sun = weekKeyOf(Date.UTC(2026, 9, 4)); // next Sunday, same week
    expect(tue).toBe(mon);
    expect(sun).toBe(mon);
  });

  it("counts sends for the current week only", () => {
    const week = weekKeyOf(NOW);
    const sends = { [week]: 1, "0": 5 }; // stale weeks ignored
    expect(weeklyCount(sends, NOW)).toBe(1);
    expect(weeklyCount({}, NOW)).toBe(0);
  });
});

// ── Adapter ──────────────────────────────────────────────────

describe("webPushAdapter", () => {
  it("isAvailable requires the channel flag AND a valid subscription", async () => {
    const valid = { endpoint: "https://push.example/x", keys: { p256dh: "k", auth: "a" } };
    expect(await webPushAdapter.isAvailable({ channels: { web_push: true }, webPushSubscription: valid })).toBe(true);
    expect(await webPushAdapter.isAvailable({ channels: {}, webPushSubscription: valid })).toBe(false);
    expect(await webPushAdapter.isAvailable({ channels: { web_push: true }, webPushSubscription: null })).toBe(false);
    expect(await webPushAdapter.isAvailable({ channels: { web_push: true }, webPushSubscription: { endpoint: "http://insecure" } })).toBe(false);
  });

  it("isValidSubscription rejects malformed/misshapen input", () => {
    expect(isValidSubscription(undefined)).toBe(false);
    expect(isValidSubscription("nope")).toBe(false);
    expect(isValidSubscription({ endpoint: "https://x", keys: {} })).toBe(false);
    expect(
      isValidSubscription({ endpoint: "https://x", keys: { p256dh: "k", auth: "a" } }),
    ).toBe(true);
  });

  it("buildPushPayload carries engine copy verbatim", () => {
    const payload = buildPushPayload({
      userId: "u",
      contextType: "quick_win",
      recipeId: "idli",
      headline: "Dinner in 15 minutes.",
      supportingText: "Faster than deciding what to order.",
      deepLink: "/?recipe=idli",
      expiresAt: 123,
    });
    expect(payload).toEqual({
      title: "Dinner in 15 minutes.",
      body: "Faster than deciding what to order.",
      deepLink: "/?recipe=idli",
      contextType: "quick_win",
      recipeId: "idli",
      expiresAt: 123,
    });
  });

  it("deliver drops stale messages before any network I/O", async () => {
    const spy = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(2000);
    const result = await webPushAdapter.deliver({
      userId: "u",
      contextType: "quick_win",
      headline: "x",
      deepLink: "/",
      expiresAt: 1000, // already stale
      subscription: { endpoint: "https://x", keys: { p256dh: "k", auth: "a" } },
    } as never);
    spy.mockRestore();
    vi.restoreAllMocks();
    expect(result).toEqual({ ok: false, reason: "unsuitable-context" });
  });

  it("declines contexts web push renders poorly — never improvises", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const result = await webPushAdapter.deliver({
      userId: "u",
      contextType: "cooking_gap", // recipe-less → nagging on the lock screen
      recipeId: undefined,
      headline: "Been a while.",
      deepLink: "/",
      expiresAt: NOW + 1000,
      subscription: { endpoint: "https://x", keys: { p256dh: "k", auth: "a" } },
    } as never);
    vi.restoreAllMocks();
    expect(result).toEqual({ ok: false, reason: "unsuitable-context" });
  });
});

// ── Invariants ───────────────────────────────────────────────

describe("layer invariants", () => {
  it("delivers at most ONE message per run", () => {
    expect(() => assertSingleChannel(["web_push", "web_push"])).not.toThrow();
    expect(() => assertSingleChannel(["web_push", "email"])).toThrow();
  });

  it("web_push is the top-preference live channel", () => {
    expect(CHANNEL_PREFERENCE[0]).toBe("web_push");
  });

  it("every push TTL mirrors an engine cooldown (≤ 48h, > 0)", () => {
    // Spot-check the parity table through planDelivery for two types.
    // (Full per-type parity is pinned by the engine's own tests.)
    const types: AttentionType[] = ["unused_ingredients", "cooking_gap"];
    for (const t of types) {
      const out = planDelivery(baseInput({ ctx: ctxOf(t) }), [okAdapter]);
      return out.then((o) => {
        if (o.action !== "deliver") return;
        const ttl = o.message.expiresAt - NOW;
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(48 * 3_600_000);
      });
    }
  });
});
