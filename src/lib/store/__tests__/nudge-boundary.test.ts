// ─────────────────────────────────────────────────────────────
// RUCHI — nudge account-isolation at the ownership boundary
// ─────────────────────────────────────────────────────────────
// Nudges and their suppression history (`lastNudges`) are per-owner state.
// The boundary rules these tests pin:
//   • a REAL owner change (another account, or anonymous leftovers) clears
//     both atoms in the same transition that replaces the account;
//   • signing back in as the SAME owner keeps them (a return is not a wipe);
//   • one account's suppression history can never silence another's nudges;
//   • sign-out keeps leftovers (existing semantics); deletion wipes them.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealHistoryEntry, NudgeEvent } from "@/lib/types";

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
    nextUser: { id: "u1", email: "a@b.c", displayName: "A" },
  };
  return { state };
});

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
  fetchProfile: async () => ({ ok: true, data: null }),
  upsertProfile: async () => ({ ok: true, data: null }),
  fetchCompletedMeals: async () => ({ ok: true, data: [] as MealHistoryEntry[] }),
  insertCompletedMeals: async () => ({ ok: true, data: null }),
  recordStreakDay: async () => ({ ok: true, data: null }),
  recordCookingCompletion: async () => ({ ok: true, data: "recorded" }),
  fetchCookingStats: async () => ({ ok: true, data: null }),
  fetchRecentCookedMeals: async () => ({ ok: true, data: [] as MealHistoryEntry[] }),
  fetchNotificationPrefs: async () => ({ ok: true, data: null }),
  pushAttentionState: async () => ({ ok: true, data: null }),
  upsertNotificationChannels: async () => ({ ok: true, data: null }),
  upsertNotificationTypePrefs: async () => ({ ok: true, data: null }),
  pushKitchenMirror: async () => ({ ok: true, data: null }),
  pushLastAction: async () => ({ ok: true, data: null }),
  pushPausedSession: async () => ({ ok: true, data: null }),
  markNotificationEngaged: async () => ({ ok: true, data: null }),
}));

import { useRuchi } from "../index";

const nudge = (kind: NudgeEvent["kind"], at: number): NudgeEvent => ({
  id: `n-${kind}-${at}`,
  kind,
  title: "Something in your kitchen",
  body: "Cook it before it turns.",
  createdAt: at,
  read: false,
});

const nudges: NudgeEvent[] = [nudge("expiry", 1_000)];
const lastNudges = { expiry: 1_000 } as const;

const signInAs = async (user: { id: string; email: string; displayName: string }) => {
  h.state.nextUser = user;
  await useRuchi.getState().signIn(user.email, "pw");
};

beforeEach(() => {
  h.state.nextUser = { id: "u1", email: "a@b.c", displayName: "A" };
  useRuchi.setState({
    name: "",
    inventory: [],
    history: [],
    nudges: [],
    lastNudges: {},
    account: null,
    localOwner: null,
    syncError: false,
    authError: null,
    pendingScanGoals: [],
    pendingScanGoalsRevision: 0,
    pendingScanGoalsConsumed: false,
  });
});

describe("nudge ownership boundary", () => {
  it("first sign-in (no leftovers) keeps whatever nudge state is local", async () => {
    useRuchi.setState({ nudges, lastNudges: { ...lastNudges } });
    await signInAs({ id: "u1", email: "a@b.c", displayName: "A" });
    expect(useRuchi.getState().account?.id).toBe("u1");
    expect(useRuchi.getState().nudges).toHaveLength(1);
    expect(useRuchi.getState().lastNudges.expiry).toBe(1_000);
  });

  it("same-account return does NOT erase that owner's nudge history", async () => {
    await signInAs({ id: "u1", email: "a@b.c", displayName: "A" });
    useRuchi.setState({ nudges, lastNudges: { ...lastNudges } });

    useRuchi.getState().signOut();
    await signInAs({ id: "u1", email: "a@b.c", displayName: "A" });

    expect(useRuchi.getState().localOwner).toBe("u1");
    expect(useRuchi.getState().nudges).toHaveLength(1);
    expect(useRuchi.getState().lastNudges.expiry).toBe(1_000);
  });

  it("a different account cannot inherit another's nudges or suppression history", async () => {
    await signInAs({ id: "u1", email: "a@b.c", displayName: "A" });
    useRuchi.setState({ nudges, lastNudges: { ...lastNudges } });

    await signInAs({ id: "u2", email: "b@b.c", displayName: "B" });

    const s = useRuchi.getState();
    expect(s.account?.id).toBe("u2");
    expect(s.localOwner).toBe("u2");
    expect(s.nudges).toEqual([]);
    expect(s.lastNudges).toEqual({});
  });

  it("sign-out keeps leftovers, but deletion wipes nudge state", async () => {
    await signInAs({ id: "u1", email: "a@b.c", displayName: "A" });
    useRuchi.setState({ nudges, lastNudges: { ...lastNudges } });

    useRuchi.getState().signOut();
    expect(useRuchi.getState().nudges).toHaveLength(1);
    expect(useRuchi.getState().lastNudges.expiry).toBe(1_000);

    useRuchi.getState().resetAfterAccountDeletion();
    expect(useRuchi.getState().nudges).toEqual([]);
    expect(useRuchi.getState().lastNudges).toEqual({});
  });
});
