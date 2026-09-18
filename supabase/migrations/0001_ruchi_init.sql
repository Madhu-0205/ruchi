-- ═════════════════════════════════════════════════════════════
-- RUCHI — Supabase schema (migration 0001)
-- ═════════════════════════════════════════════════════════════
-- Supabase owns RUCHI identity + durable user data. Puter stays the AI
-- layer only and never touches these tables.
--
-- Apply with: supabase db push   (or paste into Dashboard → SQL Editor)
--
-- Security model:
-- - RLS is enabled on EVERY user-owned table; every policy checks
--   auth.uid() — the client's publishable key can never read or write
--   another user's rows.
-- - No service-role key is ever used by the app; no anon writes exist.
-- - Streak values are computed by the database from a client-supplied
--   LOCAL CALENDAR DATE only (see record_completed_meal_day). The client
--   can never write arbitrary streak numbers, so streaks are tamper-proof.
-- - Nutrition/cost values in completed_meals are snapshots produced by
--   the app's deterministic engine — never by an AI model.

-- ── profiles: 1:1 with auth.users ───────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  diet_preference text check (diet_preference in ('vegetarian', 'eggetarian', 'non-vegetarian')),
  cooking_skill text check (cooking_skill in ('beginner', 'comfortable', 'confident')),
  fitness_goal text check (fitness_goal in ('none', 'high-protein', 'weight-loss', 'lean-bulk')),
  preferred_time int check (preferred_time between 10 and 45), -- max minutes willing to cook
  budget_preference int check (budget_preference in (50, 100, 150, 200)), -- ₹ per meal
  default_servings int check (default_servings between 1 and 4),
  -- App-local preference lists (allergies, cuisines, equipment) kept as JSON
  -- so sync never drops them; the columns above are the queryable core.
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── completed_meals: append-only log (no client updates/deletes) ──
create table if not exists public.completed_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id text not null,
  recipe_name text not null,
  completed_at timestamptz not null default now(),
  local_date date not null, -- user's local calendar day of completion (drives streaks)
  servings int not null default 1,
  protein_g int not null default 0,
  calories int not null default 0,
  cost_inr int not null default 0,
  savings_inr int not null default 0, -- vs delivery compare price, app-computed
  created_at timestamptz not null default now()
);

create index if not exists completed_meals_user_recent_idx
  on public.completed_meals (user_id, completed_at desc);

-- ── cooking_streaks: ONE row per user, DB-computed ───────────
create table if not exists public.cooking_streaks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_completed_local_date date,
  updated_at timestamptz not null default now()
);

-- ═════════════════════════════════════════════════════════════
-- Row-Level Security
-- ═════════════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.completed_meals enable row level security;
alter table public.cooking_streaks enable row level security;

-- profiles: read / insert / update own row — never delete via client.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- completed_meals: select + insert own rows only. Append-only by design —
-- history cannot be silently rewritten from the client.
drop policy if exists "completed_meals_select_own" on public.completed_meals;
create policy "completed_meals_select_own" on public.completed_meals
  for select using (auth.uid() = user_id);

drop policy if exists "completed_meals_insert_own" on public.completed_meals;
create policy "completed_meals_insert_own" on public.completed_meals
  for insert with check (auth.uid() = user_id);

-- cooking_streaks: SELECT only. Writes go through the SECURITY DEFINER
-- RPC below, which derives values instead of trusting the client.
drop policy if exists "cooking_streaks_select_own" on public.cooking_streaks;
create policy "cooking_streaks_select_own" on public.cooking_streaks
  for select using (auth.uid() = user_id);

-- Grants: RLS filters rows, but Postgres also needs explicit table
-- privileges. Supabase's default privileges would grant these, but being
-- explicit is safer and keeps parity with any environment. The anon role
-- gets schema usage only — no table access (default-deny under RLS).
grant usage on schema public to authenticated, anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.completed_meals to authenticated;
grant select on public.cooking_streaks to authenticated;
revoke all on public.profiles from anon;
revoke all on public.completed_meals from anon;
revoke all on public.cooking_streaks from anon;

-- ═════════════════════════════════════════════════════════════
-- Streak RPC — the ONLY write path for cooking_streaks
-- ═════════════════════════════════════════════════════════════
-- The client sends ONE argument: the meal's local calendar date
-- (YYYY-MM-DD, from the app's deterministic dayKeyOf). The database
-- derives current/longest deterministically:
--   • same date as last completion      → no-op (duplicate prevention)
--   • exactly the next local day        → streak + 1
--   • any gap                           → reset to 1
--   • older date (late sync)            → no-op (never reduces/rewrites)
-- This mirrors the client's computeStreak() so both stay consistent.
create or replace function public.record_completed_meal_day(p_local_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_last date;
  v_current int;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;
  if p_local_date is null then
    raise exception 'local_date is required';
  end if;

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
  -- same-day or older dates intentionally do nothing
end;
$$;

grant execute on function public.record_completed_meal_day(date) to authenticated;
revoke execute on function public.record_completed_meal_day(date) from anon;

-- ═════════════════════════════════════════════════════════════
-- Auto-create a profile row when a user signs up
-- ═════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
