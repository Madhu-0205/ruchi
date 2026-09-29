// ─────────────────────────────────────────────────────────────
// RUCHI — service worker (web push receive path)
// ─────────────────────────────────────────────────────────────
// Minimal, calm, no fetch interception. Two jobs:
//  1. push → show ONE notification with the engine's verbatim copy,
//     dropped silently when stale (expiresAt) — a late push never
//     surfaces context Home would no longer show.
//  2. notificationclick → focus/land on the deepLink so the Home
//     state matches the message (deep-link parity contract).
// No offline caching: the app handles that at the network layer.

/* eslint-disable no-restricted-globals */

self.addEventListener("install", () => {
  // No precaching; activate immediately on update.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null; // malformed payload → silence, never a broken toast
  }
  if (!payload || typeof payload.title !== "string" || !payload.title) return;

  // Stale context ≠ notification.
  if (typeof payload.expiresAt === "number" && Date.now() > payload.expiresAt) {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: typeof payload.body === "string" ? payload.body : "",
      // Quiet by construction: no vibration pattern, no urgency games.
      silent: false,
      badge: "/ruchi-logo-192.png",
      icon: "/ruchi-logo-192.png",
      tag: payload.contextType || "ruchi", // collapse repeats of one context
      data: { deepLink: payload.deepLink || "/", recipeId: payload.recipeId },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink = (event.notification.data && event.notification.data.deepLink) || "/";
  const url = new URL(deepLink, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an existing window and steer it to the deep link.
      for (const client of clientList) {
        if ("focus" in client) {
          return client.focus().then(() => {
            if ("navigate" in client) return client.navigate(url);
            return undefined;
          });
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
