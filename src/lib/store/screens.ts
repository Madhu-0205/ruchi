// ─────────────────────────────────────────────────────────────
// RUCHI — screen router (client-side, no URL routing for MVP)
// ─────────────────────────────────────────────────────────────

import { create } from "zustand";

export type Screen =
  | "home"
  | "discover"
  | "kitchen"
  | "profile"
  | "meal"
  | "cooking"
  | "scan";

interface ScreenState {
  screen: Screen;
  recipeId?: string;
  cameFrom?: Screen;
  history: Screen[];

  go: (s: Screen, opts?: { recipeId?: string }) => void;
  back: () => void;
  hydrate: () => void;
}

export const useScreen = create<ScreenState>()((set, get) => ({
  screen: "home",
  recipeId: undefined,
  cameFrom: undefined,
  history: [],

  go: (s, opts) =>
    set((st) => ({
      screen: s,
      recipeId: opts?.recipeId ?? (s === "meal" || s === "cooking" ? st.recipeId : undefined),
      cameFrom: st.screen,
      history: [...st.history, st.screen].slice(-20),
    })),

  back: () =>
    set((st) => {
      const h = [...st.history];
      const prev = h.pop() ?? "home";
      return { screen: prev, history: h, recipeId: prev === "meal" ? st.recipeId : undefined };
    }),

  hydrate: () => void get(),
}));
