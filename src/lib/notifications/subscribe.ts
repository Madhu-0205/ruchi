"use client";

// ─────────────────────────────────────────────────────────────
// RUCHI — client push subscription (WebPushAdapter client half)
// ─────────────────────────────────────────────────────────────
// Registers /sw.js, asks the browser for a push subscription with
// the server's VAPID public key, and mirrors it into
// notification_prefs.web_push_subscription (own-row only; RLS is
// the boundary). Every step degrades gracefully: no service worker
// support, no permission, or no Supabase → the toggle simply stays
// a preference and nothing breaks.
//
// The server exposes the PUBLIC VAPID key at
// GET /api/notifications/vapid-public — never a private key.
//
// The subscribe API authenticates with the session's Bearer token
// (same posture as every other durable-data write): the route reuses
// it to build an RLS-scoped client, so the subscription lands in the
// caller's OWN notification_prefs row and nowhere else.

import { getSupabase } from "@/lib/auth/supabase";

export type SubscribeOutcome =
  | { ok: true; endpoint: string }
  | { ok: false; reason: "unsupported" | "denied" | "unconfigured" | "error" };

/** The session's Authorization header, or {} when signed out. */
async function authHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabase();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Does this browser support the full web-push receive path? */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Current notification permission, as the Profile toggle should see
 * it: "default" means we can still ask; "denied" means the browser
 * has permanently declined for this origin.
 */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Enable web push for the signed-in user: register SW, request
 * permission, subscribe, and POST the subscription to the server
 * (which stores it into the user's own notification_prefs row).
 */
export async function enableWebPush(): Promise<SubscribeOutcome> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const res = await fetch("/api/notifications/vapid-public");
    if (!res.ok) return { ok: false, reason: "unconfigured" };
    const { publicKey } = (await res.json()) as { publicKey?: string };
    if (!publicKey) return { ok: false, reason: "unconfigured" };

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const save = await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    if (!save.ok) return { ok: false, reason: "error" };
    return { ok: true, endpoint: sub.endpoint };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Disable web push: unsubscribe locally and clear the stored
 * subscription. Best-effort — a failed unsubscribe still reports
 * ok if the server clear succeeded, because delivery checks the
 * stored row, not the browser.
 */
export async function disableWebPush(): Promise<SubscribeOutcome> {
  try {
    if (pushSupported()) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe().catch(() => undefined);
    }
    const res = await fetch("/api/notifications/subscribe", {
      method: "DELETE",
      headers: await authHeaders(),
    });
    return res.ok ? { ok: true, endpoint: "" } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
