# RUCHI — Notification Layer Design (Future)

**Status:** Design only. Nothing here is implemented. The in-app Re-Attention
Context Engine (`src/lib/context/attention.ts`) is the prerequisite and is
already live.

## 1. The principle

The context engine answers **whether** there is a genuine reason to re-engage
("You already have dinner", "You were halfway through dinner"). A notification
layer must never answer that question itself — it only answers **how to
deliver** a context the engine has already decided is worth surfacing, and
**whether the user's channel preferences allow it**.

> The engine decides *if*. The layer decides *how*. Neither decides *how often
> to beg* — suppression stays in one place.

This keeps the recommendation engine, personality copy, and attention logic
completely decoupled from any provider (web push, email, WhatsApp, widgets).

## 2. Layered architecture

```
┌────────────────────────────────────────────────────────────┐
│  CONTEXT ENGINE (pure, exists today)                       │
│  evaluateAttention(input) → AttentionContext | "none"      │
│  isSuppressed(ctx, state, now) → boolean                   │
│  No I/O. No provider knowledge. Runs client-side today.    │
└──────────────────────────┬─────────────────────────────────┘
                           │ same pure functions, run server-side
┌──────────────────────────▼─────────────────────────────────┐
│  DELIVERY PLANNER (new, server)                            │
│  planDeliveries(user, now, engineInput) → PlannedMessage[] │
│  • runs evaluateAttention for users who opted in           │
│  • applies channel rules + quiet hours + global caps       │
│  • reuses isSuppressed + per-user attention state          │
│  • outputs PlainMessage — no channel markup                │
└──────────────────────────┬─────────────────────────────────┘
┌──────────────────────────▼─────────────────────────────────┐
│  DELIVERY ADAPTERS (new, swappable)                        │
│  interface DeliveryAdapter {                               │
│    channel: Channel;                                       │
│    isAvailable(user): Promise<boolean>;                    │
│    deliver(msg: PlainMessage): Promise<DeliveryResult>;    │
│  }                                                         │
│  Implementations: WebPushAdapter, EmailAdapter, (later:    │
│  WhatsAppAdapter, WidgetAdapter). Adding one touches       │
│  NOTHING upstream.                                         │
└────────────────────────────────────────────────────────────┘
```

## 3. Contracts

### PlainMessage — the only thing that crosses the boundary

```ts
interface PlainMessage {
  userId: string;
  contextType: AttentionType;      // traceability back to the engine
  recipeId?: string;
  headline: string;                // engine copy — never re-written per channel
  supportingText?: string;
  deepLink: string;                // "/" or "/?resume=<recipeId>"
  expiresAt: number;               // stale context ≠ notification; drop it
}
```

Adapters receive `PlainMessage` and do channel formatting themselves.
Context copy comes from the engine's `COPY` tables — the notification should
read identically to what Home would have shown. If a channel can't render a
context well (e.g. a recipe-less `cooking_gap`), the adapter may **decline**
(`deliver` → `{ ok: false, reason: "unsuitable-context" }`), never improvise.

### Adapter interface

```ts
type Channel = "web_push" | "email" | "whatsapp" | "widget";

interface DeliveryResult {
  ok: boolean;
  reason?: "unsuitable-context" | "user-unavailable" | "provider-error";
}

interface DeliveryAdapter {
  channel: Channel;
  /** Cheap check: token exists? subscription live? address verified? */
  isAvailable(user: NotificationPrefs): Promise<boolean>;
  deliver(msg: PlainMessage): Promise<DeliveryResult>;
}
```

### User preferences (new table, migration 0004 when built)

```sql
create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  channels jsonb not null default '{}',        -- { web_push: true, email: false }
  web_push_subscription jsonb,                 -- PushSubscription, or null
  quiet_hours jsonb not null default '{"start":22,"end":8}',
  max_per_week int not null default 2,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
-- RLS: own-rows only, same posture as cooking_completions (0003).
```

Defaults are **off**. RUCHI never ships notifications-on-by-default; the
Profile screen gets an explicit, quiet opt-in ("Nudge me when dinner's waiting
in the fridge" — one toggle, not a settings maze).

### Server-side suppression (mirror of the client contract)

The client persists `attention` in `ruchi.store.v1`. The server needs its own
authoritative mirror so a notification never duplicates what Home already
showed, and so suppression survives cleared browsers:

```sql
-- added to notification_prefs or a sibling table
attention_state jsonb not null default '{}'
-- shape: { lastShown: { type, recipeId, at }, suppressionUntil }
```

**Contract:** the server writes `lastShown` when it *delivers*; the client
writes it when it *shows in-app*. Both sides consult `isSuppressed()` before
acting. Because `isSuppressed` is pure and shared, both surfaces obey the same
cooldowns with zero duplicated logic. One clock skew note: pass `now`
explicitly everywhere (the engine already requires this).

## 4. Scheduler (Vercel Cron)

One cron job, no infrastructure:

```jsonc
// vercel.json (when built)
{ "crons": [{ "path": "/api/notifications/run", "schedule": "0 10,18 * * *" }] }
```

Two daily runs (10:00 pre-lunch, 18:00 pre-dinner IST) — deliberately few.
`/api/notifications/run`:

1. Selects opted-in users (batched, service-role key, server-only env).
2. For each: builds `AttentionInput` from their **real** data — kitchen
   snapshot, `completed_meals` / `cooking_completions`, `pausedCooking` (which
   would move to the server alongside the other durable state), attention state.
3. `evaluateAttention(...)` → `none` means **silence** (the majority outcome —
   that's the product working).
4. Checks quiet hours, weekly cap (`max_per_week`), `isSuppressed`.
5. Picks ONE adapter by preference order (user's enabled channels; web push
   first, email fallback), delivers, records the delivery **into the same
   suppression state it just consulted**.

The route returns 200 and processes a bounded batch; a long queue self-limits
and resumes next cron. No queue infrastructure until volume demands it.

## 5. Deliberate constraints

- **No notification for `incomplete_session` in v1.** A resume is urgent only
  in-session; cross-session push for a paused pan risks feeling tracked. It
  stays an in-app surface.
- **Deep-link parity:** every notification lands on a Home state that would
  have shown the same context organically. If the user taps and Home doesn't
  reflect the message, that's a bug — the context must be reproducible from
  state at tap time (the `expiresAt` on PlainMessage enforces dropping stale
  ones instead).
- **Respect `re_attention_dismissed`:** a notification dismissal maps to the
  same `dismissAttention()` mute (2h) the in-app surface uses. "Not now" must
  mean not now everywhere.
- **No streak pushes, ever.** The existing streak is celebrated in-app after
  real completions; it is never a lever for pull-based messaging.
- **Metrics reuse the existing funnel:** `re_attention_shown` (channel:
  notification) → `clicked` → `recipe_selected` → `cooking_started` →
  `cooking_completed`. The north-star stays *completed meals per active
  user* — never notification CTR. `forward()` in
  `src/lib/engine/analytics.ts` is where the provider sinks in.

## 6. Build order (when greenlit)

1. `notification_prefs` migration + Profile opt-in toggle (RLS posture copied from 0003).
2. `PlainMessage` + `DeliveryAdapter` types in `src/lib/notifications/` (no impl).
3. `WebPushAdapter` (VAPID, web-push protocol; server route stores subscriptions).
4. Cron route + DeliveryPlanner using the existing pure engine functions.
5. Server-side attention-state mirror + double-suppression tests.

Steps 1–2 are pure additons and shippable independently; 3–5 activate delivery.

## 7. What this design deliberately avoids

- A notification *center* inside the app (the nudge inbox already covers
  quiet in-app messaging; notifications are pull-delivered, never archived).
- Per-provider copy decks, templates, or scheduling logic upstream of the
  adapter boundary.
- Any coupling between `src/lib/engine/match.ts` (recommendations) and any
  notification concern — the engine keeps returning `MatchScore`s and nothing
  else.
