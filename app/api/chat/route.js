import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { callRagService } from "../../../lib/ragService";
import { MODEL_HISTORY_TURNS, loadRecentMessages } from "../../../lib/chat";

export async function POST(req) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  // A malformed body is a client mistake, so answer 400. Left unguarded, the
  // rejected parse would surface as an opaque 500.
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { question } = body ?? {};
  if (!question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }

  const { data: profileRow } = await supabase
    .from("learner_profiles")
    .select("profile")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileRow?.profile ?? {};

  // Citations are for the on-screen log, not the prompt — the model is grounded
  // by the excerpts it is given now, not by what it cited last time.
  const history = await loadRecentMessages(supabase, user.id, MODEL_HISTORY_TURNS);
  const recent_history = history.map(({ role, content }) => ({ role, content }));

  const result = await callRagService("/chat", { question, profile, recent_history });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, offline: result.offline ?? false },
      { status: 503 }
    );
  }

  const answer = result.data.answer ?? "";
  const citations = result.data.citations ?? [];

  // The write is deliberately not awaited into a failure path: the learner has a
  // grounded answer in hand, and losing the transcript is a smaller harm than
  // throwing that answer away. Persistence is best-effort; the reply is not.
  await supabase.from("chat_messages").insert([
    { user_id: user.id, role: "user", content: question },
    { user_id: user.id, role: "assistant", content: answer, citations },
  ]);

  return NextResponse.json({ answer, citations });
}
