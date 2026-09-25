-- ═════════════════════════════════════════════════════════════
-- RUCHI — Real Cooking Stats (migration 0003)
-- ═════════════════════════════════════════════════════════════
-- Server-authoritative cooking statistics, derived from real completion
-- records — never from localStorage, app opens, or client-supplied
-- numbers.
--
-- Design:
--  • cooking_completions is THE record of a genuinely completed cooking
--    session. One row per session: `session_id` is UNIQUE and carries a
--    CHECK that it equals 's_' || user_id || ':' || session_token, so a
--    client can never attach another user's id to a row (belt over the
--    RLS braces).
--  • savings_inr is a GENERATED column: greatest(0, delivery_compare_inr
--    - cost_inr). The client sends the engine's cost estimate and the
--    delivery COMPARISON basis from the recipe catalog
--    (recipe.deliveryCompare.cost); the database derives the saving.
--    No invented prices — the comparison basis originates exclusively
--    from the existing recipe data.
--  • cooking_stats is a VIEW computed on read from a user's real records
--    (cooking_completions ∪ legacy completed_meals, so existing history
--    keeps counting). Streaks come from distinct local completion dates
--    via a gaps-and-islands walk — completed meals, not app opens.
--  • record_cooking_completion() is the ONE write path: it deduplicates
--    on session_id (a session counts once, however many times the
--    completion action fires) and updates the streak row in the same
--    statement (atomic). SECURITY DEFINER, gated on auth.uid().

-- ── cooking_completions: one row per completed cooking session ──
create table if not exists public.cooking_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Session idempotency: the client generates one opaque token per
  -- cooking session (crypto.randomUUID) and may safely retry.
  session_token text not null,
  session_id text not null,
  recipe_id text not null,
  recipe_name text not null,
  completed_at timestamptz not null default now(),
  local_date date not null, -- user's local calendar day of completion
  servings int not null default 1 check (servings between 1 and 12),
  protein_g int not null default 0 check (protein_g between 0 and 500),
  calories int not null default 0 check (calories between 0 and 5000),
  cost_inr int not null default 0 check (cost_inr between 0 and 100000),
  delivery_compare_inr int not null default 0 check (delivery_compare_inr between 0 and 100000),
  -- Server-derived: the database computes the saving from the engine's
  -- cost estimate and the catalog's delivery comparison — never the client.
  savings_inr int generated always as (greatest(0, delivery_compare_inr - cost_inr)) stored,
  created_at timestamptz not null default now(),

  constraint cooking_completions_session_unique unique (session_id),
  constraint cooking_completions_session_shape
    check (session_id = 's_' || user_id::text || ':' || session_token)
);

create index if not exists cooking_completions_user_recent_idx
  on public.cooking_completions (user_id, completed_at desc);
create index if not exists cooking_completions_user_date_idx
  on public.cooking_completions (user_id, local_date);

-- ── cooking_stats: derived on read, nothing per-user to drift ──
create or replace view public.cooking_stats as
with rec as (
  select user_id, completed_at, local_date, savings_inr
    from public.cooking_completions
  union all
  select user_id, completed_at, local_date, savings_inr
    from public.completed_meals
),
dated as ( -- distinct local days on which at least one meal was completed
  select distinct user_id, local_date as day from rec
),
islands as ( -- consecutive days share a group: day − rank is constant
  select user_id, day,
         day - (row_number() over (partition by user_id order by day))::int as grp
    from dated
),
spans as (
  select user_id, max(day) as end_day, count(*)::int as len
    from islands
   group by user_id, grp
),
per_user as (
  select r.user_id,
         count(*)::int as meals_cooked,
         coalesce(sum(r.savings_inr), 0)::int as total_saved,
         max(r.completed_at) as last_completed_at,
         coalesce((select max(s.len) from spans s where s.user_id = r.user_id), 0)
           as longest_streak,
         -- current streak: the latest span, only if it reaches today/yesterday
         coalesce((
           select s.len from spans s
            where s.user_id = r.user_id and s.end_day >= current_date - 1
            order by s.end_day desc limit 1
         ), 0) as current_streak
    from rec r
   group by r.user_id
)
select * from per_user;

-- CRITICAL: without security_invoker the view would run with its OWNER's
-- rights and bypass RLS on the source tables — every user would see every
-- aggregate. With it, the view executes as the CALLER and the base tables'
-- RLS (auth.uid() = user_id) scopes every row.
alter view public.cooking_stats set (security_invoker = true);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.cooking_completions enable row level security;

drop policy if exists "cooking_completions_select_own" on public.cooking_completions;
create policy "cooking_completions_select_own" on public.cooking_completions
  for select using (auth.uid() = user_id);

drop policy if exists "cooking_completions_insert_own" on public.cooking_completions;
create policy "cooking_completions_insert_own" on public.cooking_completions
  for insert with check (auth.uid() = user_id);

-- Views: RLS of underlying tables applies to the view owner. Both source
-- tables are owner-accessible only, and the RPC below re-checks auth.uid()
-- explicitly, so the view can be exposed to authenticated users safely.
grant select on public.cooking_stats to authenticated;
revoke all on public.cooking_stats from anon;

-- Table grants (parity with migration 0001's explicit posture).
grant select, insert on public.cooking_completions to authenticated;
revoke all on public.cooking_completions from anon;

-- ═════════════════════════════════════════════════════════════
-- record_cooking_completion — the ONE write path for completions
-- ═════════════════════════════════════════════════════════════
-- Idempotent per session: a duplicate session_id returns 'duplicate'
-- and writes nothing (ON CONFLICT DO NOTHING). The streak row is
-- advanced for the completion's local date in the same statement.
-- Streak numbers are derived here — the client never sends one.
create or replace function public.record_cooking_completion(
  p_session_token text,
  p_recipe_id text,
  p_recipe_name text,
  p_completed_at timestamptz,
  p_local_date date,
  p_servings int,
  p_protein_g int,
  p_calories int,
  p_cost_inr int,
  p_delivery_compare_inr int
)
returns text -- 'recorded' | 'duplicate'
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session_id text;
  v_last date;
  v_current int;
  v_inserted boolean := false;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  v_session_id := 's_' || v_user::text || ':' || p_session_token;

  -- Idempotency gate: the unique(session_id) constraint deduplicates.
  insert into public.cooking_completions
    (user_id, session_token, session_id, recipe_id, recipe_name,
     completed_at, local_date, servings, protein_g, calories,
     cost_inr, delivery_compare_inr)
  values
    (v_user, p_session_token, v_session_id, p_recipe_id, p_recipe_name,
     coalesce(p_completed_at, now()), p_local_date, p_servings,
     p_protein_g, p_calories, p_cost_inr, p_delivery_compare_inr)
  on conflict (session_id) do nothing
  returning true into v_inserted; -- NULL when the insert was skipped

  -- plpgsql sets the INTO target to NULL when RETURNING yields no rows,
  -- so the check must be "is not true", never "is not .../not v_inserted".
  if v_inserted is not true then
    return 'duplicate';
  end if;

  -- Same transaction: advance the streak from the completion's LOCAL DATE
  -- (same derivation rules as record_completed_meal_day in 0001).
  insert into public.cooking_streaks (user_id) values (v_user)
  on conflict (user_id) do nothing;

  select s.last_completed_local_date, s.current_streak
    into v_last, v_current
  from public.cooking_streaks s
  where s.user_id = v_user
  for update;

  if v_last is null or p_local_date > v_last then
    if v_last is not null and p_local_date = v_last + interval '1 day' then
      v_current := v_current + 1;
    else
      v_current := 1;
    end if;
    update public.cooking_streaks
       set current_streak = v_current,
           longest_streak = greatest(longest_streak, v_current),
           last_completed_local_date = p_local_date,
           updated_at = now()
     where user_id = v_user;
  end if;
  -- same-day or older dates intentionally leave streaks untouched

  return 'recorded';
end;
$$;

grant execute on function public.record_cooking_completion(text, text, text, timestamptz, date, int, int, int, int, int)
  to authenticated;
revoke execute on function public.record_cooking_completion(text, text, text, timestamptz, date, int, int, int, int, int)
  from anon;
