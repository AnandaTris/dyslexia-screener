import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { callRagService } from "../../../lib/ragService";
import { loadActiveJourney } from "../../../lib/journey";
import { loadStudent } from "../../../lib/students";
import { rateLimit } from "../../../lib/rateLimit";

// Building a journey measures 72-122 s — the heaviest thing the machine does,
// and several times a chat answer. Five in five minutes is beyond the pace a
// therapist could reach anyway, since each build occupies most of two minutes.
// GET is deliberately not limited: it reads the database and never calls a model.
const JOURNEY_BUDGET = { limit: 5, windowMs: 5 * 60_000 };

const UNAUTHENTICATED = { error: "You must be signed in." };
const NO_STUDENT = { error: "Pick a student first." };
const UNKNOWN_STUDENT = { error: "That student was not found." };

// Resolves the caller and the student together, because every path below needs
// both and neither is useful alone. Returns either an error response to hand
// straight back, or the pair.
async function resolveCaller(supabase, studentId) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json(UNAUTHENTICATED, { status: 401 }) };

  if (!studentId) return { response: NextResponse.json(NO_STUDENT, { status: 400 }) };

  // RLS would already hide another therapist's student, but checking here turns
  // that into an explicit 404 rather than a confusing empty journey.
  const student = await loadStudent(supabase, user.id, studentId);
  if (!student) return { response: NextResponse.json(UNKNOWN_STUDENT, { status: 404 }) };

  return { user, student };
}

// GET returns null (not 404) when there is no journey — "this student hasn't
// had one built yet" is a normal state, not an error.
export async function GET(request) {
  const supabase = await createClient();
  const studentId = new URL(request.url).searchParams.get("student_id");

  const { response, user, student } = await resolveCaller(supabase, studentId);
  if (response) return response;

  return NextResponse.json({
    journey: await loadActiveJourney(supabase, user.id, student.id),
  });
}

export async function POST(request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => ({}));

  const { response, user, student } = await resolveCaller(supabase, body?.student_id);
  if (response) return response;

  const { data: profileRow } = await supabase
    .from("learner_profiles")
    .select("profile")
    .eq("student_id", student.id)
    .maybeSingle();
  const profile = profileRow?.profile;
  if (!profile) {
    return NextResponse.json(
      {
        error: `Run a writing screening for ${student.display_name} first — the journey is built from that profile.`,
      },
      { status: 400 }
    );
  }

  // Charged immediately before the model call, so the rejections above — no
  // student, no profile — cost the caller nothing. Keyed by user, not by
  // student, or a caseload of ten students would be ten separate budgets.
  const limit = rateLimit(`journey:${user.id}`, JOURNEY_BUDGET);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many journeys built in a short time. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const result = await callRagService("/journey", { profile });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, offline: result.offline ?? false },
      { status: 503 }
    );
  }

  const steps = result.data.steps ?? [];
  if (steps.length === 0) {
    // Nothing ingested yet. Persisting an empty journey would leave the student
    // with a permanent blank board, so hand back the service's note instead.
    return NextResponse.json({
      journey: null,
      note: result.data.note ?? "No source material available yet to build a journey.",
    });
  }

  const { data: journey, error: journeyError } = await supabase
    .from("journeys")
    .insert({
      user_id: user.id,
      student_id: student.id,
      profile_snapshot: profile,
      status: "active",
    })
    .select("id, created_at")
    .single();

  if (journeyError || !journey) {
    return NextResponse.json(
      {
        error:
          "Could not save the journey. Check that supabase/rag_schema.sql and supabase/students.sql have both been applied.",
      },
      { status: 500 }
    );
  }

  const rows = steps.map((step, i) => ({
    journey_id: journey.id,
    step_index: step.step_index ?? i,
    title: step.title ?? "",
    description: step.description ?? "",
    citations: step.citations ?? [],
    status: "not_started",
  }));

  // Select the rows back: the client tracks a step by its database id, and the
  // rows above do not have one yet. Returning the pre-insert objects would hand
  // the board steps with `id: undefined`, and every tick would fail.
  const { data: savedSteps, error: stepsError } = await supabase
    .from("journey_steps")
    .insert(rows)
    .select("id, step_index, title, description, citations, status, completed_at");

  if (stepsError) {
    // Roll the parent row back. Leaving it would put an empty journey at the top
    // of the "newest active" query and hide the one the student already had.
    await supabase.from("journeys").delete().eq("id", journey.id);
    return NextResponse.json({ error: "Could not save the journey steps." }, { status: 500 });
  }

  // Only now supersede the previous journey, and only this student's. Scoping
  // to student_id is what stops a rebuild for one student archiving every other
  // student's journey. Archived, not deleted, so past progress survives.
  await supabase
    .from("journeys")
    .update({ status: "archived" })
    .eq("user_id", user.id)
    .eq("student_id", student.id)
    .eq("status", "active")
    .neq("id", journey.id);

  return NextResponse.json({ journey: { ...journey, steps: savedSteps ?? [] } });
}
