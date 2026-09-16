// ─────────────────────────────────────────────────────────────
// RUCHI — client store (zustand + localStorage persistence)
// ─────────────────────────────────────────────────────────────
// Single-user MVP. This module is the seam where a real backend later
// replaces localStorage: today the cloud mirror is Puter KV (see
// lib/auth) — swap the sync functions, keep the API.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  KitchenItem,
  MealHistoryEntry,
  NudgeEvent,
  NudgeKind,
  UserPreferences,
} from "@/lib/types";
import { track } from "@/lib/engine/analytics";
import type { AccountUser } from "@/lib/auth/puter-auth";
import {
  signIn as authSignIn,
  signOut as authSignOut,
  saveSnapshot,
  loadSnapshot,
} from "@/lib/auth/puter-auth";

const DEFAULT_PREFS: UserPreferences = {
  diet: "eggetarian",
  allergies: [],
  fitnessGoal: "none",
  skill: "beginner",
  defaultServings: 1,
  budget: 100,
  cuisines: ["Indian"],
  equipment: ["stove", "pan", "pot"],
};

interface RuchiState {
  name: string;
  inventory: KitchenItem[];
  prefs: UserPreferences;
  history: MealHistoryEntry[];
  nudges: NudgeEvent[];
  lastNudges: Partial<Record<NudgeKind, number>>;
  lastCookedAt?: number;
  /** Signed-in Puter account, when the user connected one. Anonymous-first. */
  account: AccountUser | null;
  /** Last cloud mirror attempt, for a quiet one-line status in Profile. */
  cloudSyncAt?: number;

  setName: (n: string) => void;
  addItem: (ingredientId: string) => void;
  removeItem: (ingredientId: string) => void;
  setItemExpiry: (ingredientId: string, expiresAt?: number) => void;
  clearKitchen: () => void;
  setPrefs: (p: Partial<UserPreferences>) => void;
  logCookedMeal: (entry: Omit<MealHistoryEntry, "id" | "cookedAt">) => void;
  upsertNudges: (incoming: NudgeEvent[]) => void;
  markNudgesRead: () => void;
  resetAll: (opts?: { keepKitchen?: boolean }) => void;

  /** Puter popup sign-in; merges anything new from the cloud afterwards. */
  signInWithPuter: () => Promise<"signed-in" | "unavailable" | "dismissed">;
  signOutFromPuter: () => void;
  /** Best-effort mirror of durable state to the signed-in user's cloud. */
  pushToCloud: () => void;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Cloud mirror helpers (module scope: debounce across actions) ──

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushedJson = "";

function durableSnapshot(s: RuchiState) {
  return {
    name: s.name,
    inventory: s.inventory,
    prefs: s.prefs,
    history: s.history,
    lastCookedAt: s.lastCookedAt,
  };
}

function scheduleCloudPush(get: () => RuchiState) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const s = get();
    if (!s.account) return; // anonymous — nothing to mirror onto
    const json = JSON.stringify(durableSnapshot(s));
    if (json === lastPushedJson) return;
    lastPushedJson = json;
    void saveSnapshot(JSON.parse(json)).then((ok) => {
      if (ok) useRuchi.setState({ cloudSyncAt: Date.now() });
    });
  }, 1200);
}

/** Cloud fill-in on sign-in: adds what's missing locally, never deletes. */
async function mergeFromCloud(
  get: () => RuchiState,
): Promise<{ merged: number } | null> {
  const res = await loadSnapshot();
  if (res.status !== "loaded" || !res.snapshot) return null;
  const snap = res.snapshot as Partial<RuchiState>;
  const s = get();
  let merged = 0;
  const patch: Partial<RuchiState> = {};

  if (!s.name && typeof snap.name === "string" && snap.name) {
    patch.name = snap.name;
    merged++;
  }
  if (Array.isArray(snap.inventory) && s.inventory.length === 0 && snap.inventory.length > 0) {
    patch.inventory = snap.inventory as KitchenItem[];
    merged++;
  }
  if (Array.isArray(snap.history) && snap.history.length > 0) {
    const have = new Set(s.history.map((h) => h.id));
    const fresh = (snap.history as MealHistoryEntry[]).filter(
      (h) => h && h.id && !have.has(h.id),
    );
    if (fresh.length > 0) {
      patch.history = [...fresh, ...s.history]
        .sort((a, b) => b.cookedAt - a.cookedAt)
        .slice(0, 200);
      merged += fresh.length;
    }
  }
  if (
    patch.history?.length &&
    (!s.lastCookedAt || (snap.lastCookedAt ?? 0) > s.lastCookedAt)
  ) {
    patch.lastCookedAt = Math.max(
      s.lastCookedAt ?? 0,
      ...(patch.history as MealHistoryEntry[]).map((h) => h.cookedAt),
    );
  }
  if (merged > 0) useRuchi.setState(patch);
  return { merged };
}

export const useRuchi = create<RuchiState>()(
  persist(
    (set, get) => ({
      name: "",
      inventory: [],
      prefs: DEFAULT_PREFS,
      history: [],
      nudges: [],
      lastNudges: {},
      lastCookedAt: undefined,
      account: null,
      cloudSyncAt: undefined,

      setName: (n) => {
        set({ name: n });
        scheduleCloudPush(get);
      },

      addItem: (ingredientId) => {
        if (get().inventory.some((i) => i.ingredientId === ingredientId)) return;
        const item: KitchenItem = { id: makeId(), ingredientId, addedAt: Date.now() };
        set({ inventory: [...get().inventory, item] });
        track("ingredient_added", { ingredientId });
        scheduleCloudPush(get);
      },

      removeItem: (ingredientId) => {
        set({ inventory: get().inventory.filter((i) => i.ingredientId !== ingredientId) });
        scheduleCloudPush(get);
      },

      setItemExpiry: (ingredientId, expiresAt) => {
        set({
          inventory: get().inventory.map((i) =>
            i.ingredientId === ingredientId ? { ...i, expiresAt } : i,
          ),
        });
        scheduleCloudPush(get);
      },

      clearKitchen: () => {
        set({ inventory: [] });
        scheduleCloudPush(get);
      },

      setPrefs: (p) => {
        set({ prefs: { ...get().prefs, ...p } });
        scheduleCloudPush(get);
      },

      logCookedMeal: (entry) => {
        const e: MealHistoryEntry = { ...entry, id: makeId(), cookedAt: Date.now() };
        set({
          history: [e, ...get().history].slice(0, 200),
          lastCookedAt: e.cookedAt,
        });
        track("cooking_completed", { recipeId: entry.recipeId, servings: entry.servings });
        scheduleCloudPush(get);
      },

      upsertNudges: (incoming) => {
        const cur = get().nudges;
        const existing = new Set(cur.map((n) => n.kind));
        const fresh = incoming.filter((n) => !existing.has(n.kind) && !(get().lastNudges[n.kind]));
        set({
          nudges: [...fresh, ...cur].slice(0, 20),
          lastNudges: {
            ...get().lastNudges,
            ...Object.fromEntries(fresh.map((n) => [n.kind, n.createdAt])),
          },
        });
      },

      markNudgesRead: () =>
        set({ nudges: get().nudges.map((n) => ({ ...n, read: true })) }),

      resetAll: (opts) =>
        set((s) => ({
          // keep: name, prefs, account — identity and preferences survive
          inventory: opts?.keepKitchen ? s.inventory : [],
          history: [],
          nudges: [],
          lastNudges: {},
          lastCookedAt: undefined,
          cloudSyncAt: undefined,
        })),

      signInWithPuter: async () => {
        const outcome = await authSignIn();
        if (outcome.status !== "signed-in") {
          return outcome.status === "dismissed" ? "dismissed" : "unavailable";
        }
        set({ account: outcome.user });
        await mergeFromCloud(get);
        scheduleCloudPush(get);
        return "signed-in";
      },

      signOutFromPuter: () => {
        authSignOut();
        set({ account: null, cloudSyncAt: undefined });
      },

      pushToCloud: () => scheduleCloudPush(get),
    }),
    {
      name: "ruchi.store.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        name: s.name,
        inventory: s.inventory,
        prefs: s.prefs,
        history: s.history,
        nudges: s.nudges,
        lastNudges: s.lastNudges,
        lastCookedAt: s.lastCookedAt,
      }),
    },
  ),
);

// ── Derived selectors (pure functions over state) ───────────

export function inventoryIds(s: Pick<RuchiState, "inventory">): string[] {
  return s.inventory.map((i) => i.ingredientId);
}

export function weeklyProgress(s: Pick<RuchiState, "history">): {
  meals: number;
  saved: number;
  protein: number;
} {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const week = s.history.filter((h) => h.cookedAt > weekAgo);
  return {
    meals: week.length,
    saved: week.reduce((a, h) => a + Math.max(0, h.deliveryCompareCost - h.cost), 0),
    protein: Math.round(week.reduce((a, h) => a + h.proteinG, 0)),
  };
}

/** Local-calendar day key ("2026-09-16"), immune to locale/format drift. */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Consecutive-day cooking streak, in the user's local timezone.
 *
 * - Multiple meals on one day count once.
 * - A streak includes today when today has a meal; otherwise it counts
 *   from yesterday (today is still open — cooking tonight keeps it alive).
 * - Any missed full day resets it to 0. Duplicate days never inflate it.
 */
export function computeStreak(
  history: Pick<MealHistoryEntry, "cookedAt">[],
  now: number,
): number {
  if (history.length === 0) return 0;
  const days = new Set(history.map((h) => dayKeyOf(h.cookedAt)));
  const cursor = new Date(now);
  if (!days.has(dayKeyOf(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  for (;;) {
    if (days.has(dayKeyOf(cursor.getTime()))) {
      n++;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return n;
}

export function streak(s: Pick<RuchiState, "history">): number {
  return computeStreak(s.history, Date.now());
}
