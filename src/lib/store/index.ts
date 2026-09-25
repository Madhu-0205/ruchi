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
  type NotificationChannel,
  fetchProfile,
  insertCompletedMeals,
  recordCookingCompletion,
  recordStreakDay,
  upsertProfile,
  type CookingStatsRow,
} from "@/lib/auth/supabase-data";

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

/**
 * Whose data currently lives in localStorage. `null` = fresh device or
 * nothing cooked yet. `anon:<userId>` = that user cooked here while
 * signed out (their data — safe to merge when they sign back in).
 * `<userId>` = signed in as that user.
 */
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
  /** True when the last cloud write/read failed — Profile shows a gentle note. */
  syncError: boolean;
  /** Auth failure kind for honest, non-technical error copy. */
  authError: AuthFailure | null;
  /**
   * True while the user is inside a password-recovery session (arrived
   * via a reset email link). In-memory only — never persisted, and
   * cleared on sign-out or once a new password is set.
   */
  recoveryMode: boolean;
  /**
   * Email awaiting confirmation after sign-up (when the project has
   * email confirmation enabled). In-memory only: a fresh page load has
   * no pending sign-up, so the state is honest by construction.
   */
  pendingConfirmationEmail: string | null;
  /**
   * True once the user chose to continue without an account from the
   * welcome screen. In-memory only — anonymous-first: the whole app
   * works this way, the flag only controls the welcome gate.
   */
  guestMode: boolean;
  /**
   * True once the initial session check has settled — signed in, signed
   * out, or Supabase unconfigured. Screens gate auth forms on this so a
   * late-restoring session never swaps a mounted form out from under
   * the user's typing. In-memory only: every page load re-checks.
   */
  authReady: boolean;
  /** Whose data currently lives in localStorage (see LocalOwner doc). */
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
  /** Ask Supabase to email a reset link. "sent" = request accepted. */
  requestPasswordReset: (
    email: string,
  ) => Promise<"sent" | "failed">;
  /** Apply the new password inside a recovery session. */
  setNewPassword: (newPassword: string) => Promise<"updated" | "failed">;
  /** Leave the set-new-password card without saving (back to sign-in). */
  dismissRecovery: () => void;
  /** Dismiss the "check your email" confirmation notice. */
  dismissConfirmationNotice: () => void;
  /** Enter the app without an account (anonymous-first). */
  enterGuestMode: () => void;
  /** Detect + consume a recovery redirect once at startup. */
  consumeRecoveryRedirect: () => void;
  signOut: () => void;
  /** Retry any pending cloud mirror (also used by "Back up now"). */
  syncNow: () => void;
  /**
   * Begin a cooking session: ensures a fresh per-session idempotency
   * token exists. Safe to call repeatedly (StrictMode double-mounts
   * keep the same token); the token is consumed when its completion is
   * recorded server-side.
   */
  beginCookingSession: () => void;
  /** Server-derived cooking stats (null until first successful sync). */
  cloudStats: CookingStatsRow | null;
  /** Recent cooked meals from the server completions log (newest first). */
  recentCooked: MealHistoryEntry[];
  /**
   * Re-attention suppression state — when a context was last shown (and
   * which one), plus a global mute window after a dismissal. Persisted
   * with the profile so frequency control survives refreshes; NOT the
   * source of truth for anything the user sees as "their data".
   */
  attention: { lastShown: { type: import("@/lib/context/attention").AttentionType; recipeId?: string; at: number } | null; suppressionUntil: number | null };
  /** The user paused mid-cook: recipe + step, for a real Resume context. */
  pausedCooking: { recipeId: string; stepIndex: number; stepCount: number; pausedAt: number } | null;
  /** Notification opt-in flags (server-backed; defaults OFF). */
  notificationChannels: Partial<Record<NotificationChannel, boolean>>;
  /** Toggle one notification channel (opt-in is always explicit). */
  setNotificationChannel: (channel: NotificationChannel, enabled: boolean) => void;
  /** Record that a re-attention context was shown (drives cooldowns). */
  markAttentionShown: (type: import("@/lib/context/attention").AttentionType, recipeId?: string) => void;
  /** User dismissed a re-attention moment — mute everything briefly. */
  dismissAttention: () => void;
  /** Called when the user exits cooking mid-recipe (real paused session). */
  pauseCookingSession: (recipeId: string, stepIndex: number, stepCount: number) => void;
  /** Cleared on resume or completion — never faked. */
  clearPausedCooking: () => void;
  /** Per-cooking-session idempotency token (in-memory only, not persisted). */
  cookingSessionToken: string | null;
  /** Set by tests; real callers use the crypto.randomUUID default. */
  _makeSessionToken: () => string;
}

// ── Cooking-session idempotency ──────────────────────────────
// Each cooking session (one run through Cooking Mode) gets ONE opaque
// token, generated when the session begins. Every completion write for
// that session — however many times the completion action fires —
// carries the SAME token, and the server deduplicates on it. A duplicate
// returns 'duplicate' and writes nothing; the client keeps its local
// celebration regardless. The token is consumed once the server records
// it, so the next session starts fresh.
let sessionTokenOverride: string | null = null;

function makeSessionToken(): string {
  if (sessionTokenOverride) return sessionTokenOverride;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Older browsers: timestamp + entropy is sufficient for a per-session id.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Test seam: pin the session token so idempotency is deterministically assertable. */
export function setSessionTokenForTests(token: string | null): void {
  sessionTokenOverride = token;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Meals are deduped by recipe + local calendar day, in both directions. */
function mealKey(e: Pick<MealHistoryEntry, "recipeId" | "cookedAt">): string {
  return `${e.recipeId}|${dayKeyOf(e.cookedAt)}`;
}

// ── Cloud sync helpers (module scope: debounce across actions) ──

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

/**
 * Mirror local meals → cloud and pull cloud meals → local, deduped by
 * (recipeId, day). Anonymous progress migrates exactly once; nothing is
 * ever deleted on either side. Streak RPC fires for newly pushed days
 * (idempotent per day server-side).
 */
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

  // 1) Local meals the cloud hasn't seen → insert (migration / retry).
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

  // 2) Cloud meals this device hasn't seen → fill in locally (new device).
  const freshLocally = remoteEntries.filter((e) => !localKeys.has(mealKey(e)));

  if (pushedDays.length > 0) {
    for (const day of pushedDays) {
      // p_local_date is "YYYY-MM-DD" — RPC is idempotent per day.
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

  // Real Cooking Stats: refresh the server-derived aggregates after every
  // sync so Profile always shows numbers computed from the records.
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

/**
 * Sign-in reconciliation. Ownership rules (documented behavior):
 * - localOwner === user.id or `anon:<user.id>` → this device holds that
 *   user's own (possibly anonymous) data → merge into their account.
 * - localOwner === null → fresh/nothing cooked → just pull their cloud.
 * - localOwner belongs to a DIFFERENT user → shared-device case: do NOT
 *   push this device's data into the new account; replace local state
 *   with their cloud data instead (previous user's synced data is safe
 *   in their own account; unsynced-only local data is left behind).
 */
/**
 * Land on Home after every auth transition (sign-in, guest entry, page
 * restore). The screen router is in-memory, so a stale "profile" or
 * "meal" position must never become the entry screen of a session that
 * just changed identity.
 */
function resetScreenToHome(): void {
  useScreen.setState({ screen: "home", recipeId: undefined, cameFrom: undefined, history: [] });
}

async function handleSignedIn(user: AccountUser, localOwner: LocalOwner): Promise<void> {
  const ownsLocal = localOwner === null || localOwner === user.id || localOwner === `anon:${user.id}`;

  // Every signed-in entry point lands on Home — never a stale screen.
  resetScreenToHome();

  if (!ownsLocal) {
    // Different user's device state → load their cloud data fresh. Set
    // identity first so the signed-in UI swaps immediately; data follows.
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

  // Fill in from cloud what's missing locally — never overwrite local.
  const profile = await fetchProfile();
  if (profile.ok && profile.data) {
    const s = useRuchi.getState();
    const patch: Partial<RuchiState> = {};
    if (!s.name && profile.data.displayName) patch.name = profile.data.displayName;
    // Adopt cloud prefs only when local is untouched defaults (no signal).
    if (profile.data.prefs && JSON.stringify(s.prefs) === JSON.stringify(DEFAULT_PREFS)) {
      patch.prefs = profile.data.prefs;
    }
    if (Object.keys(patch).length > 0) useRuchi.setState(patch);
  }

  await syncMeals(useRuchi.getState); // pushes local (migration) + pulls remote
  // Notification prefs hydrate inside syncMeals — no second round-trip.
  // Keep the profile row in step with any local identity/prefs the user
  // had before signing in (e.g. name typed anonymously).
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
      cookingSessionToken: null,
      syncError: false,
      authError: null,
      authReady: false,
      recoveryMode: false,
      pendingConfirmationEmail: null,
      guestMode: false,
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
        // One token per session; reused across retries of the completion
        // action until the server accepts it, then cleared for the next run.
        if (!get().cookingSessionToken && !sessionTokenOverride) {
          set({ cookingSessionToken: makeSessionToken() });
        }
      },

      // ── Re-attention frequency control ──────────────────────
      markAttentionShown: (type, recipeId) => {
        const attention = { lastShown: { type, recipeId, at: Date.now() }, suppressionUntil: null };
        set({ attention });
        // Mirror to the server (fire-and-forget) so a future notification
        // cron never duplicates what in-app Home already showed. Update is
        // a no-op when no prefs row exists (opt-in stays explicit).
        if (get().account) {
          void pushAttentionState(attention);
        }
      },

      dismissAttention: () => {
        // Short global mute after an explicit dismissal — respects the
        // user's "not now" without punishing them later.
        const attention = { ...get().attention, suppressionUntil: Date.now() + 2 * 60 * 60 * 1000 };
        set({ attention });
        if (get().account) {
          void pushAttentionState(attention);
        }
      },

      // ── Notification opt-in (explicit, server-backed) ────────
      setNotificationChannel: (channel, enabled) => {
        const notificationChannels = { ...get().notificationChannels, [channel]: enabled };
        set({ notificationChannels });
        if (get().account) {
          void upsertNotificationChannels({ [channel]: enabled }).then((r) => {
            if (!r.ok) useRuchi.setState({ syncError: true });
          });
        }
      },

      // ── Incomplete cooking session (real, never fabricated) ─
      pauseCookingSession: (recipeId, stepIndex, stepCount) => {
        set({ pausedCooking: { recipeId, stepIndex, stepCount, pausedAt: Date.now() } });
      },

      clearPausedCooking: () => {
        set({ pausedCooking: null });
      },

      logCookedMeal: (entry) => {
        const e: MealHistoryEntry = { ...entry, id: makeId(), cookedAt: Date.now() };
        set({
          history: [e, ...get().history].slice(0, 200),
          lastCookedAt: e.cookedAt,
          // localOwner is deliberately untouched: unclaimed anonymous
          // progress stays `null` (merges into whoever signs in here);
          // after a sign-out it's already `anon:<userId>` (re-joins that
          // user). AI/other flows never write ownership.
        });
        track("cooking_completed", { recipeId: entry.recipeId, servings: entry.servings });
        if (get().account) {
          // Real Cooking Stats: one server-authoritative completion record
          // per cooking session. Every retry of this action carries the
          // SAME session token, so repeated clicks dedupe server-side; the
          // token is cleared only once the server has accepted the record
          // ('recorded' — a 'duplicate' reply also consumes the stale
          // token only if it matches this session's). Fire-and-forget;
          // syncNow retries after a failure.
          const token = get().cookingSessionToken ?? makeSessionToken();
          const mirror = syncMeals(get); // existing mirror; syncNow retries
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
            // The mirror's success path clears syncError; settle it first so
            // a stats/completion failure can't be silently un-flagged.
            await mirror.catch(() => {});
            if (!r.ok) {
              useRuchi.setState({ syncError: true });
              return; // token survives — the retry reuses it
            }
            if (r.data === "recorded") {
              // Consumed: the next cooking session must get a fresh token.
              if (useRuchi.getState().cookingSessionToken === token) {
                useRuchi.setState({ cookingSessionToken: null });
              }
            }
            // Refresh the server-derived aggregates once the record lands.
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
          // keep: name, prefs, account — identity and preferences survive
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
        // The onAuthChange listener normally drives reconciliation; run it
        // here too so the caller's await covers the merge.
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
          // Honest state: the account row exists, the session does not.
          // The welcome screen explains the next step until confirmed.
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
        // Recovery session has served its purpose.
        set({ recoveryMode: false });
        return "updated";
      },

      consumeRecoveryRedirect: () => {
        const { recovery } = sbConsumeRecoveryRedirect();
        if (recovery) set({ recoveryMode: true });
      },

      dismissRecovery: () => set({ recoveryMode: false, authError: null }),

      dismissConfirmationNotice: () => set({ pendingConfirmationEmail: null }),

      enterGuestMode: () => {
        resetScreenToHome();
        set({ guestMode: true });
      },

      signOut: () => {
        const prev = get().account;
        void sbSignOut();
        // Mark remaining local data as that user's anonymous leftovers so
        // signing back in re-syncs it instead of duplicating it.
        set({
          account: null,
          cloudSyncAt: undefined,
          cloudStats: null,
      recentCooked: [],
      attention: { lastShown: null, suppressionUntil: null },
      pausedCooking: null,
      notificationChannels: {}, // stats are user-scoped — never leak across identities
          syncError: false,
          authError: null,
          recoveryMode: false,
          pendingConfirmationEmail: null,
          guestMode: false,
          localOwner: prev ? `anon:${prev.id}` : null,
        });
      },

      syncNow: () => {
        void syncMeals(get);
        scheduleProfilePush(get);
      },

      /** Test seam: pin the per-session idempotency token. */
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
        nudges: s.nudges,
        lastNudges: s.lastNudges,
        lastCookedAt: s.lastCookedAt,
        localOwner: s.localOwner,
      }),
    },
  ),
);

// ── Auth listener (browser only; the store module is imported client-side) ──
// One subscription drives session restore after refresh, sign-outs from
// other tabs, and user switches — no duplicated session state.

let authListenerAttached = false;

/**
 * Attach the auth listener + run the initial session probe. Runs at most
 * once per page load; flips `authReady` when the check settles so UI can
 * mount auth forms without risking a mid-typing swap. Split from the
 * module body so it stays testable in Node (no import side effects).
 */
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
      notificationChannels: {}, // stats are user-scoped — never leak across identities
        syncError: false,
        localOwner: `anon:${s.account.id}`,
      });
    } else if (user && s.account?.id === user.id) {
      // Same user re-emitted (token refresh) — nothing to do.
    }
  });
  // Session restore on load: pick up an existing Supabase session even if
  // the listener's INITIAL_SESSION fired before hydration of localOwner.
  void sbCurrentUser()
    .then((u) => {
      if (!u) return;
      const s = useRuchi.getState();
      if (s.account?.id !== u.id) void handleSignedIn(u, s.localOwner ?? null);
    })
    .finally(() => {
      // The initial check has settled — signed in, signed out, or the probe
      // failed. Either way the auth UI can now show its real state.
      useRuchi.setState({ authReady: true });
    });
}

if (typeof window !== "undefined") {
  initAuthListener();
  // A recovery email link (Supabase → this origin) enters the app here:
  // detect + consume once at startup so the Profile card can offer the
  // set-new-password form. Scrubs tokens from the address bar.
  useRuchi.getState().consumeRecoveryRedirect();
}

/** Test hook: allow initAuthListener to run again in a fresh test. */
export function resetAuthListenerForTests(): void {
  authListenerAttached = false;
}

// ── Auth flow state machine (derived, not stored) ────────────
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
  | "unauthenticated-guest" // chose to continue without an account
  | "unauthenticated"; // welcome + sign-in/sign-up (also: just signed out)

export function deriveAuthFlowState(
  s: Pick<
    RuchiState,
    "authReady" | "account" | "recoveryMode" | "pendingConfirmationEmail" | "guestMode"
  >,
): AuthFlowState {
  if (s.recoveryMode) return "recovery";
  if (s.authReady && s.account) return "authenticated";
  if (s.authReady && s.pendingConfirmationEmail) return "confirmation-required";
  if (s.authReady && s.guestMode) return "unauthenticated-guest";
  if (s.authReady) return "unauthenticated";
  return "initializing";
}

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
