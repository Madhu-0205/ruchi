// ─────────────────────────────────────────────────────────────
// RUCHI — Guest-mode persistence (welcome-gate regression)
// ─────────────────────────────────────────────────────────────
// Bug: `guestMode` was missing from the persist partialize, so a guest
// who cooked a meal and reloaded landed back on the welcome gate while
// their history sat untouched in localStorage. The guest's session must
// survive a reload (Home shows their meal); the gate must still reappear
// on explicit sign-out (which clears the flag deliberately).
//
// Locked at three levels:
//  1. BEHAVIOR — re-importing the store module (a real rehydrate) after
//     enterGuestMode + logCookedMeal restores guestMode AND history, so
//     deriveAuthFlowState returns "unauthenticated-guest", never
//     "unauthenticated".
//  2. BEHAVIOR — after signOut, the same rehydrate yields guestMode
//     false → the welcome gate ("unauthenticated") is correct again.
//  3. SOURCE — the persist partialize persists guestMode (alongside
//     history), and the flow machine checks guestMode only after the
//     signed-in/confirmation states, so a real account always wins.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// zustand's persist middleware writes through localStorage on every
// setState; Node has none, so provide a Map-backed shim BEFORE the store
// module is evaluated. Nothing touches disk.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  (globalThis as { __mem?: unknown }).__mem = mem;
});

const mem = (globalThis as { __mem?: Map<string, string> }).__mem!;

// Auth + cloud layers must never run in these tests.
vi.mock("@/lib/auth/supabase-auth", () => ({
  currentUser: async () => null,
  onAuthChange: () => null,
  signIn: async () => ({ status: "signed-in", user: { id: "u1", email: "a@b.c", displayName: "A" } }),
  signUp: async () => ({ status: "signed-in", user: { id: "u1", email: "a@b.c", displayName: "A" } }),
  signOut: async () => {},
}));

vi.mock("@/lib/auth/supabase-data", () => ({
  fetchProfile: async () => ({ ok: true, data: null }),
  upsertProfile: async () => ({ ok: true, data: null }),
  fetchCompletedMeals: async () => ({ ok: true, data: [] }),
  insertCompletedMeals: async () => ({ ok: true, data: null }),
  recordStreakDay: async () => ({ ok: true, data: null }),
  recordCookingCompletion: async () => ({ ok: true, data: "recorded" }),
  fetchCookingStats: async () => ({ ok: true, data: null }),
  fetchRecentCookedMeals: async () => ({ ok: true, data: [] }),
  fetchNotificationPrefs: async () => ({ ok: true as const, data: null }),
  pushAttentionState: async () => ({ ok: true as const, data: null }),
  upsertNotificationChannels: async () => ({ ok: true as const, data: null }),
}));

const meal = {
  recipeId: "egg-maggi",
  recipeName: "Egg Maggi",
  servings: 1,
  proteinG: 16,
  calories: 672,
  cost: 35,
  deliveryCompareCost: 90,
};

/** Fresh module evaluation = exactly what a page reload does. */
async function rehydrateStore() {
  vi.resetModules();
  return import("@/lib/store");
}

beforeEach(() => {
  mem.clear();
  vi.resetModules();
});

describe("guest-mode persistence (behavior: real rehydrate)", () => {
  it("a guest who cooked and reloads lands in the app with their meal — never the welcome gate", async () => {
    const { useRuchi } = await import("@/lib/store");
    useRuchi.getState().enterGuestMode();
    useRuchi.getState().logCookedMeal({ ...meal });
    expect(useRuchi.getState().history).toHaveLength(1);

    // ── Reload: the persisted store rehydrates a fresh module instance,
    //    then the app boots the auth probe (same as the real startup path).
    const fresh = await rehydrateStore();
    fresh.initAuthListener();
    await vi.waitFor(() => expect(fresh.useRuchi.getState().authReady).toBe(true));
    const s = fresh.useRuchi.getState();
    expect(s.guestMode).toBe(true);
    expect(s.history).toHaveLength(1);
    expect(s.history[0]?.recipeName).toBe("Egg Maggi");

    // The welcome gate's exact render condition:
    expect(fresh.deriveAuthFlowState(s)).toBe("unauthenticated-guest");
    expect(fresh.deriveAuthFlowState(s)).not.toBe("unauthenticated");
  });

  it("sign-out clears the flag, so the gate correctly returns on the next load", async () => {
    const { useRuchi } = await import("@/lib/store");
    useRuchi.getState().enterGuestMode();
    useRuchi.getState().logCookedMeal({ ...meal });
    useRuchi.getState().signOut();
    expect(useRuchi.getState().guestMode).toBe(false);

    const fresh = await rehydrateStore();
    fresh.initAuthListener();
    await vi.waitFor(() => expect(fresh.useRuchi.getState().authReady).toBe(true));
    const s = fresh.useRuchi.getState();
    expect(s.guestMode).toBe(false);
    expect(fresh.deriveAuthFlowState(s)).toBe("unauthenticated");
  });
});

describe("guest-mode persistence (source contracts)", () => {
  const storeSrc = () => readFileSync("src/lib/store/index.ts", "utf8");

  it("the persist partialize persists guestMode", () => {
    const src = storeSrc();
    const start = src.indexOf("partialize:");
    const end = src.indexOf("}),", start);
    expect(start).toBeGreaterThan(-1);
    const partialize = src.slice(start, end);
    expect(partialize).toContain("guestMode");
  });

  it("the flow machine checks guestMode only after account + confirmation", () => {
    const src = storeSrc();
    // Anchor on the machine's first real branch — skips the type signature.
    const bodyStart = src.indexOf('if (s.recoveryMode) return "recovery";');
    expect(bodyStart).toBeGreaterThan(-1);
    const body = src.slice(bodyStart, bodyStart + 600);
    const account = body.indexOf("s.account");
    const confirmation = body.indexOf("pendingConfirmationEmail");
    const guest = body.indexOf("s.guestMode");
    expect(account).toBeGreaterThan(-1);
    expect(confirmation).toBeGreaterThan(account);
    expect(guest).toBeGreaterThan(confirmation);
  });
});
