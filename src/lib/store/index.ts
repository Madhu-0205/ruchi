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
  Intent,
  KitchenItem,
  MealHistoryEntry,
  NudgeEvent,
  NudgeKind,
  NotificationChannel,
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
  upsertNotificationTypePrefs,
  pushKitchenMirror,
  pushLastAction,
  pushPausedSession,
  type NotificationChannel as PushChannel,
  fetchProfile,
  insertCompletedMeals,
  recordCookingCompletion,
  recordStreakDay,
  upsertProfile,
  type CookingStatsRow,
} from "@/lib/auth/supabase-data";
import { markNotificationEngaged } from "@/lib/auth/supabase-data";

export { dayKeyOf };

// ── constant helpers ──────────────────────────────────────────

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function makeSessionToken(): string {
  return `s-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ── types ─────────────────────────────────────────────────────

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
  cloudStats: CookingStatsRow | null;
  recentCooked: MealHistoryEntry[];
  attention: {
    lastShown: { type: import("@/lib/context/attention").AttentionType; recipeId?: string; at: number } | null;
    suppressionUntil: number | null;
  };
  pausedCooking: { recipeId: string; stepIndex: number; stepCount: number; pausedAt: number } | null;
  notificationChannels: Partial<Record<NotificationChannel, boolean>>;
  notificationTypePrefs: Partial<Record<NotificationOpportunityType, boolean>>;
  cookingSessionToken: string | null;

  localOwner: LocalOwner;

  // ── Scan → home goal hand-off ────────────────────────────────
  // The scan screen PUBLISHES the goal chips the user confirmed; the home
  // screen CONSUMES exactly one publication and turns it into its active
  // recommendation goals. Four distinct states, never conflated:
  //
  //   revision 0                     → no transfer has ever been published
  //   revision > 0, !consumed, [g…]  → a non-empty transfer is pending
  //   revision > 0, !consumed, []    → an EMPTY transfer is pending (a real
  //                                    event: the user cleared every goal)
  //   revision > 0, consumed         → that transfer was already consumed
  //
  // The revision is the transfer identity — never the payload length. It is
  // strictly monotonic: it increments ONLY on publication, and is never
  // reset by consumption, navigation, or re-mounting home. That is what lets
  // a stale consumer be rejected instead of erasing a newer publication.
  // In-memory only (excluded from `partialize`), so it can never leak across
  // reloads or accounts.
  //
  // Session-ending paths (`signOut`, `resetAfterAccountDeletion`) mark the
  // current transfer consumed and clear its payload through the shared
  // `invalidatedScanTransfer` patch, so a hand-off cannot cross a session
  // boundary; the revision stays put. That is the only writer besides
  // publish/consume, and it only ever moves a transfer from pending to
  // consumed — never back.
  /** Goal chips handed over by the last published scan, `[]` included. */
  pendingScanGoals: Intent[];
  /** Identity of the newest publication. 0 = nothing ever published. */
  pendingScanGoalsRevision: number;
  /** True once the publication at the current revision was consumed. */
  pendingScanGoalsConsumed: boolean;

  // ── actions ──────────────────────────────────────────────────
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
  /** Local cleanup after the account was permanently DELETED on the server. */
  resetAfterAccountDeletion: () => void;

  // ── notification-type prefs (2.0 runtime) ────────────────────
  setNotificationChannel: (channel: NotificationChannel, enabled: boolean) => void;
  setNotificationType: (type: NotificationOpportunityType, enabled: boolean) => void;
  markNotificationOpened: (ledgerId: string) => void;
  markNotificationActioned: (ledgerId: string) => void;
  markAttentionShown: (
    type: import("@/lib/context/attention").AttentionType,
    recipeId?: string
  ) => void;
  dismissAttention: () => void;
  pauseCookingSession: (recipeId: string, stepIndex: number, stepCount: number) => void;
  clearPausedCooking: () => void;
  cookingSessionToken: string | null;
  _makeSessionToken: () => string;
}

// ── in-memory-only patch helpers ──────────────────────────────

/**
 * The ONE definition of scan-goal transfer invalidation.
 *
 * It retires the current transfer — payload cleared, explicitly non-pending —
 * and is spread into the caller's OWN state update, so a session-ending path
 * can never write half of it by hand. The revision is deliberately absent from
 * the patch: it stays monotonic and only ever moves on publication.
 *
 * Why a patch builder rather than a standalone store action: every consumer
 * must keep its reset ATOMIC. `resetAfterAccountDeletion` owns a single
 * in-memory wipe followed by `persist.clearStorage()`; a second `set()` after
 * that would re-write a persisted snapshot and undo the wipe the deletion
 * contract promises (and that its test pins). `signOut` stays a single update
 * for the same reason: no intermediate state worth persisting.
 */
function invalidatedScanTransfer(): Pick<
  RuchiState,
  "pendingScanGoals" | "pendingScanGoalsConsumed"
> {
  return { pendingScanGoals: [], pendingScanGoalsConsumed: true };
}

/**
 * Shared patch used by every owner-changing session boundary (not session
 * endings — those already wipe nudge state explicitly). It is deliberately
 * ASYMMETRIC: scan-goal transfer state is invalidated everywhere (a hand-off
 * belongs to the session that published it and must not follow a different
 * owner), but nudge state is left untouched here so the nudge boundary is
 * expressed only at the one place that knows whether an owner change is real
 * (`handleSignedIn`'s `ownsLocal` decision).
 *
 * This is what keeps the nudge fix atomic without reintroducing a second
 * `set()` at the boundary: the nudge wipe lives in the same patch as the
 * account/localOwner replacement for a real cross-owner sign-in, and is
 * entirely absent for a same-account return.
 */
function resetTransferForOwnerChange(): Pick<
  RuchiState,
  "pendingScanGoals" | "pendingScanGoalsConsumed"
> {
  return invalidatedScanTransfer();
}

// ── store ─────────────────────────────────────────────────────

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

let profileTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProfilePush: {
  accountId: string;
  displayName: string | null;
  prefs: UserPreferences;
} | null = null;

function cancelPendingProfilePush(): void {
  if (profileTimer) {
    clearTimeout(profileTimer);
    profileTimer = null;
  }
  pendingProfilePush = null;
}

/**
 * Debounced profile sync — the only delayed write in the store.
 *
 * Both the identity and the values are captured now, and both are re-checked
 * when the timer fires: a write is sent only when the capturing account is
 * still the active one, and the payload is always the captured one, never
 * whatever `name`/`prefs` happen to hold at fire time. That guards data
 * ownership as well as identity — a matching account id alone is not enough,
 * because the account can change under the same store shape mid-sign-in.
 */
function scheduleProfilePush(get: () => RuchiState) {
  const s = get();
  if (!s.account) return;

  cancelPendingProfilePush();
  pendingProfilePush = {
    accountId: s.account.id,
    displayName: s.name || null,
    prefs: s.prefs,
  };

  profileTimer = setTimeout(() => {
    profileTimer = null;
    const pending = pendingProfilePush;
    pendingProfilePush = null;
    if (!pending) return;
    const now = get();
    if (!now.account || now.account.id !== pending.accountId) return;
    void upsertProfile({
      displayName: pending.displayName,
      prefs: pending.prefs,
    }).then((r) => {
      if (r.ok) useRuchi.setState({ cloudSyncAt: Date.now(), syncError: false });
      else useRuchi.setState({ syncError: true });
    });
  }, 1200);
}

/** For the notification cron: mirrors the kitchen so the cron has something to read. */
function mirrorKitchenToServer(state: RuchiState): void {
  if (!state.account) return;
  void pushKitchenMirror({
    ids: state.inventory.map((i) => i.ingredientId),
    updatedAt: Date.now(),
  } as Parameters<typeof pushKitchenMirror>[0]);
}

function mirrorLastActionToServer(
  state: RuchiState,
  action: Parameters<typeof pushLastAction>[0]
): void {
  if (!state.account) return;
  void pushLastAction(action);
}

async function syncMeals(get: () => RuchiState): Promise<void> {
  const s = get();
  if (!s.account) return;

  const remote = await fetchCompletedMeals();
  if (!remote.ok) {
    useRuchi.setState({ syncError: true });
    return;
  }

  const remoteKeys = new Set(remote.data.map(mealKey));
  const localKeys = new Set(s.history.map(mealKey));

  const missingRemotely = s.history.filter((e) => !remoteKeys.has(mealKey(e)));
  if (missingRemotely.length > 0) {
    const ins = await insertCompletedMeals(missingRemotely);
    if (!ins.ok) {
      useRuchi.setState({ syncError: true });
      return;
    }
  }

  const freshLocally = remote.data.filter((e) => !localKeys.has(mealKey(e)));
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
}

function resetScreenToHome(): void {
  useScreen.setState({ screen: "home", recipeId: undefined, cameFrom: undefined, history: [] });
}

// The ONLY account-boundary reset that knows whether this is a real owner change.
// `ownsLocal` is the authoritative signal from `handleSignedIn`: a same-account
// return (local data belongs to the same account) must preserve nudges, a genuine
// cross-owner sign-in must clear them.
async function handleSignedIn(user: AccountUser, localOwner: LocalOwner): Promise<void> {
  const ownsLocal = localOwner === null || localOwner === user.id || localOwner === `anon:${user.id}`;

  // An account change is a boundary: the prior session's personalized state
  // must not survive into this one. Captured profile writes are retired here
  // (added by the profile-push fix), and nudge state is cleared only on a true
  // owner change — same-account re-entry preserves nudges.
  cancelPendingProfilePush();
  if (!ownsLocal) {
    // Atomic single-set boundary: wipe the prior owner's nudges AND apply the
    // new account in one `set()` so persistence never snapshots an intermediate
    // "B signed in but still seeing A's nudges" state.
    useRuchi.setState({
      account: user,
      localOwner: user.id,
      nudges: [],
      lastNudges: {},
      ...invalidatedScanTransfer(),
    });
  }

  resetScreenToHome();

  if (!ownsLocal) {
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

  // Same account returning: preserve nudges, restore from server.
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
      attention: { lastShown: null as { type: import("@/lib/context/attention").AttentionType; recipeId?: string; at: number } | null, suppressionUntil: null as number | null },
      pausedCooking: null as { recipeId: string; stepIndex: number; stepCount: number; pausedAt: number } | null,
      cookingSessionToken: null,
      syncError: false,
      authError: null as AuthFailure | null,
      authReady: false,
      recoveryMode: false,
      notificationChannels: {} as Partial<Record<PushChannel, boolean>>,
      notificationTypePrefs: {} as Partial<Record<NotificationOpportunityType, boolean>>,
      pendingConfirmationEmail: null,
      localOwner: null,

      pendingScanGoals: [],
      pendingScanGoalsRevision: 0,
      pendingScanGoalsConsumed: false,

      // ── identity + reset paths ──────────────────────────────────
      setName: (n) => {
        set({ name: n });
        scheduleProfilePush(get);
      },

      addItem: (ingredientId) => {
        if (get().inventory.some((i) => i.ingredientId === ingredientId)) return;
        const item: KitchenItem = { id: makeId(), ingredientId, addedAt: Date.now() };
        set({ inventory: [...get().inventory, item] });
        track("ingredient_added", { ingredientId });
        mirrorKitchenToServer(get());
      },

      removeItem: (ingredientId) => {
        set({ inventory: get().inventory.filter((i) => i.ingredientId !== ingredientId) });
        mirrorKitchenToServer(get());
      },

      setItemExpiry: (ingredientId, expiresAt) => {
        set({
          inventory: get().inventory.map((i) =>
            i.ingredientId === ingredientId ? { ...i, expiresAt } : i
          ),
        });
      },

      clearKitchen: () => {
        set({ inventory: [] });
        mirrorKitchenToServer(get());
      },

      setPrefs: (p) => {
        set({ prefs: { ...get().prefs, ...p } });
        scheduleProfilePush(get);
      },

      logCookedMeal: (entry) => {
        const full: MealHistoryEntry = {
          ...entry,
          id: makeId(),
          cookedAt: Date.now(),
        };
        const existingIndex = get().history.findIndex(
          (e) => e.recipeId === full.recipeId && dayKeyOf(e.cookedAt) === dayKeyOf(full)
        );
        if (existingIndex >= 0) {
          set({
            history: get().history.map((e, i) => (i === existingIndex ? full : e)),
          });
        } else {
          set({ history: [full, ...get().history].slice(0, 200) });
        }
        mirrorLastActionToServer(get(), { kind: "log_cooked_meal", recipeId: full.recipeId, at: full.cookedAt });

        if (get().account) {
          const token = get().cookingSessionToken ?? makeSessionToken();
          void recordCookingCompletion({
            sessionToken: token,
            recipeId: full.recipeId,
            recipeName: full.recipeName,
            cookedAtMs: full.cookedAt,
            servings: full.servings,
            proteinG: full.proteinG,
            calories: full.calories,
            costInr: full.cost,
            deliveryCompareInr: full.deliveryCompareCost,
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
        const fresh = incoming.filter(
          (n) => !existing.has(n.kind) && !(get().lastNudges[n.kind])
        );
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

      resetAfterAccountDeletion: () => {
        // The account is gone, so anything captured for it is gone too.
        cancelPendingProfilePush();
        set({
          account: null,
          cloudSyncAt: undefined,
          cloudStats: null,
          recentCooked: [],
          attention: { lastShown: null, suppressionUntil: null },
          pausedCooking: null,
          cookingSessionToken: null,
          notificationChannels: {},
          notificationTypePrefs: {},
          syncError: false,
          authError: null,
          recoveryMode: false,
          pendingConfirmationEmail: null,
          // Deliberately NOT `anon:<id>` the way signOut does: there is no
          // account left to re-attach this data to, so it must not be
          // remembered as someone's leftovers.
          localOwner: null,
          name: "",
          inventory: [],
          history: [],
          nudges: [],
          lastNudges: {},
          lastCookedAt: undefined,
          prefs: DEFAULT_PREFS,
          // Deletion is the other session-ending path and retires the transfer
          // identically — same shared patch, no revision movement. Kept
          // INSIDE this single `set` so the wipe stays atomic.
          ...invalidatedScanTransfer(),
        });
        // Drop the persisted key as well. Without this the wiped state would
        // be re-written on the next set() and the device copy would silently
        // survive the account it belonged to.
        try {
          void useRuchi.persist.clearStorage();
        } catch {
          // Best-effort: the in-memory wipe above already removed the data
          // from the running app.
        }
      },

      setNotificationChannel: (channel, enabled) => {
        if (!get().account) return;
        set({
          notificationChannels: { ...get().notificationChannels, [channel]: enabled },
        });
        void upsertNotificationChannels(
          Object.fromEntries(
            Object.entries(get().notificationChannels).filter(([, v]) => v !== false)
          ) as Parameters<typeof upsertNotificationChannels>[0]
        );
      },

      setNotificationType: (type, enabled) => {
        if (!get().account) return;
        set({
          notificationTypePrefs: { ...get().notificationTypePrefs, [type]: enabled },
        });
        void upsertNotificationTypePrefs(
          Object.fromEntries(
            Object.entries(get().notificationTypePrefs).filter(
              ([, v]) => v !== false
            )
          ) as Parameters<typeof upsertNotificationTypePrefs>[0]
        );
      },

      markNotificationOpened: (ledgerId) => {
        if (!get().account) return;
        void markNotificationEngaged(ledgerId, false).then((r) => {
          if (!r.ok) useRuchi.setState({ syncError: true });
        });
      },

      markNotificationActioned: (ledgerId) => {
        if (!get().account) return;
        void markNotificationEngaged(ledgerId, true).then((r) => {
          if (!r.ok) useRuchi.setState({ syncError: true });
        });
      },

      markAttentionShown: (type, recipeId) => {
        const attention = {
          lastShown: { type, recipeId, at: Date.now() },
          suppressionUntil: null,
        };
        set({ attention });
        if (get().account) {
          void pushAttentionState(attention as Parameters<typeof pushAttentionState>[0]);
        }
      },

      dismissAttention: () => {
        const attention = {
          ...get().attention,
          suppressionUntil: Date.now() + 2 * 60 * 60 * 1000,
        };
        set({ attention });
        if (get().account) {
          void pushAttentionState(attention as Parameters<typeof pushAttentionState>[0]);
        }
      },

      pauseCookingSession: (recipeId, stepIndex, stepCount) => {
        set({
          pausedCooking: { recipeId, stepIndex, stepCount, pausedAt: Date.now() },
        });
        if (get().account) {
          void pushPausedSession({
            recipeId,
            stepIndex,
            stepCount,
            pausedAt: Date.now(),
          } as Parameters<typeof pushPausedSession>[0]);
        }
      },

      clearPausedCooking: () => set({ pausedCooking: null }),

      _makeSessionToken: () => makeSessionToken(),

      // test-only escape hatch — resets every on-device nudge field through
      // the real action, for deterministic pre-transition setup. Not exported
      // publicly — nudges are a first-party feature and there is no product
      // action that wipes them independently of an ownership change.
      resetNudgeTestKit: () =>
        set({ nudges: [] as NudgeEvent[], lastNudges: {} as Partial<Record<NudgeKind, number>> }),

      // ── auth actions (real Supabase-backed paths) ─────────────────
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
        if (!recovery) return;
        set({ recoveryMode: true });
        void useScreen.getState().go("profile", { recovery: true });
      },

      setPendingScanGoals: (goals) => {
        const revision = get().pendingScanGoalsRevision + 1;
        set({
          pendingScanGoals: [...goals],
          pendingScanGoalsRevision: revision,
          pendingScanGoalsConsumed: false,
        });
        return revision;
      },

      consumePendingScanGoals: (expectedRevision) => {
        // `get()` + `set()` in one synchronous turn: the revision checked is
        // the revision consumed. There is no await between them, so a newer
        // publication (or another consumer) can never slip in between.
        const s = get();
        // Revision 0 is "nothing was ever published" — there is no transfer
        // to consume, even though 0 === 0.
        if (s.pendingScanGoalsRevision === 0) return false;
        if (s.pendingScanGoalsRevision !== expectedRevision) return false;
        if (s.pendingScanGoalsConsumed) return false;
        set({ pendingScanGoals: [], pendingScanGoalsConsumed: true });
        return true;
      },

      syncNow: () => {
        void syncMeals(get);
        scheduleProfilePush(get);
      },

      signOut: () => {
        const prev = get().account;
        void sbSignOut();
        // Session end: retire any pending profile write for this account.
        cancelPendingProfilePush();
        set({
          account: null,
          cloudSyncAt: undefined,
          cloudStats: null,
          recentCooked: [],
          attention: { lastShown: null, suppressionUntil: null },
          pausedCooking: null,
          cookingSessionToken: null,
          notificationChannels: {},
          notificationTypePrefs: {},
          syncError: false,
          authError: null,
          recoveryMode: false,
          pendingConfirmationEmail: null,
          localOwner: prev ? `anon:${prev.id}` : null,
          // A scan hand-off belongs to the session that published it, so
          // signing out retires it through the shared invalidation above.
          ...invalidatedScanTransfer(),
        });
      },
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

  void sbCurrentUser().then((user) => {
    if (user && useRuchi.getState().account?.id !== user.id) {
      void handleSignedIn(user, useRuchi.getState().localOwner ?? null);
    } else if (!user && useRuchi.getState().account) {
      cancelPendingProfilePush();
      useRuchi.setState({
        account: null,
        cloudSyncAt: undefined,
        cloudStats: null,
        recentCooked: [],
        attention: { lastShown: null, suppressionUntil: null },
        pausedCooking: null,
        cookingSessionToken: null,
        notificationChannels: {},
        notificationTypePrefs: {},
        syncError: false,
        localOwner: `anon:${useRuchi.getState().account.id}`,
      });
    }
    useRuchi.setState({ authReady: true });
  });

  onAuthChange((user) => {
    const s = useRuchi.getState();
    if (user && s.account?.id !== user.id) {
      void handleSignedIn(user, s.localOwner ?? null);
    } else if (!user && s.account) {
      cancelPendingProfilePush();
      useRuchi.setState({
        account: null,
        cloudSyncAt: undefined,
        cloudStats: null,
        recentCooked: [],
        attention: { lastShown: null, suppressionUntil: null },
        pausedCooking: null,
        cookingSessionToken: null,
        notificationChannels: {},
        notificationTypePrefs: {},
        syncError: false,
        localOwner: `anon:${s.account.id}`,
      });
    }
  });

  if (typeof window !== "undefined") {
    useRuchi.getState().consumeRecoveryRedirect();
  }
}
