import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the two collaborators before importing the route.
vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../../lib/ragService", () => ({ callRagService: vi.fn() }));

import { POST } from "./route.js";
import { createClient } from "../../../lib/supabase/server";
import { callRagService } from "../../../lib/ragService";

function makeSupabase({ user }) {
  const inserted = [];
  return {
    _inserted: inserted,
    auth: { getUser: async () => ({ data: { user } }) },
    from(table) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { profile: { primary_label: "phonological" } } }),
            order: () => ({ limit: async () => ({ data: [] }) }),
          }),
        }),
        insert: async (rows) => { inserted.push([table, rows]); return { error: null }; },
      };
    },
  };
}

function req(body) {
  return { json: async () => body };
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/chat", () => {
  it("401 when not signed in", async () => {
    createClient.mockResolvedValue(makeSupabase({ user: null }));
    const res = await POST(req({ question: "hi" }));
    expect(res.status).toBe(401);
  });

  it("400 when question is blank", async () => {
    createClient.mockResolvedValue(makeSupabase({ user: { id: "u1" } }));
    const res = await POST(req({ question: "   " }));
    expect(res.status).toBe(400);
  });

  it("503 with offline flag when the service is down", async () => {
    createClient.mockResolvedValue(makeSupabase({ user: { id: "u1" } }));
    callRagService.mockResolvedValue({ ok: false, offline: true, error: "off" });
    const res = await POST(req({ question: "help" }));
    expect(res.status).toBe(503);
    expect((await res.json()).offline).toBe(true);
  });

  it("returns the grounded answer and persists both messages", async () => {
    const supabase = makeSupabase({ user: { id: "u1" } });
    createClient.mockResolvedValue(supabase);
    callRagService.mockResolvedValue({ ok: true, data: { answer: "A", citations: [{ id: "c1" }] } });
    const res = await POST(req({ question: "help" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toBe("A");
    expect(body.citations[0].id).toBe("c1");
    // one insert call carrying both the user and assistant messages
    const chatInserts = supabase._inserted.filter(([t]) => t === "chat_messages");
    expect(chatInserts.length).toBe(1);
    expect(chatInserts[0][1].length).toBe(2);
  });

  it("passes a valid mode through to the service", async () => {
    createClient.mockResolvedValue(makeSupabase({ user: { id: "u1" } }));
    callRagService.mockResolvedValue({ ok: true, data: { answer: "A" } });
    await POST(req({ question: "help", mode: "plain" }));
    expect(callRagService).toHaveBeenCalledWith(
      "/chat",
      expect.objectContaining({ mode: "plain" })
    );
  });

  it("defaults to grounded when no mode is sent", async () => {
    createClient.mockResolvedValue(makeSupabase({ user: { id: "u1" } }));
    callRagService.mockResolvedValue({ ok: true, data: { answer: "A" } });
    await POST(req({ question: "help" }));
    expect(callRagService).toHaveBeenCalledWith(
      "/chat",
      expect.objectContaining({ mode: "grounded" })
    );
  });

  it("normalises an unrecognised mode to grounded rather than answering ungrounded", async () => {
    createClient.mockResolvedValue(makeSupabase({ user: { id: "u1" } }));
    callRagService.mockResolvedValue({ ok: true, data: { answer: "A" } });
    const res = await POST(req({ question: "help", mode: "PLAIN; drop table" }));
    expect(callRagService).toHaveBeenCalledWith(
      "/chat",
      expect.objectContaining({ mode: "grounded" })
    );
    expect((await res.json()).mode).toBe("grounded");
  });

  // Deliberate, not an oversight: chat_messages.mode is defined in
  // supabase/rag_schema.sql but not applied to the live project, and PostgREST
  // fails a whole insert that names a column it does not know. Persisting the
  // transcript matters more than persisting the badge. Delete this test when the
  // alter has run and mode goes back into the insert.
  it("does not write mode until the column exists", async () => {
    const supabase = makeSupabase({ user: { id: "u1" } });
    createClient.mockResolvedValue(supabase);
    callRagService.mockResolvedValue({ ok: true, data: { answer: "A" } });
    await POST(req({ question: "help", mode: "plain" }));
    const [, rows] = supabase._inserted.find(([t]) => t === "chat_messages");
    expect(rows.some((r) => "mode" in r)).toBe(false);
  });
});
