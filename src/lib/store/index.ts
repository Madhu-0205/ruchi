// ─────────────────────────────────────────────────────────────
// RUCHI — client store (zustand + localStorage persistence)
// ─────────────────────────────────────────────────────────────
// Identity + durable data live in Supabase (auth + RLS-protected
// tables); local state stays responsive and ANONYMOUS-FIRST — every
// core feature works signed out from localStorage alone.
//
// Separation of concerns (enforced by imports):
// - Supabase (lib/auth/supabase*) owns identity, profiles, completed
//   meals and streaks. It never touches AI behavior.
// - The AI layer (lib/ai/*) is a server-backed helper only. It never
//   touches account state.
//
// Sync model:
// - Cloud is a mirror of durable data, never the source of truth for
//   the running UI. Local writes apply instantly; cloud writes are
//   async and failure-tolerant (quiet `syncError`, retried by syncNow).
// - Meals dedupe by (recipeId, local calendar day) in BOTH directions,
//   so anonymous progress migrates once and same-day duplicates never
//   multiply.
// - Streaks are computed locally (computeStreak, deterministic) and
//   server-side via the record_completed_meal_day RPC — the client
//   never sends a streak number anywhere.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  KitchenItem,
  MealHistoryEntry,
  NudgeEvent,
  NudgeKind,
  NotificationOpportunityType,
  UserPreferences,
} from "@/lib/types";
import { track } from "@/lib/engine/analytics";
import { dayKeyOf } from "@/lib/datetime";
import { useScreen } from "@/lib/store/screens";
import {
  completePasswordReset as sbCompletePasswordReset,
  consumeRecoveryRedirect as sbConsumeRecoveryRedirect,
  currentUser as sbCurrentUser,
  onAuthChange,
  requestPasswordReset as sbRequestPasswordReset,
  signIn as sbSignIn,
  signUp as sbSignUp,
  signOut as sbSignOut,
  type AccountUser,
  type AuthFailure,
} from "@/lib/auth/supabase-auth";
import {
  fetchCompletedMeals,
  fetchCookingStats,
  fetchRecentCookedMeals,
  fetchNotificationPrefs,
  pushAttentionState,
  upsertNotificationChannels,
  pushPausedSession,
  upsertNotificationTypePrefs,
  type NotificationChannel,
  fetchProfile,
  insertCompletedMeals,
  recordCookingCompletion,
  recordStreakDay,
  upsertProfile,
  type CookingStatsRow,
} from "@/lib/auth/supabase-data";
import { markNotificationEngaged } from "@/lib/auth/supabase-data";
export { dayKeyOf };

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

/** Whose data currently lives in localStorage. `null` = fresh device or nothing cooked yet. */
type LocalOwner = string | null;

interface RuchiState {
  name: string;
  inventory: KitchenItem[];
  prefs: UserPreferences;
  history: MealHistoryEntry[];
  nudges: NudgeEvent[];
  lastNudges: Partial<Record<NudgeKind, number>>;
  lastCookedAt?: number;

  /** Signed-in RUCHI account (Supabase). Null = anonymous. */
  account: AccountUser | null;
  /** Quiet sync indicator for Profile: last successful mirror time. */
  cloudSyncAt?: number;
  /** True when the last cloud write/read failed. */
  syncError: boolean;
  /** Auth failure kind for honest, non-technical error copy. */
  authError: AuthFailure | null;
  recoveryMode: boolean;
  pendingConfirmationEmail: string | null;
  authReady: boolean;
  localOwner: LocalOwner;

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

  signIn: (email: string, password: string) => Promise<"signed-in" | "failed">;
  signUp: (
    email: string,
    password: string,
  ) => Promise<"signed-in" | "needs-email-confirmation" | "failed">;
  requestPasswordReset: (email: string) => Promise<"sent" | "failed">;
  setNewPassword: (newPassword: string) => Promise<"updated" | "failed">;
  dismissRecovery: () => void;
  dismissConfirmationNotice: () => void;
  consumeRecoveryRedirect: () => void;
  signOut: () => void;
  syncNow: () => void;

  beginCookingSession: () => void;
  cloudStats: CookingStatsRow | null;
  recentCooked: MealHistoryEntry[];
  attention: {
    lastShown: { type: import("@/lib/context/attention").AttentionType; recipeId?: string; at: number } | null;
    suppressionUntil: number | null;
  };
  pausedCooking: { recipeId: string; stepIndex: number; stepCount: number; pausedAt: number } | null;
  /** Notification opt-in flags (server-backed; defaults OFF). */
  notificationChannels: Partial<Record<NotificationChannel, boolean>>;
  notificationTypePrefs: Partial<Record<NotificationOpportunityType, boolean>>;
  setNotificationType: (type: NotificationOpportunityType, enabled: boolean) => void;
  markNotificationOpened: (ledgerId: string) => void;
  markNotificationActioned: (ledgerId: string) => void;
  setNotificationChannel: (channel: NotificationChannel, enabled: boolean) => void;
  /** Record that a re-attention context was shown (drives cooldowns). */
  markAttentionShown: (type: import("@/lib/context/attention").AttentionType, recipeId?: string) => void;
  /** User dismissed a re-attention moment — mute everything briefly. */
  dismissAttention: () => void;
  pauseCookingSession: (recipeId: string, stepIndex: number, stepCount: number) => void;
  clearPausedCooking: () => void;
  cookingSessionToken: string | null;
  _makeSessionToken: () => string;
}

let sessionTokenOverride: string | null = null;

function makeSessionToken(): string {
  if (sessionTokenOverride) return sessionTokenOverride;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function setSessionTokenForTests(token: string | null): void {
  sessionTokenOverride = token;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mealKey(e: Pick<MealHistoryEntry, "recipeId" | "cookedAt">): string {
  return `${e.recipeId}|${dayKeyOf(e.cookedAt)}`;
}

let profileTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleProfilePush(get: () => RuchiState) {
  if (profileTimer) clearTimeout(profileTimer);
  profileTimer = setTimeout(() => {
    profileTimer = null;
    const s = get();
    if (!s.account) return;
    void upsertProfile({ displayName: s.name || null, prefs: s.prefs }).then((r) => {
      if (r.ok) useRuchi.setState({ cloudSyncAt: Date.now(), syncError: false });
      else useRuchi.setState({ syncError: true });
    });
  }, 1200);
}

async function syncMeals(get: () => RuchiState): Promise<void> {
  const s = get();
  if (!s.account) return;
  const remote = await fetchCompletedMeals();
  if (!remote.ok) {
    useRuchi.setState({ syncError: true });
    return;
  }
  const remoteEntries = remote.data;
  const remoteKeys = new Set(remoteEntries.map(mealKey));
  const localKeys = new Set(s.history.map(mealKey));

  const missingRemotely = s.history.filter((e) => !remoteKeys.has(mealKey(e)));
  let pushedDays: string[] = [];
  if (missingRemotely.length > 0) {
    const ins = await insertCompletedMeals(missingRemotely);
    if (!ins.ok) {
      useRuchi.setState({ syncError: true });
      return;
    }
    pushedDays = [...new Set(missingRemotely.map((e) => dayKeyOf(e.cookedAt)))];
  }

  const freshLocally = remoteEntries.filter((e) => !localKeys.has(mealKey(e)));

  if (pushedDays.length > 0) {
    for (const day of pushedDays) {
      const [y, m, d] = day.split("-").map(Number) as [number, number, number];
      const dayMs = new Date(y, m - 1, d, 21).getTime();
      const r = await recordStreakDay(dayMs);
      if (!r.ok) {
        useRuchi.setState({ syncError: true });
        return;
      }
    }
  }

  if (freshLocally.length > 0) {
    const merged = [...freshLocally, ...s.history]
      .sort((a, b) => b.cookedAt - a.cookedAt)
      .slice(0, 200);
    useRuchi.setState({
      history: merged,
      lastCookedAt: Math.max(s.lastCookedAt ?? 0, ...merged.map((h) => h.cookedAt)) || s.lastCookedAt,
    });
  }

  useRuchi.setState({ cloudSyncAt: Date.now(), syncError: false });

  const [stats, recent, notifPrefs] = await Promise.all([
    fetchCookingStats(),
    fetchRecentCookedMeals(8),
    fetchNotificationPrefs(),
  ]);
  useRuchi.setState({
    cloudStats: stats.ok ? stats.data : null,
    recentCooked: recent.ok ? recent.data : [],
    notificationChannels: notifPrefs.ok ? (notifPrefs.data?.channels ?? {}) : {},
  });
  if (!stats.ok) useRuchi.setState({ syncError: true });
}

function resetScreenToHome(): void {
  useScreen.setState({ screen: "home", recipeId: undefined, cameFrom: undefined, history: [] });
}

async function handleSignedIn(user: AccountUser, localOwner: LocalOwner): Promise<void> {
  const ownsLocal = localOwner === null || localOwner === user.id || localOwner === `anon:${user.id}`;

  resetScreenToHome();

  if (!ownsLocal) {
    useRuchi.setState({ account: user, localOwner: user.id });
    const [profile, meals, stats, recent, notifPrefs] = await Promise.all([
      fetchProfile(),
      fetchCompletedMeals(),
      fetchCookingStats(),
      fetchRecentCookedMeals(8),
      fetchNotificationPrefs(),
    ]);
    const patch: Partial<RuchiState> = {
      cloudSyncAt: Date.now(),
      syncError: !(profile.ok && meals.ok),
      inventory: [],
      history: meals.ok ? meals.data : [],
      lastCookedAt: meals.ok && meals.data[0] ? meals.data[0].cookedAt : undefined,
      cloudStats: stats.ok ? stats.data : null,
      recentCooked: recent.ok ? recent.data : [],
      notificationChannels: notifPrefs.ok ? (notifPrefs.data?.channels ?? {}) : {},
    };
    if (profile.ok && profile.data?.prefs) patch.prefs = profile.data.prefs;
    if (profile.ok && profile.data?.displayName) patch.name = profile.data.displayName;
    if (Object.keys(patch).length > 0) useRuchi.setState(patch);
    return;
  }

  useRuchi.setState({ account: user, localOwner: user.id, authError: null });

  const profile = await fetchProfile();
  if (profile.ok && profile.data) {
    const s = useRuchi.getState();
    const patch: Partial<RuchiState> = {};
    if (!s.name && profile.data.displayName) patch.name = profile.data.displayName;
    if (profile.data.prefs && JSON.stringify(s.prefs) === JSON.stringify(DEFAULT_PREFS)) {
      patch.prefs = profile.data.prefs;
    }
    if (Object.keys(patch).length > 0) useRuchi.setState(patch);
  }

  await syncMeals(useRuchi.getState);
  const s = useRuchi.getState();
  if (s.name || JSON.stringify(s.prefs) !== JSON.stringify(DEFAULT_PREFS)) {
    scheduleProfilePush(useRuchi.getState);
  }
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
      cloudStats: null,
      recentCooked: [],
      attention: { lastShown: null, suppressionUntil: null },
      pausedCooking: null,
      notificationChannels: {},
      notificationTypePrefs: {},
      cookingSessionToken: null,
      syncError: false,
      authError: null,
      authReady: false,
      recoveryMode: false,
      pendingConfirmationEmail: null,
      localOwner: null,

      setName: (n) => {
        set({ name: n });
        scheduleProfilePush(get);
      },

      addItem: (ingredientId) => {
        if (get().inventory.some((i) => i.ingredientId === ingredientId)) return;
        const item: KitchenItem = { id: makeId(), ingredientId, addedAt: Date.now() };
        set({ inventory: [...get().inventory, item] });
        track("ingredient_added", { ingredientId });
      },

      removeItem: (ingredientId) => {
        set({ inventory: get().inventory.filter((i) => i.ingredientId !== ingredientId) });
      },

      setItemExpiry: (ingredientId, expiresAt) => {
        set({
          inventory: get().inventory.map((i) =>
            i.ingredientId === ingredientId ? { ...i, expiresAt } : i,
          ),
        });
      },

      clearKitchen: () => {
        set({ inventory: [] });
      },

      setPrefs: (p) => {
        set({ prefs: { ...get().prefs, ...p } });
        scheduleProfilePush(get);
      },

      beginCookingSession: () => {
        if (!get().cookingSessionToken && !sessionTokenOverride) {
          set({ cookingSessionToken: makeSessionToken() });
        }
      },

      markAttentionShown: (type, recipeId) => {
        const attention = { lastShown: { type, recipeId, at: Date.now() }, suppressionUntil: null };
        set({ attention });
        if (get().account) {
          void pushAttentionState(attention);
        }
      },

      dismissAttention: () => {
        const attention = { ...get().attention, suppressionUntil: Date.now() + 2 * 60 * 60 * 1000 };
        set({ attention });
        if (get().account) {
          void pushAttentionState(attention);
        }
      },

      setNotificationChannel: (channel, enabled) => {
        const notificationChannels = { ...get().notificationChannels, [channel]: enabled };
        set({ notificationChannels });
        if (get().account) {
          void upsertNotificationChannels({ [channel]: enabled }).then((r) => {
            if (!r.ok) useRuchi.setState({ syncError: true });
          });
        }
      },

      setNotificationType: (type, enabled) => {
        const typePrefs = { ...get().notificationTypePrefs, [type]: enabled };
        set({ notificationTypePrefs: typePrefs });
        if (get().account) {
          void upsertNotificationTypePrefs(typePrefs).then((r) => {
            if (!r.ok) useRuchi.setState({ syncError: true });
          });
        }
      },

      pauseCookingSession: (recipeId, stepIndex, stepCount) => {
        set({ pausedCooking: { recipeId, stepIndex, stepCount, pausedAt: Date.now() } });
        if (get().account) {
          void pushPausedSession({ recipeId, stepIndex, stepCount, pausedAt: Date.now() });
        }
      },

      clearPausedCooking: () => {
        set({ pausedCooking: null });
        if (get().account) {
          void pushPausedSession(null);
        }
      },

      logCookedMeal: (entry) => {
        const e: MealHistoryEntry = { ...entry, id: makeId(), cookedAt: Date.now() };
        set({
          history: [e, ...get().history].slice(0, 200),
          lastCookedAt: e.cookedAt,
        });
        track("cooking_completed", { recipeId: entry.recipeId, servings: entry.servings });
        if (get().account) {
          const token = get().cookingSessionToken ?? makeSessionToken();
          void recordCookingCompletion({
            sessionToken: token,
            recipeId: entry.recipeId,
            recipeName: entry.recipeName,
            cookedAtMs: e.cookedAt,
            servings: entry.servings,
            proteinG: entry.proteinG,
            calories: entry.calories,
            costInr: entry.cost,
            deliveryCompareInr: entry.deliveryCompareCost,
          }).then(async (r) => {
            await syncMeals(get).catch(() => {});
            if (!r.ok) {
              useRuchi.setState({ syncError: true });
              return;
            }
            if (r.data === "recorded") {
              if (useRuchi.getState().cookingSessionToken === token) {
                useRuchi.setState({ cookingSessionToken: null });
              }
            }
            const [stats, recent] = await Promise.all([
              fetchCookingStats(),
              fetchRecentCookedMeals(8),
            ]);
            useRuchi.setState({
              cloudStats: stats.ok ? stats.data : null,
              recentCooked: recent.ok ? recent.data : [],
              syncError: !stats.ok,
            });
          });
        }
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
          lastCookedAt: undefined,
          cloudSyncAt: undefined,
          syncError: false,
        })),

      signIn: async (email, password) => {
        set({ authError: null });
        const outcome = await sbSignIn(email, password);
        if (outcome.status !== "signed-in") {
          set({ authError: outcome.reason });
          return "failed";
        }
        await handleSignedIn(outcome.user, get().localOwner ?? null);
        return "signed-in";
      },

      signUp: async (email, password) => {
        set({ authError: null });
        const outcome = await sbSignUp(email, password);
        if (outcome.status === "failed") {
          set({ authError: outcome.reason });
          return "failed";
        }
        if (outcome.status === "needs-email-confirmation") {
          set({ pendingConfirmationEmail: outcome.email });
          return outcome.status;
        }
        await handleSignedIn(outcome.user, get().localOwner ?? null);
        return "signed-in";
      },

      requestPasswordReset: async (email) => {
        set({ authError: null });
        const outcome = await sbRequestPasswordReset(email);
        if (outcome.status === "failed") {
          set({ authError: outcome.reason });
          return "failed";
        }
        return "sent";
      },

      setNewPassword: async (newPassword) => {
        set({ authError: null });
        const outcome = await sbCompletePasswordReset(newPassword);
        if (outcome.status === "failed") {
          set({ authError: outcome.reason });
          return "failed";
        }
        set({ recoveryMode: false });
        return "updated";
      },

      consumeRecoveryRedirect: () => {
        const { recovery } = sbConsumeRecoveryRedirect();
        if (recovery) set({ recoveryMode: true });
      },

      dismissRecovery: () => set({ recoveryMode: false, authError: null }),

      dismissConfirmationNotice: () => set({ pendingConfirmationEmail: null }),

      signOut: () => {
        const prev = get().account;
        void sbSignOut();
        set({
          account: null,
          cloudSyncAt: undefined,
          cloudStats: null,
          recentCooked: [],
          attention: { lastShown: null, suppressionUntil: null },
          pausedCooking: null,
          notificationChannels: {},
          notificationTypePrefs: {},
          syncError: false,
          authError: null,
          recoveryMode: false,
          pendingConfirmationEmail: null,
          localOwner: prev ? `anon:${prev.id}` : null,
        });
      },

      syncNow: () => {
        void syncMeals(get);
        scheduleProfilePush(get);
      },

      markNotificationOpened: (ledgerId: string) => {
        if (!get().account) return;
        void markNotificationEngaged(ledgerId, false).then((r) => {
          if (!r.ok) useRuchi.setState({ syncError: true });
        });
      },

      markNotificationActioned: (ledgerId: string) => {
        if (!get().account) return;
        void markNotificationEngaged(ledgerId, true).then((r) => {
          if (!r.ok) useRuchi.setState({ syncError: true });
        });
      },

      _makeSessionToken: () => makeSessionToken(),
    }),
    {
      name: "ruchi.store.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        name: s.name,
        inventory: s.inventory,
        prefs: s.prefs,
        history: s.history,
        attention: s.attention,
        pausedCooking: s.pausedCooking,
        notificationChannels: s.notificationChannels,
        notificationTypePrefs: s.notificationTypePrefs,
        nudges: s.nudges,
        lastNudges: s.lastNudges,
        lastCookedAt: s.lastCookedAt,
        localOwner: s.localOwner,
      }),
    },
  ),
);

// ── Auth listener (browser only) ──
let authListenerAttached = false;

export function initAuthListener(): void {
  if (authListenerAttached) return;
  authListenerAttached = true;
  onAuthChange((user) => {
    const s = useRuchi.getState();
    if (user && s.account?.id !== user.id) {
      void handleSignedIn(user, s.localOwner ?? null);
    } else if (!user && s.account) {
      useRuchi.setState({
        account: null,
        cloudSyncAt: undefined,
        cloudStats: null,
        recentCooked: [],
        attention: { lastShown: null, suppressionUntil: null },
        pausedCooking: null,
        notificationChannels: {},
        notificationTypePrefs: {},
        syncError: false,
        localOwner: `anon:${s.account.id}`,
      });
    }
  });
  void sbCurrentUser()
    .then((u) => {
      if (!u) return;
      const s = useRuchi.getState();
      if (s.account?.id !== u.id) void handleSignedIn(u, s.localOwner ?? null);
    })
    .finally(() => {
      useRuchi.setState({ authReady: true });
    });
}

if (typeof window !== "undefined") {
  initAuthListener();
  useRuchi.getState().consumeRecoveryRedirect();
}

export function resetAuthListenerForTests(): void {
  authListenerAttached = false;
}

// ── Auth flow state machine (derived, not stored) ────────
//
// One derivation, consumed by the shell. Supabase stays the ONLY auth
// authority: every state below is computed from flags the Supabase-backed
// service maintains — no parallel session store, no AI-provider identity.
//
// Note on sign-out: RUCHI treats it as an ATOMIC transition — the signOut
// action clears account + all auth flags in one batched set(), and the
// Supabase sign-out call itself is fire-and-forget. The machine therefore
// jumps straight from "authenticated" to "unauthenticated" in a single
// React commit: no stale private UI can linger, and no transitional flag
// exists that could wedge the UI if Supabase never emits an event
// (offline, unconfigured). A separate "signing-out" state would buy
// nothing here and add a stuck-state risk.

export type AuthFlowState =
  | "initializing" // app booted; Supabase session check not settled yet
  | "authenticated" // live Supabase session — show the RUCHI experience
  | "recovery" // arrived via a password-reset link — set a new password
  | "confirmation-required" // sign-up done; active after the email link
  | "unauthenticated"; // welcome + sign-in/sign-up (also: just signed out)

export function deriveAuthFlowState(
  s: Pick<
    RuchiState,
    "authReady" | "account" | "recoveryMode" | "pendingConfirmationEmail"
  >,
): AuthFlowState {
  if (s.recoveryMode) return "recovery";
  if (s.authReady && s.account) return "authenticated";
  if (s.authReady && s.pendingConfirmationEmail) return "confirmation-required";
  if (s.authReady) return "unauthenticated";
  return "initializing";
}

// ── Derived selectors (pure functions over state) ───────

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
