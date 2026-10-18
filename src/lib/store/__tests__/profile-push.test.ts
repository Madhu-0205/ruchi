// ─────────────────────────────────────────────────────────────
// RUCHI — profile-push debounce (cross-account race regression)
// ─────────────────────────────────────────────────────────────
// A profile write is delayed by 1200 ms. The account can change inside that
// window (sign-out, or a different user signing in), and during the new
// sign-in the store briefly holds the NEW account with the PREVIOUS owner's
// name and preferences still in place — the profile fetch may not have
// answered yet, or may have failed outright.
//
// These tests drive the real actions (signIn / signOut / setName / setPrefs)
// with fake timers, so the debounce window under test is the one that ships.
// They pin the contract: a write is only sent when the account that scheduled
// it is still active, and the payload is the captured one — never whatever
// `name`/`prefs` happen to hold when the timer fires. The owner boundary also
// resets those fields, so a failed profile read can never surface A's values
// as B's.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Persist middleware needs localStorage; the node env has none.
vi.hoisted(() => {
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
});

const h = vi.hoisted(() => {
  const state = {
    signInResult: null as null | {
      status: string;
      user: { id: string; email: string; displayName?: string };
    },
    profileData: null as null | { displayName?: string | null; prefs?: unknown },
    failProfile: false,
    upserts: [] as Array<{ displayName: string | null; prefs: unknown }>,
  };
  return { state };
});

vi.mock("@/lib/engine/analytics", () => ({ track: vi.fn() }));

vi.mock("@/lib/auth/supabase-auth", () => ({
  completePasswordReset: async () => ({ status: "ok" }),
  consumeRecoveryRedirect: () => false,
  currentUser: async () => null,
  onAuthChange: () => null,
  requestPasswordReset: async () => ({ status: "sent" }),
  signIn: async () => h.state.signInResult,
  signUp: async () => h.state.signInResult,
  signOut: async () => {},
}));

vi.mock("@/lib/auth/supabase-data", () => ({
  fetchProfile: async () =>
    h.state.failProfile
      ? { ok: false as const, reason: "error" as const }
      : { ok: true as const, data: h.state.profileData },
  upsertProfile: async (patch: { displayName: string | null; prefs: unknown }) => {
    h.state.upserts.push(patch);
    return { ok: true as const, data: null };
  },
  fetchCompletedMeals: async () => ({ ok: true as const, data: [] }),
  insertCompletedMeals: async () => ({ ok: true as const, data: null }),
  recordStreakDay: async () => ({ ok: true as const, data: null }),
  recordCookingCompletion: async () => ({ ok: true as const, data: "recorded" as const }),
  fetchCookingStats: async () => ({ ok: true as const, data: null }),
  fetchRecentCookedMeals: async () => ({ ok: true as const, data: [] }),
  fetchNotificationPrefs: async () => ({ ok: true as const, data: null }),
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
const BASE_PREFS = useRuchi.getState().prefs;

/** Sign in through the real action, which runs handleSignedIn. */
async function signInAs(user: typeof A): Promise<void> {
  h.state.signInResult = { status: "signed-in", user };
  const outcome = await useRuchi.getState().signIn(user.email, "hunter2hunter2");
  expect(outcome).toBe("signed-in");
}

/**
 * Sign in and let the sign-in settle. Nothing is recorded here on purpose:
 * a signed-in account with no cloud name or preferences schedules no write,
 * so the baseline is already clean and clearing it would only hide a stale
 * write that lands during the switch.
 */
async function arrive(user: typeof A): Promise<void> {
  await signInAs(user);
  await vi.advanceTimersByTimeAsync(2000);
}

beforeEach(() => {
  vi.useFakeTimers();
  h.state.signInResult = null;
  h.state.profileData = null;
  h.state.failProfile = false;
  h.state.upserts = [];

  // End any session a previous test left behind through the real action,
  // then restore the fresh-device baseline.
  if (useRuchi.getState().account) useRuchi.getState().signOut();
  vi.clearAllTimers();
  useRuchi.setState({
    account: null,
    localOwner: null,
    name: "",
    prefs: BASE_PREFS,
    cloudSyncAt: undefined,
    syncError: false,
    authError: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("profile push debounce", () => {
  it("writes a valid update for the same account after the debounce", async () => {
    await arrive(A);
    expect(h.state.upserts).toEqual([]);

    useRuchi.getState().setName("Asha R");
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.state.upserts).toEqual([]);

    await vi.advanceTimersByTimeAsync(200);
    expect(h.state.upserts).toHaveLength(1);
    expect(h.state.upserts[0]!.displayName).toBe("Asha R");
    expect(h.state.upserts[0]!.prefs).toMatchObject({ diet: "eggetarian" });
    expect(useRuchi.getState().cloudSyncAt).toBeGreaterThan(0);
    expect(useRuchi.getState().syncError).toBe(false);
  });

  it("cancels the pending write when the session ends before the timer fires", async () => {
    await arrive(A);

    useRuchi.getState().setName("Asha R");
    useRuchi.getState().signOut();
    await vi.advanceTimersByTimeAsync(5000);

    expect(h.state.upserts).toEqual([]);
    expect(useRuchi.getState().account).toBeNull();
  });

  it("never writes A's edit under B's account after a switch", async () => {
    await arrive(A);

    useRuchi.getState().setName("Asha R");
    useRuchi.getState().setPrefs({ budget: 150 });

    // B signs in inside the debounce window.
    await arrive(B);
    await vi.advanceTimersByTimeAsync(5000);

    expect(useRuchi.getState().account?.id).toBe(B.id);
    expect(h.state.upserts).toEqual([]);
  });

  it("never carries or uploads A's leftovers as B's profile when B's fetch fails", async () => {
    await arrive(A);

    useRuchi.getState().setName("Asha R");
    useRuchi.getState().setPrefs({ budget: 150 });

    h.state.failProfile = true;
    await signInAs(B);

    // The owner boundary neutralises A's personal state before the fetch, so
    // a failed read gives B an empty profile — never A's name/preferences.
    expect(useRuchi.getState().account?.id).toBe(B.id);
    expect(useRuchi.getState().name).toBe("");
    expect(useRuchi.getState().prefs).toEqual(BASE_PREFS);

    await vi.advanceTimersByTimeAsync(5000);
    expect(h.state.upserts).toEqual([]);
  });

  it("fires a scheduled write exactly once", async () => {
    await arrive(A);
    expect(h.state.upserts).toEqual([]);

    useRuchi.getState().setPrefs({ budget: 150 });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(h.state.upserts).toHaveLength(1);
  });

  it("keeps the debounce window and pushes only the most recent edit", async () => {
    await arrive(A);
    expect(h.state.upserts).toEqual([]);

    useRuchi.getState().setName("First");
    await vi.advanceTimersByTimeAsync(900);
    useRuchi.getState().setName("Second");
    await vi.advanceTimersByTimeAsync(900);
    expect(h.state.upserts).toEqual([]);

    await vi.advanceTimersByTimeAsync(400);
    expect(h.state.upserts).toHaveLength(1);
    expect(h.state.upserts[0]!.displayName).toBe("Second");
  });

  it("still syncs local profile data onto the account when the owner signs in", async () => {
    // Signed out: the edit itself is never sent anywhere…
    useRuchi.getState().setPrefs({ budget: 150 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.state.upserts).toEqual([]);

    // …but the sign-in that adopts this device's data still syncs it, so the
    // guard drops stale writes without disabling profile sync.
    await signInAs(A);
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.state.upserts.length).toBeGreaterThan(0);
    expect(h.state.upserts.at(-1)?.prefs).toMatchObject({ budget: 150 });
  });
});
