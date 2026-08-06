// One definition of "this therapist's students". The list page, the student
// page and every route that accepts a student_id all read through here, so
// ownership is decided in exactly one place.
//
// RLS already scopes these rows to the caller. The explicit therapist_id filter
// is deliberate belt-and-braces: it keeps the query correct if a policy is ever
// loosened, and it makes loadStudent return null for someone else's id — which
// the routes turn into a clean 404 rather than a confusing empty result.
export async function loadStudents(supabase, therapistId) {
  const { data } = await supabase
    .from("students")
    .select("id, display_name, birth_year, created_at")
    .eq("therapist_id", therapistId)
    .order("display_name", { ascending: true });

  return data ?? [];
}

export async function loadStudent(supabase, therapistId, studentId) {
  if (!studentId) return null;

  const { data } = await supabase
    .from("students")
    .select("id, display_name, birth_year, created_at")
    .eq("therapist_id", therapistId)
    .eq("id", studentId)
    .maybeSingle();

  return data ?? null;
}

/** Age in whole years, or null when no year of birth was recorded. */
export function ageFromBirthYear(birthYear, now = new Date()) {
  if (!birthYear) return null;
  const age = now.getFullYear() - Number(birthYear);
  return Number.isFinite(age) && age >= 0 ? age : null;
}
