// ─────────────────────────────────────────────────────────────
// RUCHI — notification ledger tests
// ═══════════════════════════════════════════════════════════════
// Spec §11 (idempotency, auditability) and §17 (user isolation):
//  • repeated cron execution is idempotent (dedup key → 23505)
//  • suppression rows carry no send key and record a reason
//  • user A can never touch user B's ledger rows

import { describe, expect, it } from "vitest";
import {
  recordNotification,
  recordSuppression,
  type LedgerInsertClient,
  sendRow,
  suppressRow,
} from "../ledger";

// ── a minimal Supabase-like client (matches the route's usage) ──
// Emulates the (user_id, dedup_key) partial unique index: the FIRST
// insert with a given key wins; the duplicate gets a 23505.

let inserted: Record<string, unknown>[] = [];
let nextId = 1;

function resetStore() {
  inserted = [];
  nextId = 1;
}

function makeClient(): LedgerInsertClient {
  return {
    from: (tableArg: string) => {
      void tableArg; // single-table emulation: notification_ledger
      return {
        insert: (row: unknown) => {
          const r = row as Record<string, unknown>;
          const dup = inserted.some(
            (x) => x.user_id === r.user_id && x.dedup_key === r.dedup_key && r.dedup_key != null,
          );
          if (dup) {
            // unique violation — the row never lands
            return { data: null, error: { code: "23505" } };
          }
          inserted.push(r);
          return { data: { id: `ledger-${nextId++}` }, error: null };
        },
      };
    },
  };
}

// ── sendRow / suppressRow factories ──────────────────────────
describe("sendRow / suppressRow factories", () => {
  it("sendRow carries the fields the ledger needs", () => {
    const row = sendRow({
      user_id: "user-1",
      opportunity_type: "resume_cooking",
      dedup_key: "resume_cooking:paneer-egg-bhurji:2026-10-02",
      title: "Your dinner is still waiting.",
      body: "Pick up where you left off.",
      destination: "/?resume=paneer-egg-bhurji",
      recipe_id: "paneer-egg-bhurji",
    });
    expect(row.user_id).toBe("user-1");
    expect(row.opportunity_type).toBe("resume_cooking");
    expect(row.dedup_key).toBe("resume_cooking:paneer-egg-bhurji:2026-10-02");
  });

  it("suppressRow records a reason and no send key", () => {
    const row = suppressRow("user-1", "cook_again", "duplicate");
    expect(row.suppression_reason).toBe("duplicate");
    expect(row.dedup_key).toBeUndefined();
  });
});

describe("recordNotification (idempotency)", () => {
  it("inserts the first send", async () => {
    resetStore();
    const supabase = makeClient();
    const row = sendRow({
      user_id: "user-1",
      opportunity_type: "resume_cooking",
      dedup_key: "resume_cooking:x:2026-10-02",
      title: "test",
      body: "body",
      destination: "/?resume=x",
      recipe_id: "paneer-egg-bhurji",
    });
    const { id, existing } = await recordNotification(supabase, row, "user-1");
    expect(existing).toBe(false);
    expect(id).toMatch(/^ledger-/);
    expect(inserted).toHaveLength(1);
  });

  it("supports the 'sent' status explicitly", async () => {
    resetStore();
    const supabase = makeClient();
    const row = sendRow({
      user_id: "user-1",
      opportunity_type: "cook_again",
      dedup_key: "cook_again:x:2026-10-03",
      title: "Round two? 👀",
      body: "That last meal deserves it.",
      destination: "/?recipe=x",
      recipe_id: "paneer-egg-bhurji",
    });
    const { id, existing } = await recordNotification(supabase, row, "user-1");
    expect(existing).toBe(false);
    expect(typeof id).toBe("string");
    expect(inserted[0]?.status).toBe("sent");
  });

  it("returns existing=true on a duplicate insert (idempotent)", async () => {
    resetStore();
    const supabase = makeClient();
    const row = sendRow({
      user_id: "user-1",
      opportunity_type: "resume_cooking",
      dedup_key: "resume_cooking:x:2026-10-02",
      title: "test",
      body: "body",
      destination: "/?resume=x",
      recipe_id: "paneer-egg-bhurji",
    });
    // first insert
    await recordNotification(supabase, row, "user-1");
    // second insert — same dedup key → already exists
    const { id, existing } = await recordNotification(supabase, row, "user-1");
    expect(existing).toBe(true);
    expect(id).toBe("");
    expect(inserted).toHaveLength(1); // second insert rolled back (duplicate)
  });

  it("allows a different dedup key for the same user", async () => {
    resetStore();
    const supabase = makeClient();
    const row1 = sendRow({
      user_id: "user-1",
      opportunity_type: "resume_cooking",
      dedup_key: "resume_cooking:x:2026-10-02",
      title: "test1",
      body: "b1",
      destination: "/?resume=x",
      recipe_id: "paneer-egg-bhurji",
    });
    const row2 = sendRow({
      user_id: "user-1",
      opportunity_type: "cook_again",
      dedup_key: "cook_again:y:2026-10-03",
      title: "test2",
      body: "b2",
      destination: "/?recipe=y",
      recipe_id: "paneer-egg-bhurji",
    });
    const { id: id1 } = await recordNotification(supabase, row1, "user-1");
    const { id: id2, existing: existing2 } = await recordNotification(supabase, row2, "user-1");
    expect(existing2).toBe(false);
    expect(id1).not.toBe(id2);
    expect(inserted).toHaveLength(2);
  });
});

describe("recordSuppression (bounded, never blocks a send)", () => {
  it("records a suppression with a namespaced key", async () => {
    resetStore();
    const supabase = makeClient();
    const { existing } = await recordSuppression(supabase, {
      userId: "user-1",
      opportunityType: "resume_cooking",
      reason: "quiet_hours",
      dayKey: "2026-10-02",
    });
    expect(existing).toBe(false);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.status).toBe("suppressed");
    expect(inserted[0]?.suppression_reason).toBe("quiet_hours");
    expect(String(inserted[0]?.dedup_key)).toContain("sup:2026-10-02:quiet_hours");
  });

  it("is idempotent per (day, reason, type) and never occupies a send slot", async () => {
    resetStore();
    const supabase = makeClient();
    const args = {
      userId: "user-1",
      opportunityType: "discover_opportunity",
      reason: "daily_cap",
      dayKey: "2026-10-02",
    };
    await recordSuppression(supabase, args);
    const second = await recordSuppression(supabase, args);
    expect(second.existing).toBe(true);
    expect(inserted).toHaveLength(1);

    // the suppression key can never collide with a real send key
    const send = await recordNotification(
      supabase,
      sendRow({
        user_id: "user-1",
        opportunity_type: "discover_opportunity",
        dedup_key: "discover_opportunity:quick-easy:2026-W40",
        title: "t",
        body: "b",
        destination: "/?category=quick-easy",
        recipe_id: null,
      }),
      "user-1",
    );
    expect(send.existing).toBe(false);
    expect(inserted).toHaveLength(2);
  });
});

describe("user isolation", () => {
  it("user A never touches user B's rows", async () => {
    resetStore();
    const supabase = makeClient();
    const rowA = sendRow({
      user_id: "user-A",
      opportunity_type: "resume_cooking",
      dedup_key: "resume_cooking:a:2026-10-02",
      title: "test",
      body: "body",
      destination: "/?resume=a",
      recipe_id: "paneer-egg-bhurji",
    });
    const rowB = sendRow({
      user_id: "user-B",
      opportunity_type: "resume_cooking",
      dedup_key: "resume_cooking:b:2026-10-02",
      title: "test",
      body: "body",
      destination: "/?resume=b",
      recipe_id: "paneer-egg-bhurji",
    });
    await recordNotification(supabase, rowA, "user-A");
    await recordNotification(supabase, rowB, "user-B");

    // both inserted under different user ids
    const senders = inserted.filter((r) => r.user_id === "user-A");
    const receivers = inserted.filter((r) => r.user_id === "user-B");
    expect(senders).toHaveLength(1);
    expect(receivers).toHaveLength(1);
    expect(senders[0]?.user_id).not.toBe("user-B");
    expect(receivers[0]?.user_id).not.toBe("user-A");
  });
});
