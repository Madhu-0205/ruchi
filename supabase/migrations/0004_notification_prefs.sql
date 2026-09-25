-- ═════════════════════════════════════════════════════════════
-- RUCHI — Notification preferences (migration 0004)
-- ═════════════════════════════════════════════════════════════
-- Build-order step 1 of the notification layer (docs/NOTIFICATION_LAYER.md):
-- the opt-in storage + the server-side mirror of the attention-suppression
-- state. NO delivery logic lives here — this table only records what the
-- user allows and what has already been shown.
--
-- Design rules:
--  • DEFAULTS ARE OFF. A row's absence means "no notifications". The row is
--    only created when the user explicitly opts in from Profile.
--  • RLS is the boundary: own-rows only, same posture as 0003. There is no
--    service-role write path yet (the future cron route will use it).
--  • channels is a JSON object keyed by channel name; only known channel
--    keys are accepted, and every value must be a boolean.
--  • attention_state mirrors the client's ruchi.store.v1 `attention` shape
--    ({ lastShown: { type, recipeId, at }, suppressionUntil }) so the pure
--    isSuppressed() contract can be enforced identically on both sides.

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Opt-in flags per channel. Absent/false = off. Empty object = row exists
  -- (prefs saved) but nothing enabled. The CHECK validates that any PRESENT
  -- known channel carries a boolean; unknown keys are rejected by the
  -- notification_prefs_channels_validate trigger below (Postgres CHECKs
  -- cannot contain subqueries).
  channels jsonb not null default '{}'::jsonb
    constraint notification_prefs_channels_shape
    check (
      jsonb_typeof(channels) = 'object'
      and (
        jsonb_typeof(channels -> 'web_push') is null
        or jsonb_typeof(channels -> 'web_push') = 'boolean'
      )
      and (
        jsonb_typeof(channels -> 'email') is null
        or jsonb_typeof(channels -> 'email') = 'boolean'
      )
      and (
        jsonb_typeof(channels -> 'whatsapp') is null
        or jsonb_typeof(channels -> 'whatsapp') = 'boolean'
      )
      and (
        jsonb_typeof(channels -> 'widget') is null
        or jsonb_typeof(channels -> 'widget') = 'boolean'
      )
    ),
  -- Reserved for build-order step 3 (WebPushAdapter). Null until granted.
  web_push_subscription jsonb,
  -- Local-hour quiet window [start, end); outside it nothing is delivered.
  quiet_hours jsonb not null default '{"start":22,"end":8}'::jsonb
    constraint notification_prefs_quiet_shape
    check (
      jsonb_typeof(quiet_hours) = 'object'
      and jsonb_typeof(quiet_hours -> 'start') = 'number'
      and jsonb_typeof(quiet_hours -> 'end') = 'number'
      and (quiet_hours ->> 'start')::int between 0 and 23
      and (quiet_hours ->> 'end')::int between 0 and 23
    ),
  -- Global frequency cap — RUCHI is calm by construction.
  max_per_week int not null default 2
    constraint notification_prefs_cap_range check (max_per_week between 0 and 7),
  -- Server-side mirror of the attention suppression state (see header).
  attention_state jsonb not null default '{}'::jsonb
    constraint notification_prefs_attention_shape
    check (jsonb_typeof(attention_state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── RLS: own-rows only (parity with 0003) ────────────────────
alter table public.notification_prefs enable row level security;

drop policy if exists "notification_prefs_select_own" on public.notification_prefs;
create policy "notification_prefs_select_own" on public.notification_prefs
  for select using (auth.uid() = user_id);

drop policy if exists "notification_prefs_insert_own" on public.notification_prefs;
create policy "notification_prefs_insert_own" on public.notification_prefs
  for insert with check (auth.uid() = user_id);

drop policy if exists "notification_prefs_update_own" on public.notification_prefs;
create policy "notification_prefs_update_own" on public.notification_prefs
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notification_prefs_delete_own" on public.notification_prefs;
create policy "notification_prefs_delete_own" on public.notification_prefs
  for delete using (auth.uid() = user_id);

-- Table grants: the client manages its own prefs row; no anon access.
grant select, insert, update, delete on public.notification_prefs to authenticated;
revoke all on public.notification_prefs from anon;

-- ── Channel keys: whitelist enforced by trigger ──────────────
-- (CHECK constraints can't run subqueries, so unknown-key rejection
-- happens here — same guarantee, trigger-shaped.)
create or replace function public.validate_notification_channels()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  k text;
begin
  if jsonb_typeof(new.channels) <> 'object' then
    raise exception 'channels must be a JSON object';
  end if;
  for k in select jsonb_object_keys(new.channels) loop
    if k not in ('web_push', 'email', 'whatsapp', 'widget') then
      raise exception 'unknown notification channel: %', k;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists notification_prefs_channels_validate on public.notification_prefs;
create trigger notification_prefs_channels_validate
  before insert or update on public.notification_prefs
  for each row execute function public.validate_notification_channels();

-- ── Keep updated_at honest on any update ─────────────────────
create or replace function public.touch_notification_prefs()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notification_prefs_touch on public.notification_prefs;
create trigger notification_prefs_touch
  before update on public.notification_prefs
  for each row execute function public.touch_notification_prefs();
