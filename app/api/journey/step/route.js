import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";

// Mirrors the check constraint on journey_steps.status. Validating here turns a
// typo into a clear 400 instead of an opaque Postgres constraint error.
const VALID_STATUS = new Set(["not_started", "in_progress", "done"]);

export async function PATCH(req) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  // A malformed body is a client mistake, so answer 400 rather than let the
  // rejected parse surface as an opaque 500.
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { stepId, status } = body ?? {};
  if (!stepId) {
    return NextResponse.json({ error: "A stepId is required." }, { status: 400 });
  }
  if (!VALID_STATUS.has(status)) {
    return NextResponse.json(
      { error: "Status must be not_started, in_progress or done." },
      { status: 400 }
    );
  }

  // No ownership check needed here: RLS on journey_steps only exposes rows whose
  // parent journey belongs to auth.uid(), so someone else's id matches nothing
  // and the update returns no row — which we report as 404.
  const { data: step, error } = await supabase
    .from("journey_steps")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", stepId)
    .select("id, step_index, title, description, citations, status, completed_at")
    .single();

  if (error || !step) {
    return NextResponse.json({ error: "That step could not be found." }, { status: 404 });
  }

  return NextResponse.json({ step });
}
