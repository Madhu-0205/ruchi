// ─────────────────────────────────────────────────────────────
// RUCHI — WebPushAdapter (build-order step 3)
// ─────────────────────────────────────────────────────────────
// The web-push delivery adapter: VAPID-signed RFC 8291 messages to
// a stored PushSubscription. SERVER-ONLY module — web-push uses
// node crypto and must never be imported from a client bundle.
//
// Behavior contract (docs/NOTIFICATION_LAYER.md):
//  • isAvailable: cheap check — channel enabled AND a subscription
//    with a real endpoint is stored. No network calls.
//  • deliver: sends { headline, supportingText, deepLink } verbatim
//    from the PlainMessage; may DECLINE contexts it can't render
//    (a recipe-less cooking_gap reads as nagging) rather than
//    improvising copy.
//  • A 404/410 from the push service means the subscription is
//    dead → user-unavailable, and the cron route prunes the row.
//  • expiresAt is honored: stale messages are dropped before any
//    network I/O — a late cron run never delivers stale context.

import webpush from "web-push";
import type {
  AdapterPrefs,
  DeliveryAdapter,
  DeliveryResult,
  PlainMessage,
} from "./types";

/** Contexts web push renders poorly — decline, never improvise. */
const UNSUITABLE_CONTEXTS = new Set(["cooking_gap", "recent_cooking"]);

let vapidConfigured = false;

/**
 * Configure VAPID once per process. Keys come from server-only env
 * (never NEXT_PUBLIC_*). No-op when unconfigured — the route then
 * reports the layer as disabled and nothing is sent.
 */
export function configureVapid(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:hello@ruchi.app";
  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

/** Minimal structural check of a stored PushSubscriptionJSON. */
export function isValidSubscription(
  sub: unknown,
): sub is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (typeof sub !== "object" || sub === null) return false;
  const s = sub as Record<string, unknown>;
  if (typeof s.endpoint !== "string" || !s.endpoint.startsWith("https://")) return false;
  const keys = s.keys as Record<string, unknown> | undefined;
  return (
    typeof keys === "object" &&
    keys !== null &&
    typeof keys.p256dh === "string" &&
    typeof keys.auth === "string"
  );
}

/** Payload shape delivered to the service worker (public for SW tests). */
export interface PushPayload {
  title: string;
  body: string;
  deepLink: string;
  contextType: string;
  recipeId: string | null;
  expiresAt: number;
}

/** Build the SW payload — exported for tests; used by deliver(). */
export function buildPushPayload(msg: PlainMessage): PushPayload {
  return {
    title: msg.headline,
    body: msg.supportingText ?? "",
    deepLink: msg.deepLink,
    contextType: msg.contextType,
    recipeId: msg.recipeId ?? null,
    expiresAt: msg.expiresAt,
  };
}

/**
 * The deliverable message, as the cron route assembles it: a
 * PlainMessage plus the user's stored subscription. Keeping the
 * subscription OUT of PlainMessage preserves the doc's contract —
 * adapters receive exactly PlainMessage and nothing else — while
 * letting the route wire prefs to delivery.
 */
export interface DeliverableMessage {
  msg: PlainMessage;
  subscription: unknown;
}

export const webPushAdapter: DeliveryAdapter = {
  channel: "web_push",

  async isAvailable(prefs: AdapterPrefs): Promise<boolean> {
    return (
      prefs.channels.web_push === true && isValidSubscription(prefs.webPushSubscription)
    );
  },

  async deliver(msg: PlainMessage): Promise<DeliveryResult> {
    // Stale context ≠ notification — drop before any I/O.
    if (Date.now() > msg.expiresAt) {
      return { ok: false, reason: "unsuitable-context" };
    }
    // A dish-less context reads as nagging on the lock screen.
    if (UNSUITABLE_CONTEXTS.has(msg.contextType)) {
      return { ok: false, reason: "unsuitable-context" };
    }
    if (!vapidConfigured && !configureVapid()) {
      return { ok: false, reason: "provider-error" };
    }
    const deliverable = msg as PlainMessage & { subscription?: unknown };
    if (!isValidSubscription(deliverable.subscription)) {
      return { ok: false, reason: "user-unavailable" };
    }

    try {
      await webpush.sendNotification(
        deliverable.subscription,
        JSON.stringify(buildPushPayload(msg)),
        // Gentle urgency only — RUCHI is calm by construction.
        {
          TTL: Math.max(60, Math.floor((msg.expiresAt - Date.now()) / 1000)),
          urgency: "normal",
        },
      );
      return { ok: true };
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err !== null && "statusCode" in err
          ? Number((err as { statusCode: unknown }).statusCode)
          : 0;
      // 404/410: the subscription is gone (browser unregistered it).
      if (status === 404 || status === 410) {
        return { ok: false, reason: "user-unavailable" };
      }
      return { ok: false, reason: "provider-error" };
    }
  },
};
