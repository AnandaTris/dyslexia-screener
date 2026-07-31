import { describe, it, expect } from "vitest";
import { DISPLAYED_MESSAGES, MODEL_HISTORY_TURNS, loadRecentMessages } from "./chat.js";
import { fakeSupabase } from "../tests/support/queryBuilder.js";

describe("loadRecentMessages", () => {
  it("is an empty list, not null, when nothing has been said yet", async () => {
    const supabase = fakeSupabase({ data: { chat_messages: { data: null, error: null } } });
    expect(await loadRecentMessages(supabase, "u1", 6)).toEqual([]);
  });

  it("returns the rows oldest-first", async () => {
    // The query orders newest-first so the limit keeps the latest messages; a
    // log rendered in that order would read backwards.
    const supabase = fakeSupabase({
      data: {
        chat_messages: {
          data: [
            { role: "assistant", content: "newest" },
            { role: "user", content: "middle" },
            { role: "assistant", content: "oldest" },
          ],
          error: null,
        },
      },
    });

    const messages = await loadRecentMessages(supabase, "u1", 6);
    expect(messages.map((m) => m.content)).toEqual(["oldest", "middle", "newest"]);
  });

  it("filters to the caller", async () => {
    let filters;
    const supabase = fakeSupabase({
      data: {
        chat_messages: (state) => {
          filters = state.filters;
          return { data: [], error: null };
        },
      },
    });

    await loadRecentMessages(supabase, "u1", 6);
    expect(filters).toContainEqual(["user_id", "u1"]);
  });

  it("shows the learner more of the transcript than the model is given", () => {
    // Not arbitrary: the log is for reading, the model window is prompt budget.
    expect(DISPLAYED_MESSAGES).toBeGreaterThan(MODEL_HISTORY_TURNS);
  });
});
