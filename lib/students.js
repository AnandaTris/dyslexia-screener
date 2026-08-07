// One definition of "this therapist's students". Every route that accepts a
// student_id reads through here, so ownership is decided in exactly one place.
//
// RLS already scopes these rows to the caller. The explicit therapist_id filter
// is deliberate belt-and-braces: it keeps the query correct if a policy is ever
// loosened, and it makes this return null for someone else's id — which the
// routes turn into a clean 404 rather than a confusing empty result.
export async function loadStudent(supabase, therapistId, studentId) {
  if (!studentId) return null;

  const { data } = await supabase
    .from("students")
    .select("id, display_name, birth_year, created_at, auth_user_id, login_email")
    .eq("therapist_id", therapistId)
    .eq("id", studentId)
    .maybeSingle();

  return data ?? null;
}

// PostgREST codes for "that table/column isn't there". Worth telling apart from
// an ordinary empty result: the first means supabase/students.sql has not been
// run, and showing "no students yet" for that sends someone hunting for a bug in
// the UI instead of running a migration.
const SCHEMA_MISSING_CODES = new Set(["PGRST205", "PGRST204", "42P01", "42703"]);

export function isSchemaMissing(error) {
  return Boolean(error) && SCHEMA_MISSING_CODES.has(error.code);
}

/**
 * The caseload list with everything the cards actually show: profile emphasis,
 * active-journey progress, and whether a screening exists yet.
 *
 * Four queries regardless of how many students there are, rather than a couple
 * per student. A caseload is small, but N+1 here would mean a round trip per
 * card on every page load.
 */
export async function loadStudentSummaries(supabase, therapistId) {
  const { data: students, error } = await supabase
    .from("students")
    .select("id, display_name, birth_year, created_at")
    .eq("therapist_id", therapistId)
    .order("display_name", { ascending: true });

  if (error) return { students: [], schemaMissing: isSchemaMissing(error) };
  if (!students?.length) return { students: [], schemaMissing: false };

  const ids = students.map((s) => s.id);

  const [{ data: profiles }, { data: journeys }] = await Promise.all([
    supabase.from("learner_profiles").select("student_id, profile").in("student_id", ids),
    supabase
      .from("journeys")
      .select("id, student_id")
      .eq("status", "active")
      .in("student_id", ids),
  ]);

  const journeyIds = (journeys ?? []).map((j) => j.id);
  const { data: steps } = journeyIds.length
    ? await supabase.from("journey_steps").select("journey_id, status").in("journey_id", journeyIds)
    : { data: [] };

  const profileFor = new Map((profiles ?? []).map((p) => [p.student_id, p.profile]));
  const journeyFor = new Map((journeys ?? []).map((j) => [j.student_id, j.id]));

  const stepsByJourney = new Map();
  for (const step of steps ?? []) {
    if (!stepsByJourney.has(step.journey_id)) stepsByJourney.set(step.journey_id, []);
    stepsByJourney.get(step.journey_id).push(step);
  }

  return {
    schemaMissing: false,
    students: students.map((student) => {
      const journeyId = journeyFor.get(student.id) ?? null;
      const journeySteps = journeyId ? stepsByJourney.get(journeyId) ?? [] : [];
      const done = journeySteps.filter((s) => s.status === "done").length;

      return {
        ...student,
        profile: profileFor.get(student.id) ?? null,
        hasJourney: Boolean(journeyId),
        stepsDone: done,
        stepsTotal: journeySteps.length,
        percent: journeySteps.length ? Math.round((done / journeySteps.length) * 100) : 0,
      };
    }),
  };
}

/** Age in whole years, or null when no year of birth was recorded. */
export function ageFromBirthYear(birthYear, now = new Date()) {
  if (!birthYear) return null;
  const age = now.getFullYear() - Number(birthYear);
  return Number.isFinite(age) && age >= 0 ? age : null;
}
