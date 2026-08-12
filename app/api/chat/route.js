import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { callRagService } from "../../../lib/ragService";
import { MODEL_HISTORY_TURNS, loadRecentMessages } from "../../../lib/chat";
import { rateLimit } from "../../../lib/rateLimit";

const MODES = ["grounded", "plain"];

// A warm grounded answer measures 16-20 s and holds the local model for all of
// it, so a legitimate user cannot exceed about three a minute by hand. Ten
// leaves that untouched while stopping a script from queueing hundreds.
const CHAT_BUDGET = { limit: 10, windowMs: 60_000 };

// `/api/analyze-text` caps a whole writing sample at 20,000 characters. A
// question is not a sample: 2,000 is far more than anyone types, and the length
// matters because the text becomes prompt the local model pays to read.
const MAX_QUESTION_CHARS = 2_000;

// An unknown mode must never silently resolve to the ungrounded path. The safe
// value is the one that cites its sources, so anything unrecognised — a stale
// browser, a tampered payload, a typo — is answered with citations rather than
// rejected. The service validates independently and 422s a third value, so a
// caller that bypasses this route still cannot invent a mode.
function normaliseMode(value) {
  return MODES.includes(value) ? value : "grounded";
}

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
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `Question is longer than ${MAX_QUESTION_CHARS} characters. Please shorten it.` },
      { status: 400 }
    );
  }
  const mode = normaliseMode(body?.mode);

  // Charged here rather than at the top of the handler so that a malformed or
  // over-long request — which never reaches the model — does not spend the
  // caller's budget. What is being rationed is model time, and everything above
  // this line is a cheap rejection.
  const limit = rateLimit(`chat:${user.id}`, CHAT_BUDGET);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many questions in a short time. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const { data: profileRow } = await supabase
    .from("learner_profiles")
    .select("profile")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileRow?.profile ?? {};

  // Citations are for the on-screen log, not the prompt — the model is grounded
  // by the excerpts it is given now, not by what it cited last time. Profile and
  // history go out in both modes: plain mode is still a conversation, and the
  // emphasis is useful context even without excerpts.
  const history = await loadRecentMessages(supabase, user.id, MODEL_HISTORY_TURNS);
  const recent_history = history.map(({ role, content }) => ({ role, content }));

  const result = await callRagService("/chat", { question, profile, recent_history, mode });
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
  // `mode` is not written yet: the column is defined in supabase/rag_schema.sql
  // but has not been applied to the live project, and an insert naming a column
  // PostgREST does not know fails the whole row. That would cost the transcript
  // to gain a badge. Once the alter has run, add `mode` to both rows below and to
  // the select in lib/chat.js, and badges will survive a reload.
  await supabase.from("chat_messages").insert([
    { user_id: user.id, role: "user", content: question },
    { user_id: user.id, role: "assistant", content: answer, citations },
  ]);

  return NextResponse.json({ answer, citations, mode });
}
