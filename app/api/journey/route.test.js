import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../../lib/ragService", () => ({ callRagService: vi.fn() }));

import { GET, POST } from "./route.js";
import { createClient } from "../../../lib/supabase/server";
import { callRagService } from "../../../lib/ragService";
import { fakeSupabase } from "../../../tests/support/queryBuilder.js";

const PROFILE = { primary_label: "phonological", weights: { phonological: 3 } };

function withProfile(extra = {}) {
  return fakeSupabase({
    user: { id: "u1" },
    data: {
      learner_profiles: { data: { profile: PROFILE }, error: null },
      journeys: { data: null, error: null },
      journey_steps: { data: [], error: null },
      ...extra,
    },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/journey", () => {
  it("401 when not signed in", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: null }));
    expect((await GET()).status).toBe(401);
  });

  it("returns null when the user has no active journey", async () => {
    createClient.mockResolvedValue(withProfile());
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).journey).toBeNull();
  });

  it("returns the active journey with its steps in order", async () => {
    createClient.mockResolvedValue(
      withProfile({
        journeys: { data: { id: "j1", created_at: "2026-07-26" }, error: null },
        journey_steps: {
          data: [
            { id: "s1", step_index: 0, title: "A", status: "done" },
            { id: "s2", step_index: 1, title: "B", status: "not_started" },
          ],
          error: null,
        },
      })
    );
    const body = await (await GET()).json();
    expect(body.journey.id).toBe("j1");
    expect(body.journey.steps.map((s) => s.title)).toEqual(["A", "B"]);
  });
});

describe("POST /api/journey", () => {
  it("401 when not signed in", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: null }));
    expect((await POST()).status).toBe(401);
  });

  it("400 when the user has no derived profile yet", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ user: { id: "u1" }, data: { learner_profiles: { data: null, error: null } } })
    );
    const res = await POST();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/screening/i);
  });

  it("503 with offline flag when the service is down", async () => {
    createClient.mockResolvedValue(withProfile());
    callRagService.mockResolvedValue({ ok: false, offline: true, error: "off" });
    const res = await POST();
    expect(res.status).toBe(503);
    expect((await res.json()).offline).toBe(true);
  });

  it("returns the service note and persists nothing when no material is ingested", async () => {
    const supabase = withProfile();
    createClient.mockResolvedValue(supabase);
    callRagService.mockResolvedValue({
      ok: true,
      data: { steps: [], note: "No source material available yet." },
    });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.journey).toBeNull();
    expect(body.note).toMatch(/no source material/i);
    expect(supabase.writesTo("journeys", "insert")).toHaveLength(0);
  });

  it("archives the old journey, persists the new one and its steps", async () => {
    const supabase = fakeSupabase({
      user: { id: "u1" },
      data: {
        learner_profiles: { data: { profile: PROFILE }, error: null },
        "journeys.insert": { data: { id: "j2" }, error: null },
        journeys: { data: null, error: null },
        "journey_steps.insert": {
          data: [
            { id: "s1", step_index: 0, title: "Step one", status: "not_started" },
            { id: "s2", step_index: 1, title: "Step two", status: "not_started" },
          ],
          error: null,
        },
        journey_steps: { data: [], error: null },
      },
    });
    createClient.mockResolvedValue(supabase);
    callRagService.mockResolvedValue({
      ok: true,
      data: {
        steps: [
          {
            step_index: 0,
            title: "Step one",
            description: "Do a thing",
            citations: [{ id: "c1", title: "Guide" }],
          },
          { step_index: 1, title: "Step two", description: "Do another", citations: [] },
        ],
        note: null,
      },
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.journey.id).toBe("j2");
    expect(body.journey.steps).toHaveLength(2);

    // The steps come back with their database ids. The board tracks a step by
    // id, so returning the pre-insert rows would leave every checkbox unable to
    // name the row it is meant to update.
    expect(body.journey.steps.map((s) => s.id)).toEqual(["s1", "s2"]);

    // The previous active journey is archived, and the archive explicitly skips
    // the journey just created.
    const archived = supabase.writesTo("journeys", "update");
    expect(archived).toHaveLength(1);
    expect(archived[0].patch.status).toBe("archived");
    expect(archived[0].filters).toContainEqual(["id", "j2", "neq"]);

    // steps go in as one batch, indexed, carrying citations
    const stepWrites = supabase.writesTo("journey_steps", "insert");
    expect(stepWrites).toHaveLength(1);
    expect(stepWrites[0].rows).toHaveLength(2);
    expect(stepWrites[0].rows[0]).toMatchObject({
      journey_id: "j2",
      step_index: 0,
      title: "Step one",
      status: "not_started",
    });
    expect(stepWrites[0].rows[0].citations[0].id).toBe("c1");
  });

  it("does not cost the learner their old journey when saving the steps fails", async () => {
    const supabase = fakeSupabase({
      user: { id: "u1" },
      data: {
        learner_profiles: { data: { profile: PROFILE }, error: null },
        "journeys.insert": { data: { id: "j2" }, error: null },
        journeys: { data: null, error: null },
        "journey_steps.insert": { data: null, error: { message: "insert failed" } },
      },
    });
    createClient.mockResolvedValue(supabase);
    callRagService.mockResolvedValue({
      ok: true,
      data: {
        steps: [{ step_index: 0, title: "Step one", description: "Do a thing", citations: [] }],
      },
    });

    const res = await POST();
    expect(res.status).toBe(500);

    // The half-built journey is rolled back...
    const deleted = supabase.writesTo("journeys", "delete");
    expect(deleted).toHaveLength(1);
    expect(deleted[0].filters).toContainEqual(["id", "j2"]);

    // ...and the journey the learner already had is left active. A failed
    // rebuild must not be indistinguishable from a successful one.
    expect(supabase.writesTo("journeys", "update")).toHaveLength(0);
  });

  it("passes the derived profile through to the service", async () => {
    createClient.mockResolvedValue(withProfile());
    callRagService.mockResolvedValue({ ok: true, data: { steps: [], note: "none" } });
    await POST();
    expect(callRagService).toHaveBeenCalledWith("/journey", { profile: PROFILE });
  });
});
