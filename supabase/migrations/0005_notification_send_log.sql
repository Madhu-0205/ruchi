-- ═════════════════════════════════════════════════════════════
-- RUCHI — Notification delivery log (migration 0005)
-- ═════════════════════════════════════════════════════════════
-- Build-order step 3–5 support table: the weekly send counters the
-- notification cron enforces (max_per_week from notification_prefs).
--
-- Design:
--  • ONE row per user: `weeks` is a JSON object keyed by the
--    Monday-anchored UTC week (weekKeyOf) → delivered count. Small,
--    self-pruning (old weeks just stop being read; the cron writes
--    the current week), and readable server-side only — the client
--    never needs it (suppression + caps are server-enforced).
--  • RLS: no policies at all — the table is service-role only.
--    The anon/authenticated roles get nothing, so RLS denies all.

create table if not exists public.notification_send_log (
  user_id uuid primary key references auth.users (id) on delete cascade,
  weeks jsonb not null default '{}'::jsonb
    constraint notification_send_log_weeks_shape
    check (jsonb_typeof(weeks) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.notification_send_log enable row level security;

-- Deliberately NO policies: only the service role (the cron route)
-- reads and writes this table. grant/revoke make the posture explicit.
revoke all on public.notification_send_log from anon;
revoke all on public.notification_send_log from authenticated;
