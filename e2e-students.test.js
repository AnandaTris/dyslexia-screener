/**
 * End-to-end: per-student records against the REAL Supabase project.
 *
 * No doubles. This drives the actual lib/students.js query code against the
 * live database, so it is the only layer that can prove the schema and the
 * queries agree — a unit test with a fake builder passes whether or not the
 * columns exist.
 *
 * DELIBERATELY FAILS LOUDLY when supabase/students.sql has not been applied.
 * A skip guard here would make an unapplied migration look like a green suite,
 * which is exactly the state that wasted a session already.
 *
 * Uses the service-role key, so RLS is bypassed. That is a real limitation:
 * this proves the schema and the query shapes, NOT the row-level policies.
 * Policy behaviour is covered by the SQL itself and by the route tests.
 *
 * Excluded from the fast unit run:
 *   npx vitest run --exclude "**\/e2e-*.test.js"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadStudentSummaries, loadStudent } from "./lib/students.js";
import { loadActiveJourney } from "./lib/journey.js";

// The service-role key lives in rag-service/.env, which is gitignored. Parsed
// here rather than imported so the test needs no extra dependency.
function readEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

let supabase;
let therapistId;
const created = { students: [] };

beforeAll(async () => {
  const env = readEnv("rag-service/.env");
  supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Reuse a user that already owns rows rather than creating an auth user:
  // students.therapist_id references auth.users, and making one here would
  // leave a real account behind.
  const { data } = await supabase.from("screenings").select("user_id").limit(1);
  therapistId = data?.[0]?.user_id ?? null;
});

afterAll(async () => {
  // Deleting the student cascades to screenings, profile, journey and steps.
  for (const id of created.students) {
    await supabase.from("students").delete().eq("id", id);
  }
});

describe("E2E — per-student schema is live", () => {
  it("has a students table", async () => {
    const { error } = await supabase.from("students").select("id").limit(1);
    expect(
      error,
      "public.students is missing. Run supabase/students.sql in the Supabase " +
        "dashboard SQL Editor. This is not a code failure."
    ).toBeNull();
  });

  it.each([
    ["screenings", "student_id"],
    ["journeys", "student_id"],
    ["learner_profiles", "student_id"],
  ])("has %s.%s", async (table, column) => {
    const { error } = await supabase.from(table).select(column).limit(1);
    expect(error, `${table}.${column} is missing. Run supabase/students.sql.`).toBeNull();
  });

  it("has backfilled every existing screening onto a student", async () => {
    const { data } = await supabase.from("screenings").select("student_id");
    const orphans = (data ?? []).filter((row) => !row.student_id);
    expect(orphans, "screenings left without a student after the backfill").toHaveLength(0);
  });
});

describe("E2E — a student's records round-trip", () => {
  it("creates a student, screens them, builds a journey, and reads it all back", async () => {
    expect(therapistId, "no existing user to attach a test student to").toBeTruthy();

    // --- create the student -------------------------------------------------
    const { data: student, error: studentError } = await supabase
      .from("students")
      .insert({
        therapist_id: therapistId,
        display_name: "E2E Test Student",
        birth_year: 2016,
      })
      .select("id, display_name, birth_year")
      .single();

    expect(studentError, "could not create a student").toBeNull();
    created.students.push(student.id);

    // loadStudent is the real production read, scoped by therapist.
    expect(await loadStudent(supabase, therapistId, student.id)).toMatchObject({
      display_name: "E2E Test Student",
      birth_year: 2016,
    });

    // --- a screening and the profile derived from it ------------------------
    const { error: screeningError } = await supabase.from("screenings").insert({
      user_id: therapistId,
      student_id: student.id,
      is_writing_sample: true,
      verdict: "likely",
      likelihood_score: 61,
      result: { e2e: true },
    });
    expect(screeningError, "could not file a screening against the student").toBeNull();

    const { error: profileError } = await supabase.from("learner_profiles").upsert(
      {
        user_id: therapistId,
        student_id: student.id,
        profile: { primary_label: "surface", weights: { surface: 3 } },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" }
    );
    expect(
      profileError,
      "profile upsert failed — learner_profiles is probably still keyed on user_id"
    ).toBeNull();

    // --- a journey with steps ----------------------------------------------
    const { data: journey, error: journeyError } = await supabase
      .from("journeys")
      .insert({
        user_id: therapistId,
        student_id: student.id,
        profile_snapshot: { primary_label: "surface" },
        status: "active",
      })
      .select("id")
      .single();
    expect(journeyError, "could not create a journey for the student").toBeNull();

    const { error: stepsError } = await supabase.from("journey_steps").insert([
      { journey_id: journey.id, step_index: 0, title: "One", description: "d", status: "done" },
      { journey_id: journey.id, step_index: 1, title: "Two", description: "d", status: "done" },
      {
        journey_id: journey.id,
        step_index: 2,
        title: "Three",
        description: "d",
        status: "not_started",
      },
    ]);
    expect(stepsError, "could not save journey steps").toBeNull();

    // --- read it back through the real production code -----------------------
    const active = await loadActiveJourney(supabase, therapistId, student.id);
    expect(active.id).toBe(journey.id);
    expect(active.steps.map((s) => s.title)).toEqual(["One", "Two", "Three"]);

    const { students, schemaMissing } = await loadStudentSummaries(supabase, therapistId);
    expect(schemaMissing).toBe(false);

    const summary = students.find((s) => s.id === student.id);
    expect(summary.profile.primary_label).toBe("surface");
    expect(summary.hasJourney).toBe(true);
    expect(summary.stepsDone).toBe(2);
    expect(summary.stepsTotal).toBe(3);
    expect(summary.percent).toBe(67);
  }, 60000);

  it("cascades a student's records away when the student is deleted", async () => {
    const { data: student } = await supabase
      .from("students")
      .insert({ therapist_id: therapistId, display_name: "E2E Cascade Student" })
      .select("id")
      .single();

    const { data: journey } = await supabase
      .from("journeys")
      .insert({
        user_id: therapistId,
        student_id: student.id,
        profile_snapshot: {},
        status: "active",
      })
      .select("id")
      .single();

    await supabase.from("students").delete().eq("id", student.id);

    // This is why there is no delete-student button in the UI.
    const { data: orphaned } = await supabase.from("journeys").select("id").eq("id", journey.id);
    expect(orphaned ?? []).toHaveLength(0);
  }, 60000);
});
