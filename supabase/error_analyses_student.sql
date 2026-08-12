-- Problem Statement 4 — attach error analyses to a learner.
-- Run this in the Supabase dashboard: SQL Editor → New query → Run.
-- Requires students.sql to have been run first.
--
-- WHY: PS4 asks for a "dashboard for visualising learner error trends", and a
-- trend needs a learner to belong to. `error_analyses` was created with
-- `user_id` (the therapist) and a nullable `screening_id`, but nothing ever
-- populates the latter — /api/analyze-text calls persistErrorAnalysis without a
-- screeningId — so every existing row has no path to a student at all.
--
-- This mirrors what students.sql did for screenings, journeys and
-- learner_profiles: add the column, index it for the query the dashboard makes,
-- and let the existing user_id RLS keep doing the access control.

alter table public.error_analyses
  add column if not exists student_id uuid references public.students (id) on delete cascade;

-- Deliberately nullable, and deliberately NOT backfilled.
--
-- students.sql could backfill because every screening already belonged to a
-- therapist who had exactly one implicit student to adopt it. There is no
-- equivalent here: an existing analysis carries a therapist and a block of
-- text, and nothing that identifies which learner wrote it. Guessing would put
-- one learner's errors on another learner's trend line, which is precisely the
-- failure the per-student rework of learner_profiles existed to fix.
--
-- Rows from before this migration therefore stay unattributed and simply do not
-- appear in any learner's trend. New analyses require a student at the route.

-- The dashboard reads "every analysis for this student, oldest first", so the
-- index is on (student_id, created_at) rather than the existing
-- (user_id, created_at desc).
create index if not exists error_analyses_student_idx
  on public.error_analyses (student_id, created_at);

-- No new policies. The existing "own rows" policies key on user_id, which is
-- still set on every insert, and students are already scoped to their therapist
-- by students.sql — so a row reachable through a student is reachable through
-- its user_id too. Adding a student-scoped policy would widen nothing and give
-- two places to keep in sync.
