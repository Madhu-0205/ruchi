// ─────────────────────────────────────────────────────────────
// RUCHI — analytics
// ─────────────────────────────────────────────────────────────
// MVP: appends to a local buffer (console.debug + in-memory tail).
// Later: forward(buffer) is where Amplitude/Mixpanel/GA/PostHog wires in.
// North-star metric architecture: `delivery_saved_metric` marks every cook
// that intercepted an intended delivery order.

import type { AnalyticsEvent, AnalyticsEventName } from "@/lib/types";

const BUFFER_KEY = "ruchi.analytics.v1";
const MAX_EVENTS = 500;

let buffer: AnalyticsEvent[] = [];

function load(): AnalyticsEvent[] {
  if (buffer.length > 0) return buffer;
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BUFFER_KEY);
    buffer = raw ? (JSON.parse(raw) as AnalyticsEvent[]) : [];
  } catch {
    buffer = [];
  }
  return buffer;
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BUFFER_KEY, JSON.stringify(buffer.slice(-MAX_EVENTS)));
  } catch {
    // storage full / private mode — analytics must never break UX
  }
}

export function track(
  name: AnalyticsEventName,
  props?: Record<string, string | number | boolean>,
) {
  const evt: AnalyticsEvent = { name, props, ts: Date.now() };
  load();
  buffer.push(evt);
  buffer = buffer.slice(-MAX_EVENTS);
  persist();
  if (process.env.NODE_ENV === "development") {
    console.debug("[ruchi]", name, props ?? {});
  }
}

/** Wire a real provider here later. */
export function forward(_sink: (events: AnalyticsEvent[]) => void) {
  // no-op in MVP; extension point
}

export function recentEvents(n = 50): AnalyticsEvent[] {
  return load().slice(-n).reverse();
}
