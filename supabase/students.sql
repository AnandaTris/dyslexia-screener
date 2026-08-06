-- Per-student records under a therapist.
-- Run in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run: every statement is guarded.
--
-- ORDER MATTERS. The learner_profiles primary-key change at the bottom fails on
-- a null student_id, so the backfill must happen before it, which means the
-- students rows must exist before that. Do not reorder the sections.

-- ---------- The table ----------
create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  birth_year   integer check (birth_year between 1900 and 2100),
  created_at   timestamptz not null default now()
);

create index if not exists students_therapist_idx
  on public.students (therapist_id, created_at desc);

-- ---------- Re-parent the existing tables ----------
-- Nullable on purpose: there are already screenings in this project, and a not
-- null column would reject the migration outright. The UI requires a student
-- for anything new.
alter table public.screenings
  add column if not exists student_id uuid references public.students (id) on delete cascade;
alter table public.journeys
  add column if not exists student_id uuid references public.students (id) on delete cascade;
alter table public.learner_profiles
  add column if not exists student_id uuid references public.students (id) on delete cascade;

create index if not exists screenings_student_idx on public.screenings (student_id, created_at desc);
create index if not exists journeys_student_idx   on public.journeys (student_id, created_at desc);

-- ---------- Backfill ----------
-- One "Unassigned" student per therapist that already owns rows. Nothing is
-- deleted and nothing is reassigned to the wrong person: the student is created
-- against the same user_id the existing row already carries.
insert into public.students (therapist_id, display_name)
select distinct s.user_id, 'Unassigned'
from public.screenings s
where s.student_id is null
  and not exists (
    select 1 from public.students st
    where st.therapist_id = s.user_id and st.display_name = 'Unassigned'
  );

insert into public.students (therapist_id, display_name)
select distinct lp.user_id, 'Unassigned'
from public.learner_profiles lp
where lp.student_id is null
  and not exists (
    select 1 from public.students st
    where st.therapist_id = lp.user_id and st.display_name = 'Unassigned'
  );

update public.screenings s
set student_id = st.id
from public.students st
where s.student_id is null
  and st.therapist_id = s.user_id
  and st.display_name = 'Unassigned';

update public.learner_profiles lp
set student_id = st.id
from public.students st
where lp.student_id is null
  and st.therapist_id = lp.user_id
  and st.display_name = 'Unassigned';

-- ---------- Re-key learner_profiles ----------
-- This is the change that actually unlocks multiple students. A primary key on
-- user_id is precisely what limited a therapist to one profile: every new
-- screening upserted over the previous student's.
alter table public.learner_profiles drop constraint if exists learner_profiles_pkey;
alter table public.learner_profiles alter column student_id set not null;
alter table public.learner_profiles add primary key (student_id);

-- ---------- RLS ----------
alter table public.students enable row level security;

drop policy if exists "own students" on public.students;
create policy "own students" on public.students
  for all using (auth.uid() = therapist_id)
  with check (auth.uid() = therapist_id);

-- The student-ownership clause is load-bearing. Without it a therapist could
-- attach a screening to ANOTHER therapist's student id -- user_id would still
-- be their own, so the old policy alone would happily allow it.
drop policy if exists "Users can insert their own screenings" on public.screenings;
create policy "Users can insert their own screenings"
  on public.screenings for insert
  with check (
    auth.uid() = user_id
    and (student_id is null or exists (
      select 1 from public.students s
      where s.id = student_id and s.therapist_id = auth.uid()))
  );

drop policy if exists "own journeys" on public.journeys;
create policy "own journeys" on public.journeys
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (student_id is null or exists (
      select 1 from public.students s
      where s.id = student_id and s.therapist_id = auth.uid()))
  );

drop policy if exists "own learner_profile" on public.learner_profiles;
create policy "own learner_profile" on public.learner_profiles
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.students s
      where s.id = student_id and s.therapist_id = auth.uid())
  );
