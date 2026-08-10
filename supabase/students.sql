-- Per-student records under a therapist.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--   Expect: "Success" and a one-row summary from the verification query at the end.
--
-- WHAT IT DOES
--   1. Creates public.students.
--   2. Adds a nullable student_id to screenings, journeys and learner_profiles.
--   3. Backfills existing rows onto one "Unassigned" student per therapist.
--   4. Re-keys learner_profiles from PK(user_id) to PK(student_id).
--   5. Updates RLS.
--
-- WHY STEP 4 MATTERS
--   A primary key on user_id is exactly what limited a therapist to one profile:
--   the screening route upserted on that key, so screening a second student
--   overwrote the first student's profile and destroyed the basis for their
--   journey. Re-keying to student_id is the change that unlocks multiple
--   students.
--
-- SAFETY
--   The whole migration runs inside one transaction. Postgres DDL is
--   transactional, so if any statement fails, everything rolls back and the
--   database is left exactly as it was. Without this, a failure between
--   "drop constraint" and "add primary key" would leave learner_profiles with no
--   primary key at all — worse than not running it.
--
--   Safe to re-run: every statement is guarded.
--
--   Nothing is deleted. Existing screenings are attached to an "Unassigned"
--   student per therapist, not discarded.
--
-- ORDER MATTERS. The backfill must happen before the re-key, because the re-key
--   fails on a null student_id. Do not reorder the sections.

begin;

-- ---------- 1. The table ----------
create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  birth_year   integer check (birth_year between 1900 and 2100),
  created_at   timestamptz not null default now()
);

create index if not exists students_therapist_idx
  on public.students (therapist_id, created_at desc);

-- ---------- 2. Re-parent the existing tables ----------
-- Nullable on purpose: there are already screenings in this project, and a
-- not-null column would reject the migration outright. The application requires
-- a student for anything new.
alter table public.screenings
  add column if not exists student_id uuid references public.students (id) on delete cascade;
alter table public.journeys
  add column if not exists student_id uuid references public.students (id) on delete cascade;
alter table public.learner_profiles
  add column if not exists student_id uuid references public.students (id) on delete cascade;

create index if not exists screenings_student_idx on public.screenings (student_id, created_at desc);
create index if not exists journeys_student_idx   on public.journeys (student_id, created_at desc);

-- ---------- 3. Backfill ----------
-- One "Unassigned" student per therapist that already owns rows. The student is
-- created against the same user_id the existing row already carries, so nothing
-- is ever attached to the wrong person.
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

-- ---------- 4. Re-key learner_profiles ----------
-- Check the backfill first. Without this the next statement fails with
-- 'column "student_id" contains null values', which says nothing about why.
do $$
declare
  stragglers int;
begin
  select count(*) into stragglers from public.learner_profiles where student_id is null;
  if stragglers > 0 then
    raise exception
      'Backfill incomplete: % learner_profiles row(s) still have no student_id. '
      'This usually means a profile exists for a user with no matching student. '
      'Nothing has been changed — the transaction is rolling back.', stragglers;
  end if;
end $$;

alter table public.learner_profiles drop constraint if exists learner_profiles_pkey;
alter table public.learner_profiles alter column student_id set not null;
alter table public.learner_profiles add primary key (student_id);

-- ---------- 5. RLS ----------
alter table public.students enable row level security;

drop policy if exists "own students" on public.students;
create policy "own students" on public.students
  for all using (auth.uid() = therapist_id)
  with check (auth.uid() = therapist_id);

-- The student-ownership clause is load-bearing. Without it a therapist could
-- attach a screening to ANOTHER therapist's student id: user_id would still be
-- their own, so the old policy alone would happily allow it.
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

commit;

-- ---------- Verification ----------
-- This is the result the SQL Editor will show. Expect students >= 1 and BOTH
-- "without_student" columns to be 0. Anything else means the backfill did not
-- cover every row, and you should not start using the app until it does.
select
  (select count(*) from public.students)                                  as students,
  (select count(*) from public.screenings)                                as screenings,
  (select count(*) from public.screenings where student_id is null)       as screenings_without_student,
  (select count(*) from public.learner_profiles)                          as profiles,
  (select count(*) from public.learner_profiles where student_id is null) as profiles_without_student;
