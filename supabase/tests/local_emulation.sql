-- ═════════════════════════════════════════════════════════════
-- Supabase emulation for local migration verification (TEST ONLY)
-- ═════════════════════════════════════════════════════════════
-- Lets the RUCHI migration run against a plain local Postgres by
-- supplying the Supabase pieces it depends on: the `auth` schema, an
-- auth.users table, and an auth.uid() backed by the
-- request.jwt.claim.sub GUC — the same mechanism PostgREST uses to
-- expose the caller's identity to RLS policies.
--
-- This file is a verification harness, NOT production schema. It is
-- never applied to Supabase (which provides all of this natively).
-- Local roles `authenticated`/`anon` are faked via a role variable so
-- role-specific grants can be checked too.

-- The role Supabase connections use; must exist before the migration runs.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- auth.uid(): the caller's identity from the JWT claim GUC.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Fake Supabase role: 'authenticated' when a claim exists, else 'anon'.
create or replace function auth.role() returns text
language sql stable
as $$
  select case
    when nullif(current_setting('request.jwt.claim.sub', true), '') is not null
    then 'authenticated' else 'anon'
  end;
$$;
