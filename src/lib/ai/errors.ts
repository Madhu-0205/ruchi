// ─────────────────────────────────────────────────────────────
// RUCHI — vision error classification (pure, provider-agnostic)
// ─────────────────────────────────────────────────────────────
// The scan screen must not blame the photo for every failure. This module
// turns whatever the vision service threw into a small, honest taxonomy so
// the UI can render the right message. It is deliberately pure (no DOM, no
// React, no fetch) so it can be unit-tested directly.
//
// Note: HTTP errors from /api/analyze-ingredients do NOT reach here as
// throws. The service resolves the response and returns null for
// 401/503/502/504/429; only genuine client-side fetch failures throw.

export type VisionFailure =
  | { kind: "abort" } // user cancelled or a newer scan superseded this one
  | { kind: "network" } // fetch never reached the route (offline, blocked, DNS)
  | { kind: "unavailable" }; // anything else → scanner unavailable / provider error

/**
 * Classify an error thrown by `getVisionService().detectIngredients`.
 * AbortError → cancellation (stay silent). TypeError / fetch-style network
 * messages → network. Everything else → unavailable.
 */
export function classifyVisionError(err: unknown): VisionFailure {
  if (
    err &&
    (err instanceof DOMException || err instanceof Error) &&
    err.name === "AbortError"
  ) {
    return { kind: "abort" };
  }

  if (err instanceof Error) {
    const msg = err.message ?? "";
    const isNetwork =
      msg.includes("failed to fetch") ||
      msg.includes("NetworkError") ||
      msg.includes("network") ||
      err instanceof TypeError;
    if (isNetwork) return { kind: "network" };
  }

  return { kind: "unavailable" };
}
