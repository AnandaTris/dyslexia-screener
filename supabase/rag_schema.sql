-- Run in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Adds the RAG store (documents/chunks) plus the learner-journey tables.
-- Extends supabase/schema.sql (screenings). Safe to re-run.

create extension if not exists vector;

-- ---------- RAG store (locked to service role via RLS deny-all) ----------
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  source          text,
  doc_type        text not null check (doc_type in ('exercise','guide','article')),
  target_profiles text[] not null default '{}',
  added_at        timestamptz not null default now()
);

create table if not exists public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  content     text not null,
  embedding   vector(768) not null,
  chunk_index integer not null,
  metadata    jsonb not null default '{}'
);

create index if not exists document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- Lock down the RAG store: RLS on with NO anon/authenticated policies. The
-- Python service uses the service role (bypasses RLS) so it still reads/writes;
-- the public anon key gets no access (no policies = deny all).
alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;

-- ---------- User-scoped tables (RLS on) ----------
create table if not exists public.learner_profiles (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  profile                jsonb not null,          -- { weights: {...}, primary_label: "..." }
  derived_from_screening uuid references public.screenings (id) on delete set null,
  updated_at             timestamptz not null default now()
);

create table if not exists public.journeys (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  profile_snapshot jsonb not null,
  status           text not null default 'active' check (status in ('active','archived')),
  created_at       timestamptz not null default now()
);

create table if not exists public.journey_steps (
  id           uuid primary key default gen_random_uuid(),
  journey_id   uuid not null references public.journeys (id) on delete cascade,
  step_index   integer not null,
  title        text not null,
  description  text not null,
  citations    jsonb not null default '[]',
  status       text not null default 'not_started'
                 check (status in ('not_started','in_progress','done')),
  completed_at timestamptz
);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  journey_id uuid references public.journeys (id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  citations  jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists journeys_user_idx on public.journeys (user_id, created_at desc);
create index if not exists journey_steps_journey_idx on public.journey_steps (journey_id, step_index);
create index if not exists chat_messages_user_idx on public.chat_messages (user_id, created_at desc);
create index if not exists document_chunks_document_id_idx on public.document_chunks (document_id);
create index if not exists chat_messages_journey_id_idx on public.chat_messages (journey_id);

-- ---------- RLS: users see only their own rows ----------
alter table public.learner_profiles enable row level security;
alter table public.journeys        enable row level security;
alter table public.journey_steps   enable row level security;
alter table public.chat_messages   enable row level security;

drop policy if exists "own learner_profile" on public.learner_profiles;
create policy "own learner_profile" on public.learner_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own journeys" on public.journeys;
create policy "own journeys" on public.journeys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own chat_messages" on public.chat_messages;
create policy "own chat_messages" on public.chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own journey_steps" on public.journey_steps;
create policy "own journey_steps" on public.journey_steps
  for all using (
    exists (select 1 from public.journeys j
            where j.id = journey_steps.journey_id and j.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.journeys j
            where j.id = journey_steps.journey_id and j.user_id = auth.uid())
  );

-- ---------- Vector similarity search (cosine) ----------
create or replace function public.match_document_chunks(
  query_embedding vector(768),
  match_count int default 6,
  filter_profiles text[] default null
) returns table (
  id uuid, document_id uuid, content text, chunk_index int,
  metadata jsonb, title text, similarity float
) language sql stable
  set search_path = public, pg_temp
as $$
  select dc.id, dc.document_id, dc.content, dc.chunk_index, dc.metadata,
         d.title, 1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where filter_profiles is null
     or cardinality(d.target_profiles) = 0
     or d.target_profiles && filter_profiles
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
