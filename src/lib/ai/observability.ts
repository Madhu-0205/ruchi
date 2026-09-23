// ─────────────────────────────────────────────────────────────
// RUCHI — AI observability (development-only, privacy-conscious)
// ─────────────────────────────────────────────────────────────
// Logs AI lifecycle events for debugging; never logs images, prompts that
// could contain personal text, or credentials. Production stays silent.

export type AiEventKind =
  | "vision_request_started"
  | "vision_success"
  | "vision_failure"
  | "recommendation_request"
  | "recommendation_failure"
  | "recommendation_success"
  | "recommendation_validation_failed"
  | "assistant_request"
  | "assistant_success"
  | "assistant_failure"
  | "fallback_triggered";

interface AiEvent {
  kind: AiEventKind;
  detail?: Record<string, string | number | boolean | undefined>;
  ts: number;
}

let recent: AiEvent[] = [];

export function logAiEvent(
  kind: AiEventKind | (string & {}),
  detail?: Record<string, string | number | boolean | undefined>,
): void {
  const evt: AiEvent = {
    kind: kind as AiEventKind,
    detail,
    ts: Date.now(),
  };
  recent.push(evt);
  recent = recent.slice(-100);

  if (process.env.NODE_ENV !== "production") {
    // No image bytes, no user text, no keys — ids and counters only.
    console.debug("[ruchi:ai]", evt.kind, detail ?? {});
  }
}

export function recentAiEvents(n = 20): AiEvent[] {
  return recent.slice(-n).reverse();
}

/** Test hook. */
export function clearAiEventsForTests(): void {
  recent = [];
}

// ── Vision pipeline diagnostics (development only) ──────────
// Emits [RUCHI-VISION] stage markers so a fallback can always be traced to
// the exact failing stage. Never logs image data, tokens, or credentials —
// metadata (dimensions, byte sizes, stage names, error messages) only.
// Production builds emit nothing.
export function visionDebug(
  stage: string,
  detail?: Record<string, string | number | boolean | undefined>,
): void {
  if (process.env.NODE_ENV === "production") return;
  console.info(`[RUCHI-VISION] ${stage}`, detail ?? "");
}

/** Last reason the vision chain fell back (dev diagnostics). */
let lastVisionFallback: string | null = null;

export function recordVisionFallback(reason: string): void {
  lastVisionFallback = reason;
  visionDebug(`fallback-reason=${reason}`);
}

export function getLastVisionFallback(): string | null {
  return lastVisionFallback;
}
