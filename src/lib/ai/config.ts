// ─────────────────────────────────────────────────────────────
// RUCHI — AI configuration
// ─────────────────────────────────────────────────────────────
// Provider and models are configuration, never hard-coded in feature code.
// Change env vars and the same application code runs against a different
// Puter model. Nothing here contains provider API keys — Puter is a
// user-pays gateway; the app never holds secrets.

import type { AiModelConfig } from "./types";

function env(name: string): string | undefined {
  // Next.js inlines only NEXT_PUBLIC_* at build time; read defensively so a
  // missing var is just "unset", never a crash.
  const e = (globalThis as Record<string, unknown>).process as
    | { env?: Record<string, string | undefined> }
    | undefined;
  return e?.env?.[name];
}

export const AI_PROVIDER = (env("AI_PROVIDER") ?? "puter") as "puter" | "none";

/**
 * Vision model — default: gpt-5-nano (via Puter).
 * Chosen for: image understanding (text+image input modalities), fast
 * latency on a small fast model (photo analysis is on the critical path),
 * structured-output reliability for JSON prompts, and the lowest input
 * cost per 1M tokens in Puter's OpenAI catalog (5 cents vs 250 for gpt-4o),
 * which keeps the user-pays experience light. Swap via VISION_MODEL to A/B
 * any vision-capable model in Puter's catalog (gemini-*-flash, gpt-4o, …).
 */
export const VISION_MODEL = env("VISION_MODEL") ?? "gpt-5-nano";

/**
 * Text model — default: gpt-5-nano.
 * Same rationale: short contextual answers (cooking help, re-ranking
 * recommendations) need reliability and sub-second-class latency more than
 * deep reasoning. Swap via TEXT_MODEL.
 */
export const TEXT_MODEL = env("TEXT_MODEL") ?? "gpt-5-nano";

/** Candidate fallbacks per capability, in order. Must all be vision-capable. */
export const VISION_MODEL_FALLBACKS = [
  VISION_MODEL,
  "gpt-4o-mini",
  "gpt-4o",
  "gemini-2.5-flash",
] as const;

export const TEXT_MODEL_FALLBACKS = [
  TEXT_MODEL,
  "gpt-4o-mini",
  "claude-3-5-haiku-latest",
] as const;

export const modelConfig: AiModelConfig = {
  provider: AI_PROVIDER,
  visionModel: VISION_MODEL,
  textModel: TEXT_MODEL,
};

/** Abort/timeouts per capability (ms) — photo analysis must not hang the UI. */
export const VISION_TIMEOUT_MS = 25_000;
export const TEXT_TIMEOUT_MS = 15_000;

/** Hard cap on image bytes sent to the model after client compression. */
export const MAX_IMAGE_BYTES = 1_400_000; // ~1.4 MB data-URL overhead included
