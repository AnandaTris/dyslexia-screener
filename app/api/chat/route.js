import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { callRagService } from "../../../lib/ragService";

export async function POST(req) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { question } = await req.json();
  if (!question || !question.trim()) {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }

  const { data: profileRow } = await supabase
    .from("learner_profiles")
    .select("profile")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileRow?.profile ?? {};

  const { data: history } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(6);
  const recent_history = (history ?? []).slice().reverse();

  const result = await callRagService("/chat", { question, profile, recent_history });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, offline: result.offline ?? false },
      { status: 503 }
    );
  }

  const answer = result.data.answer ?? "";
  const citations = result.data.citations ?? [];

  await supabase.from("chat_messages").insert([
    { user_id: user.id, role: "user", content: question },
    { user_id: user.id, role: "assistant", content: answer, citations },
  ]);

  return NextResponse.json({ answer, citations });
}
