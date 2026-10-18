// ─────────────────────────────────────────────────────────────
// RUCHI — scan → home goal-transfer contract tests
// ─────────────────────────────────────────────────────────────
// The transfer is the only channel a scan uses to hand its goal chips to
// home, so its contract is pinned here:
//
//  - `pendingScanGoalsRevision` is the transfer identity (never the payload
//    length, which is 0 for a legitimate empty selection);
//  - publishing always produces a NEW revision, empty arrays included;
//  - consumption is exact and idempotent: only the first consumer of the
//    currently pending revision gets `true`, and it never moves the revision;
//  - stale, duplicate and future consumers are rejected with the store left
//    completely untouched, so a newer publication is never erased.
//
// The final block replays the consumer sequence HomeScreen performs
// (consume-on-arrival, re-mount, newer publication while mounted) using the
// same store primitives the screen calls — the behaviour the node test
// environment cannot render.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOAL_CHIP_IDS, isIntentGoalChipId } from "@/lib/types";
import type { Intent } from "@/lib/types";
import { useRuchi } from "../index";
import { activeGoals, decideScanGoalTransfer } from "../scan-goals";

// zustand's persist middleware writes on every setState; node has no
// localStorage, so provide an in-memory shim with the storage-like shape
// before the store module is evaluated (as the other store tests do).
const h = vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  } as unknown as Storage;
  return { mem };
});

/** The transfer surface of the store, as the screens see it. */
function transfer() {
  const s = useRuchi.getState();
  return {
    goals: s.pendingScanGoals,
    revision: s.pendingScanGoalsRevision,
    consumed: s.pendingScanGoalsConsumed,
  };
}

/** No transfer has ever been published — the initial state. */
function resetTransfer(): void {
  h.mem.clear();
  useRuchi.setState({
    pendingScanGoals: [],
    pendingScanGoalsRevision: 0,
    pendingScanGoalsConsumed: false,
  });
}

const publish = (goals: Intent[]): number => useRuchi.getState().setPendingScanGoals(goals);
const consume = (revision: number): boolean =>
  useRuchi.getState().consumePendingScanGoals(revision);

describe("scan goal transfer — publication revisions", () => {
  beforeEach(resetTransfer);

  it("starts with no transfer: revision 0, empty payload, nothing consumed", () => {
    expect(transfer()).toEqual({ goals: [], revision: 0, consumed: false });
  });

  it("publishing goals creates a new pending transfer and returns its revision", () => {
    const revision = publish(["high-protein"]);
    expect(revision).toBe(1);
    expect(transfer()).toEqual({ goals: ["high-protein"], revision: 1, consumed: false });
  });

  it("publishing an EMPTY selection is a real publication with its own revision", () => {
    const revision = publish([]);
    expect(revision).toBe(1);
    // Pending, not "absent": the payload is empty but the transfer is live.
    expect(transfer()).toEqual({ goals: [], revision: 1, consumed: false });
  });

  it("re-publishing an identical array still produces a distinct revision", () => {
    const first = publish(["high-protein", "quick"]);
    const second = publish(["high-protein", "quick"]);
    expect(second).toBe(first + 1);
    expect(transfer().goals).toEqual(["high-protein", "quick"]);
  });

  it("revisions increase monotonically across many publications, empty ones included", () => {
    const revisions = [
      publish(["high-protein"]),
      publish([]),
      publish(["quick"]),
      publish(["quick"]),
      publish([]),
    ];
    expect(revisions).toEqual([1, 2, 3, 4, 5]);
    expect(transfer().revision).toBe(5);
  });

  it("a publication invalidates the previous 'consumed' mark", () => {
    publish(["healthy"]);
    expect(consume(1)).toBe(true);
    const revision = publish([]);
    expect(revision).toBe(2);
    expect(transfer()).toEqual({ goals: [], revision: 2, consumed: false });
  });
});

describe("scan goal transfer — consumption", () => {
  beforeEach(resetTransfer);

  it("consumes the exact pending revision once, clearing the payload but not the revision", () => {
    publish(["high-protein"]);
    expect(consume(1)).toBe(true);
    expect(transfer()).toEqual({ goals: [], revision: 1, consumed: true });
  });

  it("accepts an EMPTY transfer as data — the same revision, consumed once", () => {
    publish([]);
    expect(consume(1)).toBe(true);
    expect(transfer()).toEqual({ goals: [], revision: 1, consumed: true });
  });

  it("rejects duplicate consumption without changing anything", () => {
    publish(["high-protein"]);
    expect(consume(1)).toBe(true);
    const before = transfer();
    expect(consume(1)).toBe(false);
    expect(transfer()).toEqual(before);
  });

  it("rejects consumption when nothing was ever published", () => {
    expect(consume(0)).toBe(false);
    expect(consume(1)).toBe(false);
    expect(transfer()).toEqual({ goals: [], revision: 0, consumed: false });
  });

  it("rejects a stale revision after a newer publication, leaving the newer transfer pending", () => {
    publish(["high-protein"]); // A
    publish(["quick"]); // B
    expect(consume(1)).toBe(false); // stale A
    expect(transfer()).toEqual({ goals: ["quick"], revision: 2, consumed: false });
  });

  it("rejects a future revision", () => {
    publish(["high-protein"]);
    expect(consume(2)).toBe(false);
    expect(consume(99)).toBe(false);
    expect(transfer()).toEqual({ goals: ["high-protein"], revision: 1, consumed: false });
  });

  it("a newer publication is consumable at its own revision after an older one was consumed", () => {
    publish(["high-protein"]);
    expect(consume(1)).toBe(true);
    const revision = publish(["quick"]);
    expect(revision).toBe(2);
    expect(consume(2)).toBe(true);
    expect(transfer()).toEqual({ goals: [], revision: 2, consumed: true });
  });

  it("a newer EMPTY publication supersedes an older non-empty transfer", () => {
    publish(["high-protein"]);
    publish([]);
    expect(consume(1)).toBe(false); // older transfer is gone
    expect(consume(2)).toBe(true);
    expect(transfer()).toEqual({ goals: [], revision: 2, consumed: true });
  });

  it("consumption never moves the revision, however many times it is attempted", () => {
    publish([]);
    consume(1);
    consume(1);
    consume(0);
    consume(7);
    expect(transfer().revision).toBe(1);
  });
});

// The transfer crosses an untrusted boundary: the goals are validated against
// the ONE definition of the scan's chip set before they reach recommendations.
describe("scan goal validation", () => {
  it("accepts exactly the ids the scan screen exposes as chips", () => {
    for (const id of GOAL_CHIP_IDS) expect(isIntentGoalChipId(id)).toBe(true);
    expect(GOAL_CHIP_IDS).toEqual(["high-protein", "quick", "budget", "healthy"]);
  });

  it("rejects real intents the scan does not offer, and anything unknown", () => {
    // Valid `Intent`s, but not scan chips — they must not leak in.
    expect(isIntentGoalChipId("spicy")).toBe(false);
    expect(isIntentGoalChipId("indian")).toBe(false);
    expect(isIntentGoalChipId("comfort")).toBe(false);
    expect(isIntentGoalChipId("filling")).toBe(false);
    expect(isIntentGoalChipId("")).toBe(false);
  });

  it("filters a mixed publication down to the chip set, preserving order", () => {
    const raw = ["quick", "indian", "budget", "filling"] as unknown as Intent[];
    expect(raw.filter(isIntentGoalChipId)).toEqual(["quick", "budget"]);
  });
});

// ── The consumer decision (pure) ──────────────────────────────
// HomeScreen's flow is these calls in this order: decide from the rendered
// transfer → apply the returned goals in the render phase → consume that same
// revision in an effect. The decision is pure, so it is tested directly — no
// renderer needed for the rules that decide WHOSE goals win.
describe("home's decision: which publication wins (pure)", () => {
  const view = (goals: Intent[], revision: number, consumed = false) => ({
    goals,
    revision,
    consumed,
  });

  it("applies a pending non-empty publication with its goals", () => {
    expect(decideScanGoalTransfer(view(["budget", "quick"], 3), 0)).toEqual({
      apply: true,
      revision: 3,
      goals: ["budget", "quick"],
    });
  });

  it("applies nothing when no publication ever happened (revision 0)", () => {
    expect(decideScanGoalTransfer(view([], 0), 0)).toEqual({ apply: false });
  });

  it("applies nothing to an already-consumed publication (re-mount / revisit)", () => {
    expect(decideScanGoalTransfer(view(["quick"], 1, true), 0)).toEqual({ apply: false });
  });

  it("applies nothing twice for the same mount (re-render, Strict Mode's pass)", () => {
    expect(decideScanGoalTransfer(view(["quick"], 1), 1)).toEqual({ apply: false });
    // An older revision can never win either.
    expect(decideScanGoalTransfer(view(["quick"], 1), 2)).toEqual({ apply: false });
  });

  it("applies a NEWER revision even while an older one is still in view", () => {
    expect(decideScanGoalTransfer(view(["healthy"], 4), 2)).toEqual({
      apply: true,
      revision: 4,
      goals: ["healthy"],
    });
  });

  it("an EMPTY publication applies as an empty goal set (no goal constraint)", () => {
    // Documented contract: this codebase has no `prefs.intents`, and clearing
    // every chip on the scan screen is an explicit "no goal" choice — home
    // must not keep recommending a goal the user just removed.
    expect(decideScanGoalTransfer(view([], 2), 0)).toEqual({ apply: true, revision: 2, goals: [] });
  });

  it("drops ids the product does not expose as goal chips, keeping the chosen order", () => {
    const raw = ["quick", "indian", "budget", "filling"] as unknown as Intent[];
    expect(decideScanGoalTransfer(view(raw, 1), 0)).toEqual({
      apply: true,
      revision: 1,
      goals: ["quick", "budget"],
    });
  });

  it("activeGoals prefers the transfer and otherwise returns the screen's own selection by reference", () => {
    const own: Intent[] = ["high-protein"];
    expect(activeGoals({ apply: true, revision: 1, goals: ["budget"] }, own)).toEqual(["budget"]);
    // By reference, not a copy: HomeScreen's memoized `filters` (and the AI
    // re-rank effect that depends on it) must not churn every render.
    expect(activeGoals({ apply: false }, own)).toBe(own);
  });
});

// The same decision, wired to the real store: these cases replay exactly what
// HomeScreen does per render/per commit, using the production helper and the
// production store — so the end-to-end rules are pinned even though the node
// test environment cannot render React components.
describe("home's decision wired to the real store", () => {
  beforeEach(resetTransfer);

  type HomeVisit = { appliedRevision: number; ownGoals: Intent[] };

  /** One render pass, exactly as HomeScreen performs it: read the transfer
   *  surface, decide, apply into local state. No store write happens here. */
  function render(home: HomeVisit) {
    const s = useRuchi.getState();
    const decision = decideScanGoalTransfer(
      {
        goals: s.pendingScanGoals,
        revision: s.pendingScanGoalsRevision,
        consumed: s.pendingScanGoalsConsumed,
      },
      home.appliedRevision,
    );
    return {
      decision,
      active: activeGoals(decision, home.ownGoals),
      ownGoals: decision.apply ? decision.goals : home.ownGoals,
      appliedRevision: decision.apply ? decision.revision : home.appliedRevision,
    };
  }

  /** Home's effect: consume the revision this visit rendered with. */
  const commit = (home: HomeVisit): boolean => consume(home.appliedRevision);

  const freshVisit = (): HomeVisit => ({ appliedRevision: 0, ownGoals: ["high-protein"] });

  it("a scan transfer becomes the active goals for the visit, consumed exactly once", () => {
    publish(["budget", "quick"]);
    let home = render(freshVisit());
    expect(home.active).toEqual(["budget", "quick"]);
    expect(commit(home)).toBe(true);
    // The payload is cleared, but this visit keeps recommending its goals.
    expect(transfer()).toEqual({ goals: [], revision: 1, consumed: true });

    home = render(home);
    expect(home.active).toEqual(["budget", "quick"]);
    expect(commit(home)).toBe(false); // idempotent — a second run changes nothing
    expect(transfer()).toEqual({ goals: [], revision: 1, consumed: true });
  });

  it("does not resurrect a consumed transfer on re-mount; the revision stays monotonic", () => {
    publish(["quick"]);
    expect(commit(render(freshVisit()))).toBe(true);

    // A fresh mount: appliedRevision restarts at 0 and the screen's own goal
    // selection is back to its default.
    const remount = render(freshVisit());
    expect(remount.decision).toEqual({ apply: false });
    expect(remount.active).toEqual(["high-protein"]);
    expect(transfer().revision).toBe(1); // never reset, never reused
  });

  it("B replaces A while home stays mounted", () => {
    publish(["quick"]); // A
    const visit = render(freshVisit());
    expect(visit.active).toEqual(["quick"]);
    expect(commit(visit)).toBe(true);

    publish(["healthy"]); // B, published while the same mount is on screen
    const updated = render(visit);
    expect(updated.active).toEqual(["healthy"]);
    expect(updated.appliedRevision).toBe(2);
    expect(commit(updated)).toBe(true);
  });

  it("a stale consumer cannot consume or overwrite a newer publication", () => {
    publish(["quick"]); // A
    const visit = render(freshVisit());
    expect(visit.active).toEqual(["quick"]);

    publish(["healthy"]); // B lands before this visit's effect runs
    expect(commit(visit)).toBe(false); // the stale revision is rejected
    expect(transfer()).toEqual({ goals: ["healthy"], revision: 2, consumed: false });

    const updated = render(visit); // the next render sees B, not A
    expect(updated.active).toEqual(["healthy"]);
    expect(updated.appliedRevision).toBe(2);
    expect(commit(updated)).toBe(true);
  });

  it("Strict Mode's second pass over one mount applies nothing extra", () => {
    publish(["budget"]);
    const first = render(freshVisit());
    expect(first.active).toEqual(["budget"]);
    // The second pass re-renders with the revision already applied.
    const second = render(first);
    expect(second.decision).toEqual({ apply: false });
    expect(second.active).toEqual(["budget"]);
    expect(commit(second)).toBe(true); // the effect still consumes exactly once
    expect(commit(second)).toBe(false);
    expect(transfer()).toEqual({ goals: [], revision: 1, consumed: true });
  });

  it("after an empty transfer clears the override, the screen's own selection drives the filters again", () => {
    publish([]);
    const visit = render(freshVisit());
    expect(visit.active).toEqual([]); // no goal constraint for this visit
    expect(commit(visit)).toBe(true);

    const remount = render(freshVisit());
    expect(remount.decision).toEqual({ apply: false });
    expect(remount.active).toEqual(["high-protein"]);
  });
});

// A scan hand-off belongs to the session that published it. Sign-out must
// kill it, without ever moving the revision. These tests call the REAL store
// action: the auth module degrades to a no-op in node (no Supabase client),
// so `signOut()` exercises the store's own state transition, not a stand-in.
describe("scan goal transfer — sign-out invalidation", () => {
  beforeEach(resetTransfer);

  const signOut = () => useRuchi.getState().signOut();

  it("invalidates a pending transfer on sign-out and preserves the revision", () => {
    const revision = publish(["high-protein", "quick"]);
    expect(transfer()).toEqual({ goals: ["high-protein", "quick"], revision, consumed: false });

    signOut();

    // Payload cleared, explicitly non-pending, revision untouched.
    expect(transfer()).toEqual({ goals: [], revision, consumed: true });
  });

  it("rejects the pre-sign-out revision afterwards, changing nothing", () => {
    const revision = publish(["quick"]);
    signOut();
    const after = transfer();

    expect(consume(revision)).toBe(false);
    expect(transfer()).toEqual(after);
  });

  it("cannot resurrect the invalidated transfer for a later Home visit", () => {
    publish(["budget"]);
    signOut();

    // A fresh Home mount (appliedRevision 0) over the post-sign-out store.
    const decision = decideScanGoalTransfer(
      { goals: transfer().goals, revision: transfer().revision, consumed: transfer().consumed },
      0,
    );
    expect(decision).toEqual({ apply: false });
  });

  it("lets a transfer published AFTER sign-out use the next revision", () => {
    const before = publish(["quick"]);
    signOut();

    const after = publish(["healthy"]);
    expect(after).toBe(before + 1); // monotonic across the session boundary
    expect(transfer()).toEqual({ goals: ["healthy"], revision: after, consumed: false });
    expect(consume(after)).toBe(true);
    expect(transfer()).toEqual({ goals: [], revision: after, consumed: true });
  });

  it("is idempotent: repeated sign-out does not corrupt the transfer state", () => {
    publish([]);
    signOut();
    const once = transfer();

    signOut();
    signOut();

    expect(transfer()).toEqual(once);
    expect(once).toEqual({ goals: [], revision: 1, consumed: true });
  });

  it("keeps a never-published store valid across sign-out", () => {
    signOut();
    // Nothing pending, and still no publication has ever happened.
    expect(transfer()).toEqual({ goals: [], revision: 0, consumed: true });

    // A publication after that behaves completely normally.
    const revision = publish(["healthy"]);
    expect(revision).toBe(1);
    expect(transfer()).toEqual({ goals: ["healthy"], revision: 1, consumed: false });
    expect(consume(revision)).toBe(true);
  });
});

// Account deletion is the other session-ending action, so it carries the same
// contract — and it additionally drops the persisted snapshot, which must not
// be able to move the in-memory revision. Again the REAL action is exercised.
describe("scan goal transfer — account-deletion invalidation", () => {
  beforeEach(resetTransfer);

  const deleteAccount = () => useRuchi.getState().resetAfterAccountDeletion();

  it("invalidates a pending transfer on deletion and preserves the revision", () => {
    const revision = publish(["high-protein", "budget"]);
    expect(transfer()).toEqual({ goals: ["high-protein", "budget"], revision, consumed: false });

    deleteAccount();

    // Payload cleared, explicitly non-pending, revision exactly as it was.
    expect(transfer()).toEqual({ goals: [], revision, consumed: true });
  });

  it("rejects the pre-deletion revision afterwards, changing nothing", () => {
    const revision = publish(["quick"]);
    deleteAccount();
    const after = transfer();

    expect(consume(revision)).toBe(false);
    expect(transfer()).toEqual(after);
  });

  it("cannot resurrect the invalidated transfer for a later Home mount", () => {
    publish(["healthy"]);
    deleteAccount();

    // A fresh Home mount (appliedRevision 0) over the post-deletion store.
    const decision = decideScanGoalTransfer(
      { goals: transfer().goals, revision: transfer().revision, consumed: transfer().consumed },
      0,
    );
    expect(decision).toEqual({ apply: false });
  });

  it("lets a transfer published after deletion use the next revision", () => {
    const deleted = publish(["quick"]); // A
    deleteAccount();

    const after = publish(["budget"]); // B
    expect(after).toBe(deleted + 1); // monotonic across the deletion
    expect(transfer()).toEqual({ goals: ["budget"], revision: after, consumed: false });

    expect(consume(after)).toBe(true);
    // A is gone for good — not merely superseded by B.
    expect(consume(deleted)).toBe(false);
    expect(transfer()).toEqual({ goals: [], revision: after, consumed: true });
  });

  it("is idempotent: repeated deletion resets never move the revision", () => {
    const revision = publish([]);
    deleteAccount();
    const once = transfer();

    deleteAccount();
    deleteAccount();

    expect(transfer()).toEqual(once);
    expect(once).toEqual({ goals: [], revision, consumed: true });
  });

  it("keeps a never-published store valid across deletion", () => {
    deleteAccount();
    expect(transfer()).toEqual({ goals: [], revision: 0, consumed: true });
    expect(consume(0)).toBe(false); // revision 0 stays non-consumable

    // Publication after deletion behaves completely normally.
    const revision = publish(["quick"]);
    expect(revision).toBe(1);
    expect(transfer()).toEqual({ goals: ["quick"], revision: 1, consumed: false });
    expect(consume(revision)).toBe(true);
  });
});

// Both session-ending paths retire the transfer through ONE shared patch
// (`invalidatedScanTransfer` in the store). The cases below run the same
// contract against both real actions, so neither can silently drift from the
// other — which is exactly how this bug appeared twice.
describe("scan goal transfer — shared session-ending invalidation", () => {
  beforeEach(resetTransfer);

  const ENDERS: [name: string, end: () => void][] = [
    ["signOut", () => useRuchi.getState().signOut()],
    ["resetAfterAccountDeletion", () => useRuchi.getState().resetAfterAccountDeletion()],
  ];

  for (const [name, end] of ENDERS) {
    it(`${name}: retires the transfer without moving the revision`, () => {
      const revision = publish(["high-protein", "quick"]);

      end();

      expect(transfer()).toEqual({ goals: [], revision, consumed: true });
    });

    it(`${name}: a retired transfer stays distinguishable from a published EMPTY selection`, () => {
      const retired = publish([]); // the user chose no goal
      end();
      expect(transfer()).toEqual({ goals: [], revision: retired, consumed: true });

      // The same empty payload published later is a NEW, pending transfer.
      const republished = publish([]);
      expect(republished).toBe(retired + 1);
      expect(transfer()).toEqual({ goals: [], revision: republished, consumed: false });
      expect(consume(republished)).toBe(true);
    });

    it(`${name}: repeated invalidation is idempotent`, () => {
      publish(["budget"]);
      end();
      const once = transfer();

      end();
      end();

      expect(transfer()).toEqual(once);
    });
  }

  it("both session-ending paths leave byte-identical transfer state", () => {
    const revision = publish(["healthy", "quick"]);
    useRuchi.getState().signOut();
    const afterSignOut = transfer();

    // Rebuild the same starting point, then delete the account instead.
    resetTransfer();
    expect(publish(["healthy", "quick"])).toBe(revision);
    useRuchi.getState().resetAfterAccountDeletion();

    expect(transfer()).toEqual(afterSignOut);
    expect(transfer()).toEqual({ goals: [], revision, consumed: true });
  });
});
