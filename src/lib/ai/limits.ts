// ─────────────────────────────────────────────────────────────
// RUCHI — shared AI limits (client + server agree on these)
// ─────────────────────────────────────────────────────────────

/** Hard cap on image bytes after client compression (~1.4 MB data-URL overhead included). */
export const MAX_IMAGE_BYTES = 1_400_000;

/** Abort/timeouts for the analyze call (ms) — photo analysis must not hang the UI. */
export const VISION_TIMEOUT_MS = 30_000;
