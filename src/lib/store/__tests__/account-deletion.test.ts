// ─────────────────────────────────────────────────────────────
// RUCHI — post-deletion local cleanup (store)
// ─────────────────────────────────────────────────────────────
// Account deletion is the only irreversible action in RUCHI, so the local
// side of it has to be right:
//
//  1. `resetAfterAccountDeletion` wipes everything that belonged to the
//     deleted account — profile, kitchen, history, streaks, nudges, and
//     notification preferences — in memory AND on disk.
//  2. It must NOT do what `signOut` does (`localOwner: "anon:<id>"`). After
//     a real deletion there is no account to re-attach the leftovers to, so
//     re-owning them would quietly resurrect the deleted user's data the
//     next time they signed up.
//  3. A later state change must not re-persist the deleted data. That was
//     the previous bug: the screen cleared the storage key with
//     `localStorage.removeItem`, but the very next `set()` re-wrote the
//     snapshot from in-memory state, so the wipe did not stick.
//
// `signOut` is deliberately covered too, as the contrast case: the two
// flows must not converge.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CookingStatsRow } from "@/lib/auth/supabase-data";

// zustand's persist middleware writes on every setState; Node has no usable
// localStorage, so provide a real in-memory shim BEFORE the store module is
// evaluated. It is a genuine Storage impl (not a no-op) so the tests can
// read the persisted snapshot back and prove the wipe stuck.
const h = vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  } as unknown as Storage;
  return { mem };
});

vi.mock("@/lib/engine/analytics", () => ({ track: vi.fn() }));

// No transport in these tests: the store must never reach out during a
// local-state wipe, and nothing here should hit a network.
vi.mock("@/lib/auth/supabase-auth", () => ({
  currentUser: async () => null,
  onAuthChange: () => null,
  signIn: async () => ({ status: "failed", reason: "unconfigured" }),
  signUp: async () => ({ status: "failed", reason: "unconfigured" }),
  signOut: async () => {},
  currentSessionAccessToken: async () => null,
}));

vi.mock("@/lib/auth/supabase-data", () => ({
  fetchProfile: async () => ({ ok: false, reason: "unconfigured" }),
  fetchCompletedMeals: async () => ({ ok: false, reason: "unconfigured" }),
  fetchCookingStats: async () => ({ ok: false, reason: "unconfigured" }),
  fetchRecentCookedMeals: async () => ({ ok: false, reason: "unconfigured" }),
  fetchNotificationPrefs: async () => ({ ok: false, reason: "unconfigured" }),
  upsertProfile: async () => ({ ok: false, reason: "unconfigured" }),
  insertCompletedMeals: async () => ({ ok: false, reason: "unconfigured" }),
  recordStreakDay: async () => ({ ok: false, reason: "unconfigured" }),
  recordCookingCompletion: async () => ({ ok: false, reason: "unconfigured" }),
  pushKitchenMirror: async () => ({ ok: false, reason: "unconfigured" }),
  pushPausedSession: async () => ({ ok: false, reason: "unconfigured" }),
  pushLastAction: async () => ({ ok: false, reason: "unconfigured" }),
  pushAttentionState: async () => ({ ok: false, reason: "unconfigured" }),
  upsertNotificationChannels: async () => ({ ok: false, reason: "unconfigured" }),
  upsertNotificationTypePrefs: async () => ({ ok: false, reason: "unconfigured" }),
  markNotificationEngaged: async () => ({ ok: false, reason: "unconfigured" }),
  insertBetaFeedback: async () => ({ ok: false, reason: "unconfigured" }),
}));

import { useRuchi } from "@/lib/store";
import type { MealHistoryEntry } from "@/lib/types";

const PERSIST_KEY = "ruchi.store.v1";

const MEAL: MealHistoryEntry = {
  id: "meal-1",
  recipeId: "egg-maggi",
  recipeName: "Egg Maggi",
  cookedAt: Date.now() - 3_600_000,
  servings: 1,
  proteinG: 14,
  calories: 420,
  cost: 40,
  deliveryCompareCost: 120,
};

const STATS = { totalMeals: 7 } as unknown as CookingStatsRow;

/** The signed-in, data-rich state right before the account is deleted. */
function seedDeletedAccount() {
  h.mem.clear();
  useRuchi.setState({
    account: { id: "user-42", email: "asha@example.com", displayName: "Asha" },
    localOwner: "user-42",
    name: "Asha",
    inventory: [{ id: "item-1", ingredientId: "tomato", addedAt: 1 }],
    history: [MEAL],
    nudges: [
      {
        id: "n1",
        kind: "evening-dinner",
        title: "Cook tonight",
        body: "Keep the streak alive",
        createdAt: 2,
        read: false,
      },
    ],
    lastNudges: { "evening-dinner": 2 },
    lastCookedAt: 3,
    cloudSyncAt: 4,
    cloudStats: STATS,
    recentCooked: [MEAL],
    attention: { lastShown: { type: "meal_time", recipeId: "egg-maggi", at: 5 }, suppressionUntil: 6 },
    pausedCooking: { recipeId: "egg-maggi", stepIndex: 1, stepCount: 4, pausedAt: 7 },
    cookingSessionToken: "session-1",
    notificationChannels: { web_push: true },
    notificationTypePrefs: { resume_cooking: true },
    syncError: true,
    authError: "error",
    recoveryMode: true,
    pendingConfirmationEmail: "asha@example.com",
  });
}

describe("resetAfterAccountDeletion", () => {
  beforeEach(() => {
    seedDeletedAccount();
  });

  it("wipes the whole device copy of the deleted account", () => {
    useRuchi.getState().resetAfterAccountDeletion();
    const s = useRuchi.getState();

    // Identity + cloud mirror
    expect(s.account).toBeNull();
    expect(s.cloudSyncAt).toBeUndefined();
    expect(s.cloudStats).toBeNull();
    expect(s.recentCooked).toEqual([]);
    expect(s.syncError).toBe(false);
    expect(s.authError).toBeNull();

    // Local-only data that belonged to that account
    expect(s.name).toBe("");
    expect(s.inventory).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.nudges).toEqual([]);
    expect(s.lastNudges).toEqual({});
    expect(s.lastCookedAt).toBeUndefined();

    // Transient lifecycle state
    expect(s.attention).toEqual({ lastShown: null, suppressionUntil: null });
    expect(s.pausedCooking).toBeNull();
    expect(s.cookingSessionToken).toBeNull();
    expect(s.notificationChannels).toEqual({});
    expect(s.notificationTypePrefs).toEqual({});
    expect(s.recoveryMode).toBe(false);
    expect(s.pendingConfirmationEmail).toBeNull();
  });

  it("does NOT re-own deleted data as `anon:<id>` the way signOut does", () => {
    useRuchi.getState().resetAfterAccountDeletion();
    expect(useRuchi.getState().localOwner).toBeNull();
  });

  it("dropped the persisted snapshot", () => {
    useRuchi.getState().resetAfterAccountDeletion();
    expect(h.mem.get(PERSIST_KEY)).toBeUndefined();
  });

  it("cannot be undone by a later state change (the wipe sticks)", () => {
    useRuchi.getState().resetAfterAccountDeletion();

    // Any subsequent set() re-persists the current state — this is exactly
    // what used to bring the deleted data back.
    useRuchi.getState().markNudgesRead();
    useRuchi.getState().setPrefs({ budget: 150 });

    const raw = h.mem.get(PERSIST_KEY);
    expect(raw).toBeTruthy();
    const snapshot = JSON.parse(raw as string) as {
      state: Record<string, unknown>;
    };

    const text = JSON.stringify(snapshot);
    expect(text).not.toContain("asha@example.com");
    expect(text).not.toContain("Asha");
    expect(text).not.toContain("user-42");
    expect(text).not.toContain("egg-maggi");

    expect(snapshot.state.localOwner).toBeNull();
    expect(snapshot.state.history).toEqual([]);
    expect(snapshot.state.inventory).toEqual([]);
    expect(snapshot.state.name).toBe("");
    // The one change made after the wipe is still honoured.
    expect((snapshot.state.prefs as { budget: number }).budget).toBe(150);
  });
});

describe("signOut (contrast case: local leftovers are preserved)", () => {
  it("keeps the device data but re-owns it as `anon:<id>`", () => {
    seedDeletedAccount();
    useRuchi.getState().signOut();
    const s = useRuchi.getState();

    expect(s.account).toBeNull();
    expect(s.localOwner).toBe("anon:user-42");
    // Sign-out is not deletion: the kitchen and history stay on the device.
    expect(s.history).toHaveLength(1);
    expect(s.inventory).toHaveLength(1);
    expect(s.name).toBe("Asha");
  });
});
