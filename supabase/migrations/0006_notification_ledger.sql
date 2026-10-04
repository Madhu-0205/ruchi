-- ═════════════════════════════════════════════════════════════
-- RUCHI — Notification ledger + per-type prefs (migration 0006)
-- ═════════════════════════════════════════════════════════════
-- Notification Experience 2.0, part 1 of 2 (server side):
--
--  1. notification_ledger — the ONE server-authoritative record of
--     notification outcomes (sent / failed / suppressed) with a
--     per-user dedup key so repeated cron execution can NEVER send
--     the same notification twice. The ledger is also the funnel
--     record: opened_at / actioned_at land here from the client RPC.
--  2. notification_prefs.type_prefs — per-opportunity-type opt-outs
--     (resume, follow-ups, ingredient ideas, cook again, timing,
--     discovery, personality). Absent key = default ON; the master
--     channels.web_push gate still rules everything.
--  3. mark_notification_engaged() — the only client write path into
--     the ledger: sets opened_at / actioned_at on the caller's OWN
--     row. Everything else is service-role only.
--
-- RLS posture:
--  • notification_ledger: SELECT own rows only. NO insert/update/
--    delete policies — clients cannot forge deliveries; the cron
--    route (service role) bypasses RLS.
--  • Suppressed rows carry no dedup key (the partial unique index
--    ignores NULLs), so a suppression today never blocks a genuine
--    send later.

-- ── 1. Ledger ────────────────────────────────────────────────
create table if not exists public.notification_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'sent'      = delivered through a channel adapter
  -- 'failed'    = adapter declined/errored (retry blocked for this
  --               dedup key — next cycle gets a fresh key)
  -- 'suppressed' = policy blocked the send (reason recorded)
  status text not null default 'sent'
    constraint notification_ledger_status
    check (status in ('sent', 'failed', 'suppressed')),
  -- The 2.0 opportunity type (resume_cooking, cook_again, …).
  opportunity_type text not null
    constraint notification_ledger_opportunity_type
    check (opportunity_type in (
      'resume_cooking', 'explicit_followup', 'ingredient_opportunity',
      'cook_again', 'contextual_meal', 'discover_opportunity', 'personality'
    )),
  -- Idempotency key (see partial unique index below). NULL on
  -- suppressed rows only.
  dedup_key text,
  title text not null default '',
  body text not null default '',
  destination text,
  recipe_id text,
  suppression_reason text
    constraint notification_ledger_suppression_reason
    check (suppression_reason is null or suppression_reason in (
      'quiet_hours', 'recently_notified', 'recently_opened',
      'active_session', 'recently_cooked', 'no_valid_opportunity',
      'duplicate', 'user_disabled', 'daily_cap', 'weekly_cap',
      'low_confidence', 'no_subscription'
    )),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  opened_at timestamptz,
  actioned_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists notification_ledger_user_recent
  on public.notification_ledger (user_id, created_at desc);

-- THE idempotency guarantee: one send per (user, dedup key). The cron
-- inserts before delivering; a unique violation (23505) means "this
-- notification already went out" and the cycle skips. Partial on
-- dedup_key so suppressed rows never occupy a send slot.
create unique index if not exists notification_ledger_dedup
  on public.notification_ledger (user_id, dedup_key)
  where dedup_key is not null;

alter table public.notification_ledger enable row level security;

drop policy if exists "notification_ledger_select_own" on public.notification_ledger;
create policy "notification_ledger_select_own" on public.notification_ledger
  for select using (auth.uid() = user_id);

-- Clients READ their own funnel rows; they never write directly.
grant select on public.notification_ledger to authenticated;
revoke all on public.notification_ledger from anon;
revoke insert, update, delete on public.notification_ledger from authenticated;

-- ── 2. Engagement RPC (the one client write path) ────────────
-- Marks a notification opened (first call wins) and optionally
-- actioned (the user did the thing — started cooking). Foreign or
-- bogus ids are a silent no-op; the row must belong to the caller.

create or replace function public.mark_notification_engaged(
  p_ledger_id uuid,
  p_actioned boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.notification_ledger
     set opened_at = coalesce(opened_at, now()),
         actioned_at = case
           when p_actioned then coalesce(actioned_at, now())
           else actioned_at end,
         updated_at = now()
   where id = p_ledger_id
     and user_id = auth.uid();
end;
$$;

revoke all on function public.mark_notification_engaged(uuid, boolean) from anon;
revoke all on function public.mark_notification_engaged(uuid, boolean) from public;
grant execute on function public.mark_notification_engaged(uuid, boolean) to authenticated;

-- ── 3. Per-type prefs on notification_prefs ──────────────────
alter table public.notification_prefs
  add column if not exists type_prefs jsonb not null default '{}'::jsonb;

-- A REAL paused cooking session (never inferred): the server-side
-- RESUME_COOKING signal. Written by the client when the user exits
-- Cooking Mode mid-recipe; cleared on resume/completion. Read by the
-- cron route and dropped as a candidate when stale (>12h, engine rule).
alter table public.notification_prefs
  add column if not exists paused_session jsonb;

alter table public.notification_prefs
  drop constraint if exists notification_prefs_types_shape;
alter table public.notification_prefs
  add constraint notification_prefs_types_shape check (
    jsonb_typeof(type_prefs) = 'object'
    and (jsonb_typeof(type_prefs -> 'resume_cooking') is null
         or jsonb_typeof(type_prefs -> 'resume_cooking') = 'boolean')
    and (jsonb_typeof(type_prefs -> 'explicit_followup') is null
         or jsonb_typeof(type_prefs -> 'explicit_followup') = 'boolean')
    and (jsonb_typeof(type_prefs -> 'ingredient_opportunity') is null
         or jsonb_typeof(type_prefs -> 'ingredient_opportunity') = 'boolean')
    and (jsonb_typeof(type_prefs -> 'cook_again') is null
         or jsonb_typeof(type_prefs -> 'cook_again') = 'boolean')
    and (jsonb_typeof(type_prefs -> 'contextual_meal') is null
         or jsonb_typeof(type_prefs -> 'contextual_meal') = 'boolean')
    and (jsonb_typeof(type_prefs -> 'discover_opportunity') is null
         or jsonb_typeof(type_prefs -> 'discover_opportunity') = 'boolean')
    and (jsonb_typeof(type_prefs -> 'personality') is null
         or jsonb_typeof(type_prefs -> 'personality') = 'boolean')
  );

-- Unknown type keys are rejected (trigger — CHECKs can't loop).
create or replace function public.validate_notification_type_prefs()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  k text;
begin
  if jsonb_typeof(new.type_prefs) <> 'object' then
    raise exception 'type_prefs must be a JSON object';
  end if;
  for k in select jsonb_object_keys(new.type_prefs) loop
    if k not in (
      'resume_cooking', 'explicit_followup', 'ingredient_opportunity',
      'cook_again', 'contextual_meal', 'discover_opportunity', 'personality'
    ) then
      raise exception 'unknown notification opportunity type: %', k;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists notification_prefs_types_validate on public.notification_prefs;
create trigger notification_prefs_types_validate
  before insert or update on public.notification_prefs
  for each row execute function public.validate_notification_type_prefs();
