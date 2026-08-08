/**
 * End-to-end: what a STUDENT account can and cannot reach, against the real
 * Supabase project.
 *
 * The point of this file is the anon key. e2e-students.test.js uses the
 * service-role key and says so at its top: that bypasses RLS entirely, so it
 * proves schema shapes and query shapes but NOT a single policy. Here the
 * student signs in for real and every read below is answered by the policies in
 * supabase/student_accounts.sql.
 *
 * DELIBERATELY FAILS LOUDLY when that file has not been applied.
 *
 * Creates a real auth user and a real student, and removes both in afterAll.
 *
 * Excluded from the fast unit run: npm test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { INITIAL_PASSWORD } from "./lib/studentAuth.js";

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

let admin;           // service role — sets the fixtures up, bypasses RLS
let studentClient;   // anon key, signed in as the student — the thing under test
let therapistClient; // anon key, signed in as a therapist — proves the grant
const created = { students: [], users: [] };
let studentRow;
let therapistId;
let stepId;

// Unique addresses per run: both accounts are deleted in afterAll, but a
// crashed run must not block the next one.
const STAMP = Date.now();
const EMAIL = `e2e-student-${STAMP}@example.com`;
const THERAPIST_EMAIL = `e2e-therapist-${STAMP}@example.com`;

beforeAll(async () => {
  const serviceEnv = readEnv("rag-service/.env");
  const webEnv = readEnv(".env");

  admin = createClient(serviceEnv.SUPABASE_URL, serviceEnv.SUPABASE_SERVICE_ROLE_KEY);

  // A real therapist account, created rather than borrowed. The last test in
  // this file has to tick a step as `authenticated` — which is what the column
  // grant constrains — and there is no way to sign in as an existing therapist
  // without their password. Deliberately carries NO role claim, which is what
  // makes roleOf() treat it as a therapist.
  const { data: therapistUser, error: therapistError } = await admin.auth.admin.createUser({
    email: THERAPIST_EMAIL,
    password: "e2e-therapist-password",
    email_confirm: true,
  });
  expect(therapistError, "could not create the fixture therapist").toBeNull();
  therapistId = therapistUser.user.id;
  created.users.push(therapistId);

  const { data: student, error: studentError } = await admin
    .from("students")
    .insert({ therapist_id: therapistId, display_name: "E2E Student" })
    .select("id")
    .single();
  expect(
    studentError,
    "could not create the fixture student — is supabase/students.sql applied?"
  ).toBeNull();
  studentRow = student;
  created.students.push(student.id);

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: INITIAL_PASSWORD,
    email_confirm: true,
    app_metadata: { role: "student", student_id: student.id },
  });
  expect(authError, "could not create the student auth user").toBeNull();
  created.users.push(authUser.user.id);

  const { error: linkError } = await admin
    .from("students")
    .update({ auth_user_id: authUser.user.id, login_email: EMAIL })
    .eq("id", student.id);
  expect(
    linkError,
    "could not link the auth user — is supabase/student_accounts.sql applied?"
  ).toBeNull();

  // A journey with one step for the student to read and tick.
  const { data: journey } = await admin
    .from("journeys")
    .insert({
      user_id: therapistId,
      student_id: student.id,
      profile_snapshot: { primary_label: "surface" },
      status: "active",
    })
    .select("id")
    .single();

  const { data: step } = await admin
    .from("journey_steps")
    .insert({
      journey_id: journey.id,
      step_index: 0,
      title: "E2E step",
      description: "A step for the e2e run.",
    })
    .select("id")
    .single();
  stepId = step.id;

  // The clients under test: anon key, real sign-ins. Both run as the Postgres
  // role `authenticated`, which is the role every policy and grant here targets.
  const anon = () =>
    createClient(webEnv.NEXT_PUBLIC_SUPABASE_URL, webEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  studentClient = anon();
  const { error: signInError } = await studentClient.auth.signInWithPassword({
    email: EMAIL,
    password: INITIAL_PASSWORD,
  });
  expect(signInError, "the student could not sign in").toBeNull();

  therapistClient = anon();
  const { error: therapistSignIn } = await therapistClient.auth.signInWithPassword({
    email: THERAPIST_EMAIL,
    password: "e2e-therapist-password",
  });
  expect(therapistSignIn, "the fixture therapist could not sign in").toBeNull();
});

afterAll(async () => {
  // Deleting the student cascades to the journey and its steps.
  for (const id of created.students) await admin.from("students").delete().eq("id", id);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

describe("what a student CAN do", () => {
  it("carries the student role in its own session", async () => {
    const { data } = await studentClient.auth.getUser();
    expect(data.user.app_metadata.role).toBe("student");
  });

  it("reads its own student record", async () => {
    const { data, error } = await studentClient
      .from("students")
      .select("id, display_name")
      .eq("auth_user_id", (await studentClient.auth.getUser()).data.user.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(studentRow.id);
  });

  it("reads its own journey and steps", async () => {
    const { data: journeys, error: journeyError } = await studentClient
      .from("journeys")
      .select("id")
      .eq("student_id", studentRow.id);
    expect(journeyError).toBeNull();
    expect(journeys).toHaveLength(1);

    const { data: steps, error: stepError } = await studentClient
      .from("journey_steps")
      .select("id, title, status");
    expect(stepError).toBeNull();
    expect(steps.map((s) => s.id)).toContain(stepId);
  });

  it("ticks a step done", async () => {
    const { error } = await studentClient
      .from("journey_steps")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", stepId);
    expect(error).toBeNull();

    // Verified through the admin client so the assertion cannot be fooled by a
    // policy that hides the row instead of rejecting the write.
    const { data } = await admin.from("journey_steps").select("status").eq("id", stepId).single();
    expect(data.status).toBe("done");
  });
});

describe("what a student CANNOT do", () => {
  // Each of these asserts the read SUCCEEDED before judging the row count.
  // HANDOFF.md:109-124 records a test in this repo that passed vacuously
  // because an errored query and an empty table look identical after `?? []`.
  const expectNoRows = (data, error, what) => {
    expect(error, `${what}: the query itself failed, so the count proves nothing`).toBeNull();
    expect(Array.isArray(data), `${what}: expected an array`).toBe(true);
    expect(data, what).toHaveLength(0);
  };

  it("sees no screenings at all", async () => {
    const { data, error } = await studentClient.from("screenings").select("id");
    expectNoRows(data, error, "screenings");
  });

  it("sees no learner profiles", async () => {
    const { data, error } = await studentClient.from("learner_profiles").select("student_id");
    expectNoRows(data, error, "learner_profiles");
  });

  it("sees no chat messages", async () => {
    const { data, error } = await studentClient.from("chat_messages").select("id");
    expectNoRows(data, error, "chat_messages");
  });

  it("sees no other student's record", async () => {
    const { data, error } = await studentClient
      .from("students")
      .select("id")
      .neq("id", studentRow.id);
    expectNoRows(data, error, "other students");
  });

  it("cannot rewrite a step's title", async () => {
    // The column grant in student_accounts.sql. RLS alone is row-level, so
    // without the grant the update policy would allow this.
    const { error } = await studentClient
      .from("journey_steps")
      .update({ title: "rewritten by the student" })
      .eq("id", stepId);
    expect(error, "a student rewrote a step title — the column grant is missing").not.toBeNull();

    const { data } = await admin.from("journey_steps").select("title").eq("id", stepId).single();
    expect(data.title).toBe("E2E step");
  });
});

describe("the therapist path still works", () => {
  // These MUST go through therapistClient, not admin. The column grant
  // constrains `authenticated`; the service-role client the admin uses is a
  // different Postgres role the grant never touches, so asserting through it
  // would prove nothing while looking green.
  it("can still tick a step after the column grant", async () => {
    const { error } = await therapistClient
      .from("journey_steps")
      .update({ status: "in_progress", completed_at: null })
      .eq("id", stepId);
    expect(
      error,
      "the therapist can no longer tick a step — the column grant went too far"
    ).toBeNull();

    const { data } = await admin.from("journey_steps").select("status").eq("id", stepId).single();
    expect(data.status).toBe("in_progress");
  });

  it("still reads its own student and journey", async () => {
    const { data, error } = await therapistClient
      .from("students")
      .select("id")
      .eq("id", studentRow.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("is also blocked from rewriting a step title", async () => {
    // Not a regression: no code path writes these columns, and the grant is
    // role-wide. Pinned so the behaviour is a recorded decision rather than a
    // surprise the next time someone edits a step.
    const { error } = await therapistClient
      .from("journey_steps")
      .update({ title: "rewritten by the therapist" })
      .eq("id", stepId);
    expect(error).not.toBeNull();
  });
});
