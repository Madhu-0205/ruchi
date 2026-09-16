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
  | "chat_failure"
  | "sdk_loaded"
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
