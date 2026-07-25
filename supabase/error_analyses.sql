-- Problem Statement 4 — DAS Error Pattern Analyzer.
-- Run this in the Supabase dashboard: SQL Editor → New query → Run.
-- Safe to run after schema.sql; it does not touch the screenings table.
--
-- Stores one row per analysed writing sample, with the full NLP report in
-- `result` and the fields a dashboard needs to aggregate on lifted out as
-- columns. Row-level security matches screenings: a user only ever sees rows
-- they created.

create table if not exists public.error_analyses (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  screening_id       uuid references public.screenings (id) on delete set null,
  source             text not null check (source in ('image', 'text')),
  sample_text        text not null,
  writer_age         integer,
  word_count         integer,
  error_count        integer,
  dominant_profile   text,        -- phonological | surface | morphological | visual
  profile_label      text,
  profile_confidence numeric,
  category_counts    jsonb not null default '{}'::jsonb,
  result             jsonb not null,          -- the full analysis report
  created_at         timestamptz not null default now()
);

create index if not exists error_analyses_user_id_created_at_idx
  on public.error_analyses (user_id, created_at desc);

create index if not exists error_analyses_profile_idx
  on public.error_analyses (user_id, dominant_profile);

alter table public.error_analyses enable row level security;

drop policy if exists "Users can read their own error analyses" on public.error_analyses;
create policy "Users can read their own error analyses"
  on public.error_analyses for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own error analyses" on public.error_analyses;
create policy "Users can insert their own error analyses"
  on public.error_analyses for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own error analyses" on public.error_analyses;
create policy "Users can delete their own error analyses"
  on public.error_analyses for delete
  using (auth.uid() = user_id);
