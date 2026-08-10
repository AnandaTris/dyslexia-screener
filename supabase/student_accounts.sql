-- Student login accounts and the RLS that scopes them.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--   Expect "Success" and a one-row summary from the verification query at the end.
--
-- RUN THIS AFTER students.sql. It adds columns to public.students.
--
-- WHAT IT DOES
--   1. Adds students.auth_user_id and students.login_email.
--   2. Adds four RLS policies so a student account can read its own student row,
--      its own journeys, and read/update the steps of those journeys.
--   3. Restricts UPDATE on journey_steps to the two columns the app actually
--      writes.
--
-- WHY on delete set null AND NOT cascade
--   The student row is the parent of that child's screenings and their
--   learner_profiles row. A cascade would mean deleting an auth account
--   silently destroys clinical history. Setting the link to null loses the
--   login and keeps the record.
--
-- WHY THE POLICIES ARE ADDED, NOT REWRITTEN
--   Postgres combines permissive policies with OR. Adding separate student
--   policies leaves the therapist policies in students.sql and rag_schema.sql
--   untouched, so this migration cannot regress them.
--
-- SAFETY
--   One transaction; Postgres DDL is transactional, so any failure rolls the
--   whole thing back. Safe to re-run: every statement is guarded.

begin;

-- ---------- 1. Columns ----------
alter table public.students
  add column if not exists auth_user_id uuid unique
    references auth.users (id) on delete set null;

alter table public.students
  add column if not exists login_email text;

create index if not exists students_auth_user_idx
  on public.students (auth_user_id);

-- ---------- 2. RLS for student accounts ----------
-- Their own student row, so the app can resolve who is signed in.
drop policy if exists "student reads own record" on public.students;
create policy "student reads own record" on public.students
  for select using (auth_user_id = auth.uid());

-- Their own journeys.
drop policy if exists "student reads own journeys" on public.journeys;
create policy "student reads own journeys" on public.journeys
  for select using (exists (
    select 1 from public.students s
    where s.id = journeys.student_id
      and s.auth_user_id = auth.uid()));

-- The steps of those journeys, read...
drop policy if exists "student reads own journey steps" on public.journey_steps;
create policy "student reads own journey steps" on public.journey_steps
  for select using (exists (
    select 1 from public.journeys j
    join public.students s on s.id = j.student_id
    where j.id = journey_steps.journey_id
      and s.auth_user_id = auth.uid()));

-- ...and update, which is how a student ticks a step done.
drop policy if exists "student updates own journey steps" on public.journey_steps;
create policy "student updates own journey steps" on public.journey_steps
  for update using (exists (
    select 1 from public.journeys j
    join public.students s on s.id = j.student_id
    where j.id = journey_steps.journey_id
      and s.auth_user_id = auth.uid()))
  with check (exists (
    select 1 from public.journeys j
    join public.students s on s.id = j.student_id
    where j.id = journey_steps.journey_id
      and s.auth_user_id = auth.uid()));

-- ---------- 3. Close the column hole ----------
-- RLS is row-level, not column-level: the policy above would also let a student
-- rewrite title, description and citations on their own steps. Only one code
-- path updates this table (app/api/journey/step/route.js), and it writes only
-- these two columns. The journey build INSERTs steps, which this does not touch.
--
-- NOTE: authenticated is the same Postgres role for therapists and students, so
-- this constrains both. That is intended, and the therapist path is covered by
-- a test.
revoke update on public.journey_steps from authenticated;
grant  update (status, completed_at) on public.journey_steps to authenticated;

commit;

-- ---------- Verification ----------
-- Expect both columns present, and 4 student policies.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name in ('auth_user_id','login_email'))          as new_columns,
  (select count(*) from pg_policies
     where schemaname = 'public' and policyname like 'student %')  as student_policies,
  (select count(*) from public.students where auth_user_id is not null)
                                                                   as students_with_login;
