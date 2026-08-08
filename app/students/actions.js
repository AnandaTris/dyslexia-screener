"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";
import { createAdminClient } from "../../lib/supabase/admin";
import { loadStudent } from "../../lib/students";
import { roleOf, STUDENT, THERAPIST } from "../../lib/roles";
import { INITIAL_PASSWORD, normaliseEmail, isValidEmail } from "../../lib/studentAuth";

// Mirrors the check constraint in supabase/students.sql. Duplicated on purpose:
// the database is the real guarantee, and this exists so the therapist gets a
// sentence rather than a Postgres constraint-violation string.
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export async function createStudent(formData) {
  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!displayName) return { error: "Enter the student's name." };

  const rawYear = String(formData.get("birth_year") ?? "").trim();
  let birthYear = null;
  if (rawYear) {
    birthYear = Number(rawYear);
    if (!Number.isInteger(birthYear) || birthYear < MIN_YEAR || birthYear > MAX_YEAR) {
      return { error: "Enter a four-digit year of birth, or leave it blank." };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { error } = await supabase
    .from("students")
    .insert({ therapist_id: user.id, display_name: displayName, birth_year: birthYear });

  // The insert can also fail on RLS, which would mean the session is not who it
  // claims to be. Either way the therapist gets one honest sentence rather than
  // a database message.
  if (error) return { error: "Could not add that student." };

  revalidatePath("/students");
  redirect("/students");
}

// Both login actions need the same four checks before they touch anything.
// Returning the student rather than just a boolean saves the caller a second
// read, and the display name is what every message below is written around.
async function resolveTherapistAndStudent(supabase, studentId, verb) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  // A student account reaching here would mean middleware let it through, but
  // the server action is its own entry point — a form POST does not care what
  // middleware thinks about page navigation.
  if (roleOf(user) !== THERAPIST) return { error: `Only a therapist can ${verb}.` };

  const student = await loadStudent(supabase, user.id, studentId);
  if (!student) return { error: "That student was not found." };

  // The student row loaded, but students.auth_user_id does not exist yet, so
  // there is nowhere to record a login. Stopping here is the point: the admin
  // API would happily create the auth account, the link write would then fail
  // on the missing column, and the cleanup path would be undoing damage this
  // check prevents outright.
  if (student.loginsUnavailable) {
    return {
      error:
        "Student logins are not available yet — apply supabase/student_accounts.sql " +
        "in the Supabase dashboard first.",
    };
  }

  return { student };
}

// The admin client throws when SUPABASE_SERVICE_ROLE_KEY is absent. That is a
// deployment problem, not a therapist's problem, so it becomes one sentence
// rather than a stack trace.
function adminOrError() {
  try {
    return { admin: createAdminClient() };
  } catch {
    return { error: "Student logins are not set up on this server." };
  }
}

/**
 * Creates the student's auth account and links it to their record.
 *
 * No email is sent: email_confirm short-circuits the confirmation mail, and
 * there is no reset link anywhere in this feature. That is deliberate — this
 * project has already exhausted Supabase's built-in SMTP quota once, and a
 * silently undelivered mail is worse than no mail.
 */
export async function createStudentLogin(formData) {
  const studentId = String(formData.get("student_id") ?? "");
  const email = normaliseEmail(formData.get("email"));

  // Checked before anything else so a typo costs nothing.
  if (!isValidEmail(email)) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const resolved = await resolveTherapistAndStudent(supabase, studentId, "issue a login");
  if (resolved.error) return { error: resolved.error };

  const { student } = resolved;
  if (student.auth_user_id) {
    return { error: `${student.display_name} already has a login.` };
  }

  const { admin, error: adminError } = adminOrError();
  if (adminError) return { error: adminError };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: INITIAL_PASSWORD,
    email_confirm: true,
    // app_metadata, NOT user_metadata: only the service role can write it, so a
    // signed-in student cannot promote themselves to a therapist.
    app_metadata: { role: STUDENT, student_id: student.id },
  });

  if (createError) {
    return {
      error: /already been registered|already exists|email_exists/i.test(createError.message ?? "")
        ? "That email already has an account."
        : "Could not create that login.",
    };
  }

  // Through the therapist's own client, not the admin one: RLS re-proves
  // ownership of this student row at the moment of the write.
  const { error: linkError } = await supabase
    .from("students")
    .update({ auth_user_id: created.user.id, login_email: email })
    .eq("id", student.id);

  if (linkError) {
    // The auth user exists but nothing points at it. Left alone, every retry
    // fails with "already registered" forever, so undo it.
    const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);

    return {
      error: cleanupError
        ? `Could not finish creating that login, and the half-made account for ${email} could not be removed. Delete it in the Supabase dashboard before trying again.`
        : "Could not create that login — try again.",
    };
  }

  revalidatePath(`/students/${student.id}`);

  return {
    ok: `Login created. ${student.display_name} signs in as ${email} with the password ${INITIAL_PASSWORD}.`,
  };
}

/**
 * Puts a forgotten password back to the initial one.
 *
 * This is the whole of "forgot password" in this app. There is no reset email
 * by design — see createStudentLogin above.
 */
export async function resetStudentPassword(formData) {
  const studentId = String(formData.get("student_id") ?? "");

  const supabase = await createClient();
  const resolved = await resolveTherapistAndStudent(supabase, studentId, "reset a password");
  if (resolved.error) return { error: resolved.error };

  const { student } = resolved;
  if (!student.auth_user_id) {
    return { error: `${student.display_name} does not have a login yet.` };
  }

  const { admin, error: adminError } = adminOrError();
  if (adminError) return { error: adminError };

  const { error } = await admin.auth.admin.updateUserById(student.auth_user_id, {
    password: INITIAL_PASSWORD,
  });

  if (error) return { error: "Could not reset that password." };

  return {
    ok: `Password reset. ${student.display_name} signs in with ${INITIAL_PASSWORD} again.`,
  };
}
