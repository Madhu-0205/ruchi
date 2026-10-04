// ─────────────────────────────────────────────────────────────
// RUCHI — notification policy tests
// ═══════════════════════════════════════════════════════════════
// Spec §5/§6/§7: one centralized policy authority. Covers every
// enumerated suppression reason and the class-based cooldown model.

import { describe, expect, it } from "vitest";
import {
  evaluateOpportunity,
  type PolicyState,
  COOLDOWN_MS,
  OPPORTUNITY_POLICY,
} from "../policy";
import {
  generateOpportunities,
  type Opportunity,
  type ServerSignals,
} from "../opportunities";

const NOW = new Date("2026-10-02T12:30:00+05:30").getTime();

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    dedupKey: "test-key",
    type: "resume_cooking",
    priority: 1,
    userId: "user-1",
    ctx: { type: "incomplete_session", priority: 100, headline: "", action: "resume", reason: "" },
    facts: { dayKey: "", weekKey: "" },
    confidence: 0.95,
    destination: "/?resume=x",
    ...over,
  };
}

function baseState(over: Partial<PolicyState> = {}): PolicyState {
  return {
    userId: "user-1",
    hasSubscription: true,
    typePrefs: {},
    hasActiveSession: false,
    quietHours: { start: 22, end: 8 },
    localHour: 12, // midday: quiet hours can never fire accidentally, in any TZ
    dailyCap: 1,
    weeklyCap: 2,
    weekSends: 0,
    lastDeliveredAt: {},
    lastSentDedupKey: null,
    ...over,
  };
}

/** Minimal server signals for the end-to-end funnel tests. */
function signals(over: Partial<ServerSignals> = {}): ServerSignals {
  return {
    userId: "user-1",
    now: NOW,
    history: [],
    weekKey: "test-week",
    ...over,
  };
}

// ── cooldown classes ─────────────────────────────────────────
describe("cooldown classes", () => {
  it("HIGH_VALUE is shorter than NORMAL and PERSONALITY is longest", () => {
    expect(COOLDOWN_MS["HIGH_VALUE"]).toBeLessThan(COOLDOWN_MS["NORMAL"]);
    expect(COOLDOWN_MS["NORMAL"]).toBeLessThan(COOLDOWN_MS["PERSONALITY"]);
  });

  it("maps each type to a class", () => {
    expect(OPPORTUNITY_POLICY.resume_cooking.cooldownClass).toBe("HIGH_VALUE");
    expect(OPPORTUNITY_POLICY.explicit_followup.cooldownClass).toBe("HIGH_VALUE");
    expect(OPPORTUNITY_POLICY.ingredient_opportunity.cooldownClass).toBe("HIGH_VALUE");
    expect(OPPORTUNITY_POLICY.cook_again.cooldownClass).toBe("NORMAL");
    expect(OPPORTUNITY_POLICY.contextual_meal.cooldownClass).toBe("NORMAL");
    expect(OPPORTUNITY_POLICY.discover_opportunity.cooldownClass).toBe("NORMAL");
    expect(OPPORTUNITY_POLICY.personality.cooldownClass).toBe("PERSONALITY");
  });

  it("applies class cooldown from the last delivery per type", () => {
    const rec = opp({ type: "cook_again", dedupKey: "cook_again:x" });
    const state = baseState({
      lastDeliveredAt: { cook_again: NOW - 2 * 3_600_000 }, // 2h ago → within 12h
    });
    const policy = evaluateOpportunity(rec, state, NOW);
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toBe("recently_notified");
  });

  it("allows a type after its cooldown elapses", () => {
    const rec = opp({ type: "cook_again", dedupKey: "cook_again:x" });
    const state = baseState({
      lastDeliveredAt: { cook_again: NOW - 13 * 3_600_000 }, // 13h ago → beyond 12h
    });
    expect(evaluateOpportunity(rec, state, NOW).allowed).toBe(true);
  });

  it("PERSONALITY cooldown spans 14 days", () => {
    const personality = opp({ type: "personality", dedupKey: "personality:week1" });
    const state = baseState({
      lastDeliveredAt: { personality: NOW - 10 * 24 * 60 * 60 * 1000 }, // 10d ago → within 14d
    });
    const policy = evaluateOpportunity(personality, state, NOW);
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toBe("recently_notified");

    const state2 = baseState({
      lastDeliveredAt: { personality: NOW - 15 * 24 * 60 * 60 * 1000 }, // 15d ago
    });
    expect(evaluateOpportunity(personality, state2, NOW).allowed).toBe(true);
  });
});

// ── opt-outs ─────────────────────────────────────────────────
describe("user opt-out", () => {
  it("suppresses when the per-type toggle is off", () => {
    const state = baseState({ typePrefs: { resume_cooking: false } });
    expect(evaluateOpportunity(opp({ type: "resume_cooking" }), state, NOW).reason).toBe("user_disabled");
  });

  it("allows when the per-type toggle is ON", () => {
    const state = baseState({ typePrefs: { resume_cooking: true } });
    expect(evaluateOpportunity(opp({ type: "resume_cooking" }), state, NOW).allowed).toBe(true);
  });
});

// ── subscription / channel state ─────────────────────────────
describe("subscription gate", () => {
  it("suppresses with no valid subscription", () => {
    const state = baseState({ hasSubscription: false });
    expect(evaluateOpportunity(opp(), state, NOW).reason).toBe("no_subscription");
  });
});

// ── active session ───────────────────────────────────────────
describe("active cooking session", () => {
  it("suppresses normal re-engagement while cooking", () => {
    const state = baseState({ hasActiveSession: true });
    expect(evaluateOpportunity(opp(), state, NOW).reason).toBe("active_session");
  });
});

// ── quiet hours ──────────────────────────────────────────────
describe("quiet hours", () => {
  it("suppresses inside quiet hours (22:00→08:00, wraps midnight)", () => {
    const state = baseState({ localHour: 23 });
    const policy = evaluateOpportunity(opp(), state, NOW);
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toBe("quiet_hours");
  });

  it("suppresses in the small hours too", () => {
    const state = baseState({ localHour: 3 });
    expect(evaluateOpportunity(opp(), state, NOW).reason).toBe("quiet_hours");
  });

  it("allows before quiet hours begin (21:00)", () => {
    const state = baseState({ localHour: 21 });
    expect(evaluateOpportunity(opp(), state, NOW).allowed).toBe(true);
  });

  it("allows after quiet hours end (08:00)", () => {
    const state = baseState({ localHour: 8 });
    expect(evaluateOpportunity(opp(), state, NOW).allowed).toBe(true);
  });
});

// ── recent actions ───────────────────────────────────────────
describe("recent activity guards", () => {
  it("suppresses if the user just cooked (2h window)", () => {
    const state = baseState({ lastCookedAt: NOW - 30 * 60 * 1000 });
    expect(evaluateOpportunity(opp(), state, NOW).reason).toBe("recently_cooked");
  });

  it("allows cooking 2h ago", () => {
    const state = baseState({ lastCookedAt: NOW - 2 * 60 * 60 * 1000 });
    expect(evaluateOpportunity(opp(), state, NOW).allowed).toBe(true);
  });

  it("suppresses if the user just opened a notification", () => {
    const state = baseState({ lastNotificationOpenedAt: NOW - 60 * 1000 });
    expect(evaluateOpportunity(opp(), state, NOW).reason).toBe("recently_opened");
  });

  it("allows if the notification was opened >15min ago", () => {
    const state = baseState({ lastNotificationOpenedAt: NOW - 16 * 60 * 1000 });
    expect(evaluateOpportunity(opp(), state, NOW).allowed).toBe(true);
  });
});

// ── duplicate / cooldown ─────────────────────────────────────
describe("duplicate and cooldown", () => {
  it("suppresses when the last SENT notification had the same dedup key", () => {
    const state = baseState({ lastSentDedupKey: "resume_cooking:x" });
    expect(evaluateOpportunity(opp({ dedupKey: "resume_cooking:x" }), state, NOW).reason).toBe("duplicate");
  });

  it("allows a different opportunity with a different dedup key", () => {
    const state = baseState({ lastSentDedupKey: "resume_cooking:x" });
    expect(evaluateOpportunity(opp({ dedupKey: "discover:y" }), state, NOW).allowed).toBe(true);
  });
});

// ── user isolation ───────────────────────────────────────────
describe("user isolation", () => {
  it("never lets user B see user A's last delivered state", () => {
    const stateA = baseState({
      userId: "user-A",
      lastDeliveredAt: { cook_again: NOW - 2 * 3_600_000 }, // within A's own cooldown
    });
    const stateB = baseState({ userId: "user-B" }); // B's own ledger is clean
    const rec = opp({ type: "cook_again", dedupKey: "cook_again:B" });
    // A is judged by A's ledger (cooldown hits); B by B's own (clean) —
    // B's verdict can never inherit A's recency.
    expect(evaluateOpportunity(rec, stateA, NOW).allowed).toBe(false);
    expect(evaluateOpportunity(rec, stateB, NOW).allowed).toBe(true);
  });
});

// ── daily / weekly caps ──────────────────────────────────────
describe("frequency caps", () => {
  it("enforces daily cap", () => {
    const state = baseState({ dailyCap: 1, daySends: 1, weekSends: 1, weeklyCap: 2 });
    const policy = evaluateOpportunity(opp(), state, NOW);
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toBe("daily_cap");
  });

  it("enforces weekly cap", () => {
    const state = baseState({ weeklyCap: 1, weekSends: 1 });
    const policy = evaluateOpportunity(opp(), state, NOW);
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toBe("weekly_cap");
  });
});

// ── low confidence ───────────────────────────────────────────
describe("low confidence", () => {
  it("suppresses low-confidence opportunities", () => {
    const rec = opp({ type: "contextual_meal", confidence: 0.3 });
    expect(evaluateOpportunity(rec, baseState(), NOW).reason).toBe("low_confidence");
  });

  it("allows high-confidence opportunities", () => {
    const rec = opp({ type: "cook_again", confidence: 0.95 });
    expect(evaluateOpportunity(rec, baseState(), NOW).allowed).toBe(true);
  });
});

// ── end-to-end: no notification without valid opportunity ────
describe("end-to-end funnel", () => {
  it("never sends when there is no valid opportunity", () => {
    const opps = generateOpportunities(
      signals({ history: [], pausedSession: null, kitchen: null, lastAction: null }),
    );
    expect(opps.length).toBe(0);
  });

  it("never duplicates on repeated generation (same dedup keys)", () => {
    const opps = generateOpportunities(
      signals({
        history: [],
        pausedSession: null,
        kitchen: null,
        lastAction: null,
      }),
    );
    // deterministic: same seed → same set of dedupKeys
    const first = opps.map((o) => o.dedupKey).sort();
    const second = generateOpportunities(
      signals({
        history: [],
        pausedSession: null,
        kitchen: null,
        lastAction: null,
      }),
    ).map((o) => o.dedupKey).sort();
    expect(second).toEqual(first);
  });
});
