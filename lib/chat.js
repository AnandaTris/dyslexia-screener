// How much of the conversation each consumer gets, and why the two numbers differ.
//
// The model sees a short window: history is there to resolve "what about that
// one?", and every extra turn costs prompt budget better spent on source
// excerpts. The dashboard log is a transcript the learner reads, so it shows
// more. Same query either way — one definition of "this user's conversation".
export const MODEL_HISTORY_TURNS = 6;
export const DISPLAYED_MESSAGES = 20;

// Postgres gives us newest-first so the limit takes the *latest* messages; the
// caller wants oldest-first, because that is how both a prompt and an on-screen
// log read. RLS scopes the rows to the caller, and the explicit user_id filter
// keeps that true even if the policy is ever loosened.
export async function loadRecentMessages(supabase, userId, limit) {
  const { data } = await supabase
    .from("chat_messages")
    .select("role, content, citations")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).slice().reverse();
}
