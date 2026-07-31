import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { callRagService } from "../../../lib/ragService";
import { loadActiveJourney } from "../../../lib/journey";

const UNAUTHENTICATED = { error: "You must be signed in." };

// GET returns null (not 404) when there is no journey — "you haven't built one
// yet" is a normal state, not an error.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(UNAUTHENTICATED, { status: 401 });

  return NextResponse.json({ journey: await loadActiveJourney(supabase, user.id) });
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(UNAUTHENTICATED, { status: 401 });

  const { data: profileRow } = await supabase
    .from("learner_profiles")
    .select("profile")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileRow?.profile;
  if (!profile) {
    return NextResponse.json(
      { error: "Run a writing screening first — your journey is built from that profile." },
      { status: 400 }
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
    // Nothing ingested yet. Persisting an empty journey would leave the learner
    // with a permanent blank board, so hand back the service's note instead.
    return NextResponse.json({
      journey: null,
      note: result.data.note ?? "No source material available yet to build a journey.",
    });
  }

  const { data: journey, error: journeyError } = await supabase
    .from("journeys")
    .insert({ user_id: user.id, profile_snapshot: profile, status: "active" })
    .select("id, created_at")
    .single();

  if (journeyError || !journey) {
    return NextResponse.json(
      {
        error:
          "Could not save the journey. Check that supabase/rag_schema.sql has been applied.",
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
    // of the "newest active" query and hide the one the learner already had.
    await supabase.from("journeys").delete().eq("id", journey.id);
    return NextResponse.json({ error: "Could not save the journey steps." }, { status: 500 });
  }

  // Only now supersede the previous journey. Archiving first would mean a failed
  // build cost the learner the journey they already had — and the UI promises
  // the opposite. Archived, not deleted, so past progress survives a rebuild.
  await supabase
    .from("journeys")
    .update({ status: "archived" })
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("id", journey.id);

  return NextResponse.json({ journey: { ...journey, steps: savedSteps ?? [] } });
}
