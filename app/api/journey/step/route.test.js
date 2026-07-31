import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/supabase/server", () => ({ createClient: vi.fn() }));

import { PATCH } from "./route.js";
import { createClient } from "../../../../lib/supabase/server";
import { fakeSupabase } from "../../../../tests/support/queryBuilder.js";

function req(body) {
  return { json: async () => body };
}

function signedIn(stepResult) {
  return fakeSupabase({
    user: { id: "u1" },
    data: { journey_steps: stepResult },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/journey/step", () => {
  it("401 when not signed in", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: null }));
    expect((await PATCH(req({ stepId: "s1", status: "done" }))).status).toBe(401);
  });

  it("400 on a status the database would reject", async () => {
    createClient.mockResolvedValue(signedIn({ data: null, error: null }));
    const res = await PATCH(req({ stepId: "s1", status: "finished" }));
    expect(res.status).toBe(400);
  });

  it("400 when stepId is missing", async () => {
    createClient.mockResolvedValue(signedIn({ data: null, error: null }));
    expect((await PATCH(req({ status: "done" }))).status).toBe(400);
  });

  it("404 when the step is not the caller's (RLS returns no row)", async () => {
    createClient.mockResolvedValue(signedIn({ data: null, error: null }));
    const res = await PATCH(req({ stepId: "someone-elses", status: "done" }));
    expect(res.status).toBe(404);
  });

  it("marks a step done and stamps completed_at", async () => {
    const supabase = signedIn({
      data: { id: "s1", status: "done", completed_at: "2026-07-26T00:00:00Z" },
      error: null,
    });
    createClient.mockResolvedValue(supabase);

    const res = await PATCH(req({ stepId: "s1", status: "done" }));
    expect(res.status).toBe(200);
    expect((await res.json()).step.status).toBe("done");

    const [write] = supabase.writesTo("journey_steps", "update");
    expect(write.patch.status).toBe("done");
    expect(write.patch.completed_at).toBeTruthy();
    expect(write.filters).toContainEqual(["id", "s1"]);
  });

  it("clears completed_at when a step is reopened", async () => {
    const supabase = signedIn({ data: { id: "s1", status: "not_started" }, error: null });
    createClient.mockResolvedValue(supabase);

    await PATCH(req({ stepId: "s1", status: "not_started" }));

    const [write] = supabase.writesTo("journey_steps", "update");
    expect(write.patch.completed_at).toBeNull();
  });
});
