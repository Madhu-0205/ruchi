// ─────────────────────────────────────────────────────────────
// RUCHI — notification ledger (server-authoritative)
// ─────────────────────────────────────────────────────────────
// Pure types + the one durable write path for the notification
// funnel: generated → sent / failed / suppressed, forever. The
// cron writes here; the client reads-and-frames (via
// mark_notification_engaged) only what a tap/click means.
//
// Idempotency contract: every *send* carries a dedup key and claims
// the row via INSERT ... WITH ON CONFLICT DO NOTHING (unique index
// on (user_id, dedup_key)). A successful INSERT is the only receipt
// that delivery can start. Any other outcome is a no-op row and
// never blocks a later send (the key is NULL on suppression rows).

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────

/** Status of one notification attempt, immutable after the fact. */
export type LedgerStatus = "sent" | "failed" | "suppressed";

/** The server-side ledger row. */
export interface LedgerRow {
  id: string;
  user_id: string;
  opportunity_type: string;
  dedup_key: string | null;
  title: string;
  body: string;
  destination: string | null;
  recipe_id: string | null;
  suppression_reason: string | null;
  status: LedgerStatus;
  created_at: string;
  delivered_at: string | null;
  opened_at: string | null;
  actioned_at: string | null;
  updated_at: string;
}

// ── Row creators ──────────────────────────────────────────────

export interface SendRowArgs {
  user_id: string;
  opportunity_type: string;
  dedup_key: string;
  title: string;
  body: string;
  destination: string;
  recipe_id: string | null;
}

export function sendRow(args: SendRowArgs): Pick<LedgerRow, "user_id" | "opportunity_type" | "dedup_key" | "title" | "body" | "destination" | "recipe_id"> {
  return {
    user_id: args.user_id,
    opportunity_type: args.opportunity_type,
    dedup_key: args.dedup_key,
    title: args.title,
    body: args.body,
    destination: args.destination,
    recipe_id: args.recipe_id,
  };
}

export function suppressRow(
  userId: string,
  opportunity_type: string,
  reason: string,
): Pick<LedgerRow, "user_id" | "opportunity_type" | "title" | "body" | "destination" | "recipe_id" | "suppression_reason"> & {
  /** Suppressed rows carry no send key — it can never block a real send. */
  dedup_key?: undefined;
} {
  return {
    user_id: userId,
    opportunity_type,
    title: "",
    body: "",
    destination: "",
    recipe_id: null,
    suppression_reason: reason,
    dedup_key: undefined,
  };
}

// ── Server write path (cron route, service-role client) ───────

/**
 * Minimal structural client so the pure ledger helpers are testable
 * without a live Supabase: satisfied by SupabaseClient and by the
 * test doubles. Only the shape the ledger writes are actually used.
 */
export interface LedgerInsertClient {
  from(table: string): {
    insert(row: unknown):
      | { data?: unknown; error?: { code?: string } | null }
      | PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  };
}

export interface LedgerUpdateClient {
  from(table: string): {
    update(patch: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
    };
  };
}

function extractId(data: unknown): string | null {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) {
    const first = data[0] as { id?: unknown } | undefined;
    return typeof first?.id === "string" ? first.id : null;
  }
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function newLedgerId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Older runtimes: timestamp + entropy is sufficient for a ledger id.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface RecordResult {
  /** The ledger row id ("" when the insert was a duplicate). */
  id: string;
  /** true = this exact (user, dedup_key) was already recorded — idempotent re-run. */
  existing: boolean;
}

/**
 * Claim a send slot in the ledger BEFORE delivering. The insert carries
 * the dedup key; a 23505 unique violation means this notification already
 * went out (idempotent cron re-run) and delivery must be skipped. The id
 * is generated client-side so the caller can reference the row even when
 * PostgREST returns no body.
 */
export async function recordNotification(
  client: LedgerInsertClient,
  row: Pick<LedgerRow, "user_id" | "opportunity_type" | "dedup_key" | "title" | "body" | "destination" | "recipe_id">,
  userId: string,
): Promise<RecordResult> {
  const id = newLedgerId();
  const nowIso = new Date().toISOString();
  const payload = {
    ...row,
    user_id: userId,
    id,
    status: "sent" as const,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const res = await client.from("notification_ledger").insert(payload);
  const err = (res as { error?: { code?: string } | null }).error;
  if (err) {
    if (err.code === "23505") return { id: "", existing: true };
    throw new Error(`ledger-insert-failed${err.code ? `:${err.code}` : ""}`);
  }
  return { id: extractId((res as { data?: unknown }).data) ?? id, existing: false };
}

/**
 * Record a policy suppression for debugging/analytics. The dedup key is
 * namespaced (`sup:<day>:<reason>:<type>`) so suppression records are
 * themselves idempotent per day and can never occupy a real send slot.
 */
export async function recordSuppression(
  client: LedgerInsertClient,
  args: { userId: string; opportunityType: string; reason: string; dayKey: string },
): Promise<RecordResult> {
  const row = suppressRow(args.userId, args.opportunityType, args.reason);
  const id = newLedgerId();
  const nowIso = new Date().toISOString();
  const payload = {
    ...row,
    user_id: args.userId,
    id,
    dedup_key: `sup:${args.dayKey}:${args.reason}:${args.opportunityType}`,
    status: "suppressed" as const,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const res = await client.from("notification_ledger").insert(payload);
  const err = (res as { error?: { code?: string } | null }).error;
  if (err) {
    if (err.code === "23505") return { id: "", existing: true };
    throw new Error(`ledger-insert-failed${err.code ? `:${err.code}` : ""}`);
  }
  return { id: extractId((res as { data?: unknown }).data) ?? id, existing: false };
}

/**
 * Settle a claimed send: mark it delivered (with timestamp) or failed.
 * Service-role only — the ledger's RLS grants clients SELECT on their own
 * rows, nothing else.
 */
export async function updateNotificationStatus(
  client: LedgerUpdateClient,
  id: string,
  patch: { status: "sent" | "failed"; deliveredAt?: string },
): Promise<boolean> {
  const update: Record<string, unknown> = {
    status: patch.status,
    updated_at: new Date().toISOString(),
  };
  if (patch.deliveredAt) update.delivered_at = patch.deliveredAt;
  const res = await client.from("notification_ledger").update(update).eq("id", id);
  return !(res as { error?: unknown }).error;
}

// ── Client-side write helper (RLS-scoped) ─────────────────────
// The ONLY client-writable ledger operation: mark a notification
// opened/actioned. The RPC `mark_notification_engaged` enforces
// ownership; this client call never touches a foreign id.

export async function markNotificationEngaged(
  supabase: SupabaseClient,
  ledgerId: string,
  actioned = false,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data, error } = await supabase.rpc("mark_notification_engaged", {
      p_ledger_id: ledgerId,
      p_actioned: actioned,
    });
    if (error) return { ok: false, reason: "rpc-error" };
    return { ok: true, ...data };
  } catch {
    return { ok: false, reason: "rpc-error" };
  }
}
