// ─────────────────────────────────────────────────────────────
// RUCHI — Notification layer: boundary contracts
// ─────────────────────────────────────────────────────────────
// Build-order step 2 of docs/NOTIFICATION_LAYER.md. Types only —
// no implementation, no provider knowledge. The Context Engine
// decides IF there is a genuine reason to reach the user; this
// layer only decides HOW to deliver it, inside the user's
// channel preferences. Neither decides "how often to beg".
//
// Everything here is pure/describable: PlainMessage carries engine
// copy verbatim (never re-written per channel), and adapters may
// DECLINE a message they can't render well (deliver → ok:false,
// reason:"unsuitable-context") — they never improvise copy.

/** The delivery channels RUCHI can eventually speak. */
export type Channel = "web_push" | "email" | "whatsapp" | "widget";

/**
 * A delivery-agnostic message. Produced exclusively from an
 * AttentionContext the engine already decided to surface.
 */
export interface PlainMessage {
  userId: string;
  /** Traceability back to the engine's decision. */
  contextType: string;
  /** Present when the context is about one specific dish. */
  recipeId?: string;
  /** Engine copy — identical to what Home would have shown. */
  headline: string;
  supportingText?: string;
  /** In-app route the tap lands on ("/" or "/?resume=<recipeId>"). */
  deepLink: string;
  /**
   * Epoch ms after which the message is stale and must be DROPPED,
   * not delivered — stale context ≠ notification.
   */
  expiresAt: number;
}

export type DeliveryFailureReason =
  | "unsuitable-context"
  | "user-unavailable"
  | "provider-error";

export interface DeliveryResult {
  ok: boolean;
  reason?: DeliveryFailureReason;
}

/**
 * One adapter per channel. Adding a channel touches NOTHING upstream:
 * the planner only sees this interface.
 */
export interface DeliveryAdapter {
  channel: Channel;
  /** Cheap check: subscription/token/address exists and looks live. */
  isAvailable(prefs: AdapterPrefs): Promise<boolean>;
  deliver(msg: PlainMessage): Promise<DeliveryResult>;
}

/** The slice of notification_prefs an adapter may consult. */
export interface AdapterPrefs {
  channels: Partial<Record<Channel, boolean>>;
  webPushSubscription?: unknown | null;
}
