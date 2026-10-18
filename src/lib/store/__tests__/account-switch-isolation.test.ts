// ─────────────────────────────────────────────────────────────
// RUCHI — account-switch state isolation
// ─────────────────────────────────────────────────────────────
// A direct A → B sign-in must not expose (or upload) anything that belongs to
// A: display name, personal preferences, notification channels/type prefs,
// meals, kitchen, nudges or paused cooking. These tests drive the real
// `signIn` → `handleSignedIn` path with a mocked data layer, including the
// case where B's profile read FAILS — B must then get an empty profile, never
// A's values.
//
// The same boundary must stay asymmetric: a same-owner return and a guest →
// account migration keep the on-device values (and push them), because those
// values already belong to the signing-in owner.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPreferences } from "@/lib/types";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
});

type Profile = { displayName?: string | null; prefs?: UserPreferences };
type NotifPrefs = {
  channels?: Record<string, boolean>;
  typePrefs?: Record<string, boolean>;
};

const h = vi.hoisted(() => {
  const state = {
    nextUser: { id: "user-a", email: "asha@ruchi.test", displayName: "Asha" },
    profiles: {} as Record<string, Profile | null>,
    notifications: {} as Record<string, NotifPrefs | null>,
    failProfile: false,
    upserts: [] as Array<{ displayName: string | null; prefs: UserPreferences }>,
  };
  return { state };
});

vi.mock("@/lib/engine/analytics", () => ({ track: vi.fn() }));

vi.mock("@/lib/auth/supabase-auth", () => ({
  currentUser: async () => null,
  onAuthChange: () => null,
  signIn: async () => ({ status: "signed-in", user: h.state.nextUser }),
  signUp: async () => ({ status: "signed-in", user: h.state.nextUser }),
  signOut: async () => {},
  requestPasswordReset: async () => ({ status: "sent" }),
  completePasswordReset: async () => ({ status: "updated" }),
  consumeRecoveryRedirect: () => ({ recovery: false, email: null }),
}));

vi.mock("@/lib/auth/supabase-data", () => ({
  fetchProfile: async () =>
    h.state.failProfile
      ? { ok: false as const, reason: "error" as const }
      : { ok: true as const, data: h.state.profiles[h.state.nextUser.id] ?? null },
  upsertProfile: async (patch: { displayName: string | null; prefs: UserPreferences }) => {
    h.state.upserts.push(patch);
    return { ok: true as const, data: null };
  },
  fetchCompletedMeals: async () => ({ ok: true as const, data: [] }),
  insertCompletedMeals: async () => ({ ok: true as const, data: null }),
  recordStreakDay: async () => ({ ok: true as const, data: null }),
  recordCookingCompletion: async () => ({ ok: true as const, data: "recorded" as const }),
  fetchCookingStats: async () => ({ ok: true as const, data: null }),
  fetchRecentCookedMeals: async () => ({ ok: true as const, data: [] }),
  fetchNotificationPrefs: async () => ({
    ok: true as const,
    data: h.state.notifications[h.state.nextUser.id] ?? null,
  }),
  pushAttentionState: async () => ({ ok: true as const, data: null }),
  upsertNotificationChannels: async () => ({ ok: true as const, data: null }),
  upsertNotificationTypePrefs: async () => ({ ok: true as const, data: null }),
  markNotificationEngaged: async () => ({ ok: true as const, data: null }),
  pushKitchenMirror: async () => ({ ok: true as const, data: null }),
  pushPausedSession: async () => ({ ok: true as const, data: null }),
  pushLastAction: async () => ({ ok: true as const, data: null }),
}));

import { useRuchi } from "../index";

const A = { id: "user-a", email: "asha@ruchi.test", displayName: "Asha" };
const B = { id: "user-b", email: "bhavya@ruchi.test", displayName: "Bhavya" };

const A_PREFS: UserPreferences = {
  diet: "non-vegetarian",
  allergies: ["peanut"],
  fitnessGoal: "high-protein",
  skill: "confident",
  defaultServings: 4,
  budget: 200,
  cuisines: ["Indian", "Thai"],
  equipment: ["stove", "oven"],
};

const B_PREFS: UserPreferences = {
  diet: "vegetarian",
  allergies: [],
  fitnessGoal: "weight-loss",
  skill: "beginner",
  defaultServings: 1,
  budget: 50,
  cuisines: ["Indian"],
  equipment: ["stove", "pan"],
};

const BASE_PREFS = useRuchi.getState().prefs;

const signInAs = async (user: typeof A) => {
  h.state.nextUser = user;
  const outcome = await useRuchi.getState().signIn(user.email, "hunter2hunter2");
  expect(outcome).toBe("signed-in");
};

const flush = () => vi.advanceTimersByTimeAsync(5000);

beforeEach(() => {
  vi.useFakeTimers();
  h.state.nextUser = A;
  h.state.profiles = {};
  h.state.notifications = {};
  h.state.failProfile = false;
  h.state.upserts = [];

  if (useRuchi.getState().account) useRuchi.getState().signOut();
  vi.clearAllTimers();
  useRuchi.setState({
    account: null,
    localOwner: null,
    name: "",
    prefs: BASE_PREFS,
    history: [],
    inventory: [],
    nudges: [],
    lastNudges: {},
    notificationChannels: {},
    notificationTypePrefs: {},
    cloudStats: null,
    recentCooked: [],
    syncError: false,
    authError: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("A → B account switch", () => {
  it("replaces A's name, preferences and notification settings with B's", async () => {
    h.state.profiles[A.id] = { displayName: "Asha", prefs: A_PREFS };
    await signInAs(A);
    await flush();

    // A's device-level state, including a scheduled profile write.
    useRuchi.getState().setName("Asha Local");
    useRuchi.getState().setPrefs({ budget: 200, allergies: ["peanut"] });
    useRuchi.setState({
      notificationChannels: { email: true },
      notificationTypePrefs: { resume_cooking: false },
      nudges: [
        {
          id: "n1",
          kind: "habit",
          title: "Cook tonight?",
          body: "Something quick.",
          createdAt: 1,
          read: false,
        },
      ],
      lastNudges: { habit: 1 },
    });

    h.state.profiles[B.id] = { displayName: "Bhavya", prefs: B_PREFS };
    h.state.notifications[B.id] = {
      channels: { web_push: true },
      typePrefs: { cook_again: false },
    };
    h.state.upserts = [];

    await signInAs(B);
    await flush();

    const s = useRuchi.getState();
    expect(s.account?.id).toBe(B.id);
    expect(s.name).toBe("Bhavya");
    expect(s.prefs).toEqual(B_PREFS);
    expect(s.prefs.allergies).toEqual([]);
    expect(s.notificationChannels).toEqual({ web_push: true });
    expect(s.notificationTypePrefs).toEqual({ cook_again: false });
    expect(s.nudges).toEqual([]);
    expect(s.lastNudges).toEqual({});
    // A's pending write was retired, not re-attributed to B.
    expect(h.state.upserts).toEqual([]);
  });

  it("clears A's attention, paused cook and cooking-session token", async () => {
    h.state.profiles[A.id] = { displayName: "Asha", prefs: A_PREFS };
    await signInAs(A);
    await flush();

    // Establish A's session-scoped state through the real actions.
    useRuchi.getState().markAttentionShown("return_visit", "paneer-egg-bhurji");
    useRuchi.getState().pauseCookingSession("paneer-egg-bhurji", 2, 6);
    useRuchi.getState().beginCookingSession();
    const a = useRuchi.getState();
    expect(a.attention.lastShown?.type).toBe("return_visit");
    expect(a.pausedCooking?.stepIndex).toBe(2);
    expect(a.cookingSessionToken).toBeTruthy();

    h.state.profiles[B.id] = { displayName: "Bhavya", prefs: B_PREFS };
    await signInAs(B);
    await flush();

    const s = useRuchi.getState();
    expect(s.attention).toEqual({ lastShown: null, suppressionUntil: null });
    expect(s.pausedCooking).toBeNull();
    expect(s.cookingSessionToken).toBeNull();
  });

  it("gives B an empty profile — never A's values — when B's profile read fails", async () => {
    h.state.profiles[A.id] = { displayName: "Asha", prefs: A_PREFS };
    await signInAs(A);
    await flush();

    useRuchi.getState().setName("Asha Local");
    useRuchi.getState().setPrefs({ budget: 200 });
    useRuchi.setState({
      notificationChannels: { email: true },
      notificationTypePrefs: { resume_cooking: false },
    });
    h.state.upserts = [];

    h.state.failProfile = true;
    await signInAs(B);
    await flush();

    const s = useRuchi.getState();
    expect(s.account?.id).toBe(B.id);
    expect(s.name).toBe("");
    expect(s.prefs).toEqual(BASE_PREFS);
    expect(s.notificationChannels).toEqual({});
    expect(s.notificationTypePrefs).toEqual({});
    expect(h.state.upserts).toEqual([]);
  });
});

describe("state that must be preserved", () => {
  it("same-owner return keeps the owner's local name and preferences", async () => {
    h.state.profiles[A.id] = { displayName: "Asha", prefs: A_PREFS };
    await signInAs(A);
    await flush();

    useRuchi.getState().setName("Asha Local");
    useRuchi.getState().setPrefs({ budget: 150 });
    await flush();
    useRuchi.getState().signOut();

    await signInAs(A);
    await flush();

    expect(useRuchi.getState().name).toBe("Asha Local");
    expect(useRuchi.getState().prefs.budget).toBe(150);
  });

  it("same-owner re-entry keeps attention, paused cook and session token", async () => {
    h.state.profiles[A.id] = { displayName: "Asha", prefs: A_PREFS };
    await signInAs(A);
    await flush();

    useRuchi.getState().markAttentionShown("return_visit", "paneer-egg-bhurji");
    useRuchi.getState().pauseCookingSession("paneer-egg-bhurji", 2, 6);
    useRuchi.getState().beginCookingSession();
    const token = useRuchi.getState().cookingSessionToken;

    // Session restore for the SAME owner: this device's leftovers are already
    // attributed to A, so the boundary must not wipe A's own session.
    useRuchi.setState({ account: null, localOwner: A.id });
    await signInAs(A);
    await flush();

    const s = useRuchi.getState();
    expect(s.account?.id).toBe(A.id);
    expect(s.attention.lastShown?.type).toBe("return_visit");
    expect(s.pausedCooking?.recipeId).toBe("paneer-egg-bhurji");
    expect(s.cookingSessionToken).toBe(token);
  });

  it("guest → account migration keeps and uploads the device's values", async () => {
    useRuchi.getState().setName("Guest Asha");
    useRuchi.getState().setPrefs({ budget: 150 });
    await flush();
    expect(h.state.upserts).toEqual([]); // signed out: never pushed

    h.state.profiles[A.id] = null; // brand-new account
    await signInAs(A);
    await flush();

    expect(useRuchi.getState().name).toBe("Guest Asha");
    expect(useRuchi.getState().prefs.budget).toBe(150);
    expect(h.state.upserts.at(-1)).toMatchObject({
      displayName: "Guest Asha",
      prefs: { budget: 150 },
    });
  });
});
