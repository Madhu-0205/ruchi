-- ═════════════════════════════════════════════════════════════
-- RUCHI 0002 — beta_feedback (controlled beta)
-- ═════════════════════════════════════════════════════════════
-- Minimal, privacy-conscious feedback for the beta period:
--   • signed-in users only (RLS needs auth.uid(); anonymous testers
--     are told to sign in — no anonymous spam row possible)
--   • append-only: insert + select-own. No update/delete policies,
--     so nothing can be edited or wiped from the client.
--   • no email/ip/user-agent captured — auth.uid() identifies the
--     reporter inside the project; message content is user-typed only.
-- Reading all feedback (moderation) happens in the Supabase dashboard
-- under the project owner's own credentials — never via a service key
-- in the app.

create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  topic text not null check (topic in (
    'recipe', 'ingredients', 'instructions', 'bug', 'confusing', 'general'
  )),
  message text not null check (char_length(btrim(message)) between 3 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists beta_feedback_recent_idx
  on public.beta_feedback (created_at desc);

alter table public.beta_feedback enable row level security;

create policy "beta_feedback_insert_own" on public.beta_feedback
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "beta_feedback_select_own" on public.beta_feedback
  for select to authenticated
  using (auth.uid() = user_id);
