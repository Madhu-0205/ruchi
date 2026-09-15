// ─────────────────────────────────────────────────────────────
// RUCHI — nudge engine
// ─────────────────────────────────────────────────────────────
// Builds contextual, non-spammy messages from real user state.
// MVP: shown in-app (Profile / Home banner). The same payloads are what
// a push-notification worker would consume later — see buildNudges().
// Rules: max 1 active nudge per kind, contextual only, never guilt.

import type { NudgeEvent, NudgeKind } from "@/lib/types";

interface NudgeInput {
  now: number;
  inventoryNames: string[]; // display names of kitchen items
  expiringSoonNames: string[]; // items expiring within 2 days
  hasCookedBefore: boolean;
  mealsThisWeek: number;
  savedThisWeek: number;
  lastCookedAt?: number;
  lastNudges: Record<NudgeKind, number>; // kind → last shown epoch ms
}

export function buildNudges(input: NudgeInput): NudgeEvent[] {
  const out: NudgeEvent[] = [];
  const h = new Date(input.now).getHours();
  const cooldown = 1000 * 60 * 60 * 20; // 20h between same-kind nudges

  const can = (k: NudgeKind) => (input.lastNudges[k] ?? 0) + cooldown < input.now;

  const push = (
    kind: NudgeKind,
    title: string,
    body: string,
    ctaRoute?: string,
  ) => {
    if (!can(kind)) return;
    out.push({
      id: `${kind}-${input.now}`,
      kind,
      title,
      body,
      ctaRoute,
      createdAt: input.now,
      read: false,
    });
  };

  // Evening dinner nudge — the flagship "delivery interception" moment.
  if (h >= 18 && h <= 21 && input.inventoryNames.length >= 3) {
    push(
      "evening-dinner",
      "Dinner is already in your kitchen.",
      "15 minutes. A few rupees. Real protein. RUCHI will tell you exactly what to do.",
      "/",
    );
  }

  // Morning ingredient nudge.
  if (h >= 6 && h <= 10 && input.inventoryNames.includes("Eggs")) {
    push(
      "morning-ingredient",
      "You've got eggs waiting. Breakfast?",
      "A masala omelette is 8 minutes away.",
      "/",
    );
  }

  // Expiry nudge — gentle, useful, not preachy.
  if (input.expiringSoonNames.length > 0) {
    push(
      "expiry",
      "Those tomatoes aren't getting younger. 👀",
      `${input.expiringSoonNames.slice(0, 2).join(" and ")} expire soon. Here are meals that use them.`,
      "/",
    );
  }

  // Habit streak — only celebrate, never shame.
  if (input.mealsThisWeek >= 3) {
    push(
      "habit",
      `${input.mealsThisWeek} home-cooked meals this week.`,
      "Not bad. 🔥 Keep the streak alive tonight.",
      "/profile",
    );
  }

  // Savings celebration after a cook.
  if (input.hasCookedBefore && input.savedThisWeek > 0 && h >= 17 && h <= 22) {
    push(
      "after-cook",
      `You saved ₹${Math.round(input.savedThisWeek)} this week.`,
      "That's real money that didn't go to a delivery app. 👏",
      "/profile",
    );
  }

  // Comeback nudge after 3+ days away.
  if (
    input.lastCookedAt &&
    input.now - input.lastCookedAt > 1000 * 60 * 60 * 24 * 3
  ) {
    push(
      "comeback",
      "Your kitchen missed you.",
      "One quick meal tonight and the streak is back on. We'll handle the thinking.",
      "/",
    );
  }

  return out;
}

/** Deterministic weekly summary line for the Profile screen. */
export function weeklySummaryLine(meals: number): string {
  if (meals === 0) return "No home-cooked meals yet this week. The kitchen is neutral ground.";
  if (meals === 1) return "One meal. A start. The pan remembers.";
  if (meals <= 3) return `${meals} meals this week. The habit is forming.`;
  return `${meals} meals this week. You're basically a person who cooks.`;
}
