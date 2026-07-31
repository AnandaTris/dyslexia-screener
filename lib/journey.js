// Completion maths for a journey's steps. Only "done" counts — "in_progress"
// is deliberately not partial credit, because a half-finished step is not
// progress the learner can rely on.
export function progressFor(steps) {
  const total = Array.isArray(steps) ? steps.length : 0;
  if (total === 0) return { done: 0, total: 0, percent: 0 };

  const done = steps.filter((s) => s?.status === "done").length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

// The active-journey read, shared by GET /api/journey, the journey page and the
// dashboard card. Having one copy is what stops the percentage on the hub and
// the bar on /journey from ever disagreeing.
//
// Two queries rather than a join: under RLS, journey_steps is reachable only
// through its parent journey. The client arrives as an argument rather than an
// import because server components and route handlers build theirs differently.
export async function loadActiveJourney(supabase, userId) {
  const { data: journey } = await supabase
    .from("journeys")
    .select("id, created_at, profile_snapshot")
    .eq("user_id", userId)
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
