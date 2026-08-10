// Completion maths for a journey's steps. Only "done" counts — "in_progress"
// is deliberately not partial credit, because a half-finished step is not
// progress the learner can rely on.
export function progressFor(steps) {
  const total = Array.isArray(steps) ? steps.length : 0;
  if (total === 0) return { done: 0, total: 0, percent: 0 };

  const done = steps.filter((s) => s?.status === "done").length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

// The active-journey read, shared by GET /api/journey, the student page, the
// therapist's student page and the dashboard card. Having one copy is what
// stops the percentage on the hub and the bar on /journey from ever disagreeing.
//
// Two queries rather than a join: under RLS, journey_steps is reachable only
// through its parent journey. The client arrives as an argument rather than an
// import because server components and route handlers build theirs differently.
//
// `applyFilters` is where the two callers differ, and it is the whole point of
// the split — see the two exported functions below.
async function loadJourney(supabase, applyFilters) {
  const { data: journey } = await applyFilters(
    supabase.from("journeys").select("id, created_at, profile_snapshot")
  )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!journey) return null;

  const { data: steps } = await supabase
    .from("journey_steps")
    .select("id, step_index, title, description, citations, status, completed_at")
    .eq("journey_id", journey.id)
    .order("step_index", { ascending: true });

  return { ...journey, steps: steps ?? [] };
}

/**
 * The therapist's read. Scoped to the therapist AND the student.
 *
 * Without a student there is no correct answer. Returning "the newest active
 * journey for this therapist" would hand back whichever student happened to be
 * most recent, which is exactly the confusion per-student records exist to
 * remove. Null is the honest result.
 */
export async function loadActiveJourney(supabase, userId, studentId) {
  if (!studentId) return null;
  return loadJourney(supabase, (query) =>
    query.eq("user_id", userId).eq("student_id", studentId)
  );
}

/**
 * The student's read. Scoped to the student only.
 *
 * There is deliberately no user filter: journeys.user_id holds the THERAPIST,
 * so filtering on the signed-in student's uid would return null every time. RLS
 * ("student reads own journeys" in supabase/student_accounts.sql) is what stops
 * this returning another child's journey — the same reasoning
 * app/api/journey/step/route.js:37-39 already relies on.
 */
export async function loadJourneyForStudent(supabase, studentId) {
  if (!studentId) return null;
  return loadJourney(supabase, (query) => query.eq("student_id", studentId));
}
