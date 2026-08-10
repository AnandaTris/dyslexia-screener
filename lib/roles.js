// Where a signed-in account's role comes from.
//
// The role is a Supabase app_metadata claim, set by the admin API when a
// therapist issues a student login. app_metadata is writable only with the
// service-role key, so a signed-in user cannot promote themselves by editing
// their own profile — unlike user_metadata, which they can.
//
// This claim decides ROUTING only. What data an account can touch is decided by
// RLS in supabase/student_accounts.sql. If the two ever disagree, a student
// with a broken claim reaches a therapist page that renders none of their data.
export const THERAPIST = "therapist";
export const STUDENT = "student";

// Absence means therapist: every account created before this feature has no
// claim, and they must keep working exactly as they did.
export function roleOf(user) {
  const metadata = user?.app_metadata;
  const role = metadata && typeof metadata === "object" ? metadata.role : null;
  return role === STUDENT ? STUDENT : THERAPIST;
}

export function isStudent(user) {
  return roleOf(user) === STUDENT;
}
