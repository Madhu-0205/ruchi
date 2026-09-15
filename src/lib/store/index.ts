// ─────────────────────────────────────────────────────────────
// RUCHI — client store (zustand + localStorage persistence)
// ─────────────────────────────────────────────────────────────
// Single-user MVP. This module is the seam where a real backend later
// replaces localStorage: swap the persist storage target, keep the API.

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
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

      setName: (n) => set({ name: n }),

      addItem: (ingredientId) => {
        if (get().inventory.some((i) => i.ingredientId === ingredientId)) return;
        const item: KitchenItem = { id: makeId(), ingredientId, addedAt: Date.now() };
        set({ inventory: [...get().inventory, item] });
        track("ingredient_added", { ingredientId });
      },

      removeItem: (ingredientId) =>
        set({ inventory: get().inventory.filter((i) => i.ingredientId !== ingredientId) }),

      setItemExpiry: (ingredientId, expiresAt) =>
        set({
          inventory: get().inventory.map((i) =>
            i.ingredientId === ingredientId ? { ...i, expiresAt } : i,
          ),
        }),

      clearKitchen: () => set({ inventory: [] }),

      setPrefs: (p) => set({ prefs: { ...get().prefs, ...p } }),

      logCookedMeal: (entry) => {
        const e: MealHistoryEntry = { ...entry, id: makeId(), cookedAt: Date.now() };
        set({
          history: [e, ...get().history].slice(0, 200),
          lastCookedAt: e.cookedAt,
        });
        track("cooking_completed", { recipeId: entry.recipeId, servings: entry.servings });
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
          inventory: opts?.keepKitchen ? s.inventory : [],
          history: [],
          nudges: [],
          lastNudges: {},
        })),
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

export function streak(s: Pick<RuchiState, "history">): number {
  if (s.history.length === 0) return 0;
  const days = new Set(s.history.map((h) => new Date(h.cookedAt).toDateString()));
  let n = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // today not cooked yet
  for (;;) {
    if (days.has(d.toDateString())) {
      n++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return n;
}
