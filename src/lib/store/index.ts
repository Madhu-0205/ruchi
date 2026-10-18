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
import { defensibleSavings } from "@/lib/personality";
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
  /** Mint the token that makes a cooking session's completion writes idempotent. */
  beginCookingSession: () => void;
  _makeSessionToken: () => string;
  /** Test-only: wipe nudge state through a real action (ownership boundary). */
  resetNudgeTestKit: () => void;

  // ── auth actions (real Supabase-backed paths) ─────────────────
  signIn: (email: string, password: string) => Promise<"signed-in" | "failed">;
  signUp: (
    email: string,
    password: string
  ) => Promise<"signed-in" | "needs-email-confirmation" | "failed">;
  requestPasswordReset: (email: string) => Promise<"sent" | "failed">;
  setNewPassword: (newPassword: string) => Promise<"updated" | "failed">;
  dismissConfirmationNotice: () => void;
  dismissRecovery: () => void;
  consumeRecoveryRedirect: () => void;
  signOut: () => void;
  syncNow: () => void;

  // ── scan → home goal transfer ────────────────────────────────
  /** Publish a new transfer; returns its revision (strictly increasing). */
  setPendingScanGoals: (goals: Intent[]) => number;
  /** Consume exactly the publication at `expectedRevision`, once. */
  consumePendingScanGoals: (expectedRevision: number) => boolean;
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
    // The streak is recorded server-side from the local calendar day only —
    // the client never sends a streak number. One call per migrated meal;
    // the RPC dedupes same-day repeats.
    const streakWrites = await Promise.all(
      missingRemotely.map((e) => recordStreakDay(e.cookedAt))
    );
    if (streakWrites.some((w) => !w.ok)) useRuchi.setState({ syncError: true });
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
    // Atomic single-set boundary: apply the new account AND neutralise every
    // piece of the previous owner's personal state in one `set()`, so
    // persistence never snapshots an intermediate "B signed in but still
    // seeing A's name / prefs / nudges / history" state.
    //
    // Every field here is owner-scoped. `prefs` and `notificationTypePrefs`
    // matter as much as nudges: one account's diet, allergies and muted
    // notification types must never be read — or pushed — as another's. The
    // neutral defaults are deliberate: if B's profile cannot be read, B gets
    // an empty profile, never A's values.
    useRuchi.setState({
      account: user,
      localOwner: user.id,
      name: "",
      prefs: DEFAULT_PREFS,
      inventory: [],
      history: [],
      lastCookedAt: undefined,
      cloudSyncAt: undefined,
      cloudStats: null,
      recentCooked: [],
      nudges: [],
      lastNudges: {},
      notificationChannels: {},
      notificationTypePrefs: {},
      attention: { lastShown: null, suppressionUntil: null },
      pausedCooking: null,
      cookingSessionToken: null,
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
    // Only B's OWN server state ever lands here. The identity/prefs defaults
    // from the boundary above remain in place when a read fails, so a failed
    // profile fetch yields an empty profile rather than A's leftovers.
    const patch: Partial<RuchiState> = {
      cloudSyncAt: Date.now(),
      syncError: !(profile.ok && meals.ok),
      history: meals.ok ? meals.data : [],
      lastCookedAt: meals.ok && meals.data[0] ? meals.data[0].cookedAt : undefined,
      cloudStats: stats.ok ? stats.data : null,
      recentCooked: recent.ok ? recent.data : [],
      notificationChannels: notifPrefs.ok ? (notifPrefs.data?.channels ?? {}) : {},
      notificationTypePrefs: notifPrefs.ok ? (notifPrefs.data?.typePrefs ?? {}) : {},
      prefs: profile.ok && profile.data?.prefs ? profile.data.prefs : DEFAULT_PREFS,
      name: profile.ok ? (profile.data?.displayName ?? "") : "",
    };
    useRuchi.setState(patch);
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
      localOwner: null,
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

      pendingScanGoals: [],
      pendingScanGoalsRevision: 0,
      pendingScanGoalsConsumed: false,

      // ── identity + reset paths ──────────────────────────────────
      setName: (n: string) => {
        set({ name: n });
        scheduleProfilePush(get);
      },

      addItem: (ingredientId: string) => {
        if (get().inventory.some((i) => i.ingredientId === ingredientId)) return;
        const item: KitchenItem = { id: makeId(), ingredientId, addedAt: Date.now() };
        set({ inventory: [...get().inventory, item] });
        track("ingredient_added", { ingredientId });
        mirrorKitchenToServer(get());
      },

      removeItem: (ingredientId: string) => {
        set({ inventory: get().inventory.filter((i) => i.ingredientId !== ingredientId) });
        mirrorKitchenToServer(get());
      },

      setItemExpiry: (ingredientId: string, expiresAt?: number) => {
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

      setPrefs: (p: Partial<UserPreferences>) => {
        set({ prefs: { ...get().prefs, ...p } });
        scheduleProfilePush(get);
      },

      logCookedMeal: (entry: Omit<MealHistoryEntry, "id" | "cookedAt">) => {
        const full: MealHistoryEntry = {
          ...entry,
          id: makeId(),
          cookedAt: Date.now(),
        };
        const existingIndex = get().history.findIndex(
          (e) => e.recipeId === full.recipeId && dayKeyOf(e.cookedAt) === dayKeyOf(full.cookedAt)
        );
        if (existingIndex >= 0) {
          set({
            history: get().history.map((e, i) => (i === existingIndex ? full : e)),
          });
        } else {
          set({ history: [full, ...get().history].slice(0, 200) });
        }
        mirrorLastActionToServer(get(), { kind: "start_cooking", recipeId: full.recipeId, at: full.cookedAt });

        if (get().account) {
          const token = get().cookingSessionToken ?? makeSessionToken();
          // Persist a defensively minted token so a retry/double-click of the
          // SAME cook reuses it instead of minting a second session.
          if (get().cookingSessionToken !== token) set({ cookingSessionToken: token });
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

      upsertNudges: (incoming: NudgeEvent[]) => {
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

      resetAll: (opts?: { keepKitchen?: boolean }) =>
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

      setNotificationChannel: (channel: NotificationChannel, enabled: boolean) => {
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

      setNotificationType: (type: NotificationOpportunityType, enabled: boolean) => {
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

      markAttentionShown: (
        type: import("@/lib/context/attention").AttentionType,
        recipeId?: string,
      ) => {
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

      pauseCookingSession: (recipeId: string, stepIndex: number, stepCount: number) => {
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

      beginCookingSession: () => set({ cookingSessionToken: makeSessionToken() }),

      _makeSessionToken: () => makeSessionToken(),

      // test-only escape hatch — resets every on-device nudge field through
      // the real action, for deterministic pre-transition setup. Not exported
      // publicly — nudges are a first-party feature and there is no product
      // action that wipes them independently of an ownership change.
      resetNudgeTestKit: () =>
        set({ nudges: [] as NudgeEvent[], lastNudges: {} as Partial<Record<NudgeKind, number>> }),

      // ── auth actions (real Supabase-backed paths) ─────────────────
      signIn: async (email: string, password: string) => {
        set({ authError: null });
        const outcome = await sbSignIn(email, password);
        if (outcome.status !== "signed-in") {
          set({ authError: outcome.reason });
          return "failed";
        }
        await handleSignedIn(outcome.user, get().localOwner ?? null);
        return "signed-in";
      },

      signUp: async (email: string, password: string) => {
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

      requestPasswordReset: async (email: string) => {
        set({ authError: null });
        const outcome = await sbRequestPasswordReset(email);
        if (outcome.status === "failed") {
          set({ authError: outcome.reason });
          return "failed";
        }
        return "sent";
      },

      setNewPassword: async (newPassword: string) => {
        set({ authError: null });
        const outcome = await sbCompletePasswordReset(newPassword);
        if (outcome.status === "failed") {
          set({ authError: outcome.reason });
          return "failed";
        }
        set({ recoveryMode: false });
        return "updated";
      },

      dismissConfirmationNotice: () => set({ pendingConfirmationEmail: null }),

      dismissRecovery: () => set({ recoveryMode: false, authError: null }),

      consumeRecoveryRedirect: () => {
        const { recovery } = sbConsumeRecoveryRedirect();
        if (!recovery) return;
        set({ recoveryMode: true });
        void useScreen.getState().go("profile", { recipeId: undefined });
      },

      setPendingScanGoals: (goals: Intent[]) => {
        const revision = get().pendingScanGoalsRevision + 1;
        set({
          pendingScanGoals: [...goals],
          pendingScanGoalsRevision: revision,
          pendingScanGoalsConsumed: false,
        });
        return revision;
      },

      consumePendingScanGoals: (expectedRevision: number) => {
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
      const existing = useRuchi.getState().account;
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
        localOwner: existing ? `anon:${existing.id}` : null,
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

// ── module-level helpers used by tests and screens ──────────────

/** Whose on-device leftovers currently live in localStorage. `null` = fresh device or nothing cooked yet. */
export function localOwnerLabel(latest: AccountUser | null, localOwner: LocalOwner): string {
  if (!localOwner) return "No account on this device yet";
  if (latest && localOwner === latest.id) return `Signed in as ${latest.displayName ?? latest.email}`;
  return localOwner.startsWith("anon:")
    ? `Signed out — leftovers from ${localOwner.slice(5)} still on device`
    : `Signed out — leftovers from ${localOwner} still on device`;
}

// ── pure helpers (exported so screens/tests never import brand names) ──

export function mealKey(e: Pick<MealHistoryEntry, "recipeId" | "cookedAt">): string {
  return `${e.recipeId}|${dayKeyOf(e.cookedAt)}`;
}

/**
 * The local-calendar 9pm cutoff RUCHI uses for streak semantics. RUCHI treats
 * any cook logged before 9pm IST as "today", so a 7:45pm cook counts for the
 * current streak day, but a 9:10pm cook counts for tomorrow.
 */
export function eatLine(nowMs: number): number {
  const t = new Date(nowMs);
  t.setHours(21, 0, 0, 0);
  return t.getTime();
}

export function computeStreak(hist: MealHistoryEntry[], now = Date.now()): number {
  const cutoffMs = eatLine(now);
  // Days that count: a cook after that day's 9pm line belongs to the next
  // day, and anything logged in the future (clock skew) never counts.
  const daysWithMeals = new Set<string>();
  for (const e of hist) {
    if (e.cookedAt > cutoffMs) continue;
    daysWithMeals.add(dayKeyOf(e.cookedAt));
  }

  const cursor = new Date(now);
  cursor.setHours(21, 0, 0, 0);

  // Today is still open: if nothing was cooked today yet, the streak is
  // anchored to yesterday instead of collapsing to zero at midnight.
  if (!daysWithMeals.has(dayKeyOf(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!daysWithMeals.has(dayKeyOf(cursor.getTime()))) return 0;
  }

  let length = 0;
  while (length < 366 && daysWithMeals.has(dayKeyOf(cursor.getTime()))) {
    length++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return length;
}

/**
 * A stable, read-only view of this device's cook history, shaped for the
 * profile widgets. Computed locally from the same history atom the rest of
 * the app reads, so the server can never invent a streak the device did not
 * already see or defend against.
 */
export function weeklyProgress(s: Pick<RuchiState, "history">) {
  const week = [];
  let weekMeals = 0;
  let saved = 0;
  let protein = 0;
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayStart = d.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    const dayMeals = s.history.filter(
      (m) => m.cookedAt >= dayStart && m.cookedAt <= dayEnd.getTime()
    );
    weekMeals += dayMeals.length;
    // Only defensible savings count: a meal's own comparison must be positive.
    // Anything else contributes nothing rather than an invented number.
    for (const m of dayMeals) {
      const delta = defensibleSavings(m.cost, m.deliveryCompareCost);
      if (delta !== null) saved += delta;
      protein += m.proteinG;
    }
    week.push({ date: dayStart, meals: dayMeals.length });
  }

  return {
    week,
    meals: weekMeals,
    saved,
    protein,
    timesCooked: s.history.length,
    recipesCooked: new Set(s.history.map((h) => h.recipeId)).size,
  };
}

/** Current local-calendar streak, read from the store's own history atom. */
export function streak(s: Pick<RuchiState, "history">, now = Date.now()): number {
  return computeStreak(s.history, now);
}

export function computedStreakViaHistory(s: Pick<RuchiState, "history">, now = Date.now()): number {
  return computeStreak(s.history, now);
}

// ── auth flow derivation (so the launch screen can render the honest flow) ──

export type AuthFlowState =
  | "initializing"
  | "authenticated"
  | "recovery"
  | "confirmation-required"
  | "unauthenticated";

export function deriveAuthFlowState(s: Pick<RuchiState, "authReady" | "account" | "recoveryMode" | "pendingConfirmationEmail">): AuthFlowState {
  // A recovery link outranks init: routing it to a sign-in form would discard
  // the session the link just established.
  if (s.recoveryMode) return "recovery";
  if (!s.authReady) return "initializing";
  if (s.pendingConfirmationEmail) return "confirmation-required";
  if (s.account) return "authenticated";
  return "unauthenticated";
}

// ── test-only escapes (not part of the product surface) ──────────

/**
 * Reset the auth listener guard so each test starts with a fresh listener
 * registration. The real `initAuthListener()` is a one-per-process singleton;
 * this only clears the guard so the next call in the same process re-runs the
 * setup the tests want to observe.
 */
export function resetAuthListenerForTests(): void {
  authListenerAttached = false;
}

/**
 * Plants a cooking-session token on the running store so the cooking-stats
 * tests can control session identity without touching real Supabase. Not part
 * of the product surface — real sessions come from `logCookedMeal`.
 */
export function setSessionTokenForTests(token: string | null): void {
  useRuchi.setState({ cookingSessionToken: token });
}

/**
 * A thin wrapper around `logCookedMeal` + session-token setup used by the
 * cooking-stats tests so they can exercise the full "cook -> server -> stats"
 * path without wiring a real Supabase session.
 */
export async function beginCookingSessionForTests(recipe: {
  id: string;
  name: string;
  servings: number;
  proteinG: number;
  calories: number;
  cost: number;
  deliveryCompareCost: number;
}): Promise<void> {
  useRuchi.setState({ cookingSessionToken: makeSessionToken() });
  useRuchi.getState().logCookedMeal({
    recipeId: recipe.id,
    recipeName: recipe.name,
    servings: recipe.servings,
    proteinG: recipe.proteinG,
    calories: recipe.calories,
    cost: recipe.cost,
    deliveryCompareCost: recipe.deliveryCompareCost,
  });
}
