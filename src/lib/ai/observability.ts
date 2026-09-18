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
  | "fallback_triggered"
  // Puter auth-popup lifecycle (development diagnostics)
  | "auth_popup_open"
  | "auth_popup_blocked"
  | "auth_start"
  | "auth_success"
  | "auth_cancel"
  | "auth_failure"
  | "auth_timeout";

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

/** Live snapshot of the Puter sign-in state for diagnostics. */
export function authStateSnapshot(): Record<string, string | number | boolean | undefined> {
  if (typeof window === "undefined") return { env: "server" };
  const puter = (
    window as unknown as {
      puter?: {
        authToken?: string | null;
        env?: string;
        puterAuthState?: { isPromptOpen?: boolean; authGranted?: boolean | null };
      };
    }
  ).puter;
  return {
    hasSdk: Boolean(puter),
    signedIn: Boolean(puter?.authToken),
    env: puter?.env,
    promptOpen: puter?.puterAuthState?.isPromptOpen,
    // authGranted's null ("prompt never shown") is normalized to undefined for a
    // compact event payload.
    authGranted: puter?.puterAuthState?.authGranted ?? undefined,
  };
}

export function recentAiEvents(n = 20): AiEvent[] {
  return recent.slice(-n).reverse();
}

/** Test hook. */
export function clearAiEventsForTests(): void {
  recent = [];
}
