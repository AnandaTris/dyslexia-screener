"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";

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
