-- Run this in the Supabase dashboard: SQL Editor → New query → Run.
-- Creates the table that stores each user's screening results, with
-- row-level security so a user can only ever read/write their own rows.

create table if not exists public.screenings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  is_writing_sample boolean,
  verdict           text,
  likelihood_score  integer,
  transcription     text,
  summary           text,
  result            jsonb not null,           -- full analysis JSON from Gemini
  created_at        timestamptz not null default now()
);

create index if not exists screenings_user_id_created_at_idx
  on public.screenings (user_id, created_at desc);

-- Row-level security
alter table public.screenings enable row level security;

create policy "Users can read their own screenings"
  on public.screenings for select
  using (auth.uid() = user_id);

create policy "Users can insert their own screenings"
  on public.screenings for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own screenings"
  on public.screenings for delete
  using (auth.uid() = user_id);
