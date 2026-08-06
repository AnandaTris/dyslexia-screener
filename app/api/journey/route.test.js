import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../../lib/ragService", () => ({ callRagService: vi.fn() }));

import { GET, POST } from "./route.js";
import { createClient } from "../../../lib/supabase/server";
import { callRagService } from "../../../lib/ragService";
import { fakeSupabase } from "../../../tests/support/queryBuilder.js";

const PROFILE = { primary_label: "phonological", weights: { phonological: 3 } };
const STUDENT = { id: "st1", display_name: "Ana", birth_year: 2017 };

// Every request now names a student. These keep that noise out of the tests.
const getReq = (qs = "?student_id=st1") => new Request(`http://x/api/journey${qs}`);
const postReq = (body = { student_id: "st1" }) =>
  new Request("http://x/api/journey", { method: "POST", body: JSON.stringify(body) });

function withProfile(extra = {}) {
  return fakeSupabase({
    user: { id: "u1" },
    data: {
      students: { data: STUDENT, error: null },
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
    expect((await GET(getReq())).status).toBe(401);
  });

  it("400 when no student is named", async () => {
    createClient.mockResolvedValue(withProfile());
    const res = await GET(getReq(""));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/pick a student/i);
  });

  it("404 for a student the caller does not own", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ user: { id: "u1" }, data: { students: { data: null, error: null } } })
    );
    expect((await GET(getReq("?student_id=st-other"))).status).toBe(404);
  });

  it("returns null when the student has no active journey", async () => {
    createClient.mockResolvedValue(withProfile());
    const res = await GET(getReq());
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
    const body = await (await GET(getReq())).json();
    expect(body.journey.id).toBe("j1");
    expect(body.journey.steps.map((s) => s.title)).toEqual(["A", "B"]);
  });
});

describe("POST /api/journey", () => {
  it("401 when not signed in", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: null }));
    expect((await POST(postReq())).status).toBe(401);
  });

  it("400 when no student is named", async () => {
    createClient.mockResolvedValue(withProfile());
    expect((await POST(postReq({}))).status).toBe(400);
  });

  it("404 for a student the caller does not own", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ user: { id: "u1" }, data: { students: { data: null, error: null } } })
    );
    const res = await POST(postReq({ student_id: "st-other" }));
    expect(res.status).toBe(404);
    // Never reaches the service: an unknown student is not a reason to spend a
    // minute of local inference.
    expect(callRagService).not.toHaveBeenCalled();
  });

  it("400 when the student has no derived profile yet, naming them", async () => {
    createClient.mockResolvedValue(
      withProfile({ learner_profiles: { data: null, error: null } })
    );
    const res = await POST(postReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Ana/);
  });

  it("503 with offline flag when the service is down", async () => {
    createClient.mockResolvedValue(withProfile());
    callRagService.mockResolvedValue({ ok: false, offline: true, error: "off" });
    const res = await POST(postReq());
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
    const res = await POST(postReq());
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
        students: { data: STUDENT, error: null },
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

    const res = await POST(postReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.journey.id).toBe("j2");
    expect(body.journey.steps).toHaveLength(2);

    // The steps come back with their database ids. The board tracks a step by
    // id, so returning the pre-insert rows would leave every checkbox unable to
    // name the row it is meant to update.
    expect(body.journey.steps.map((s) => s.id)).toEqual(["s1", "s2"]);

    // The journey is stored against the student, not just the therapist.
    expect(supabase.writesTo("journeys", "insert")[0].rows).toMatchObject({
      user_id: "u1",
      student_id: "st1",
    });

    // The previous active journey is archived, the archive skips the journey
    // just created, and — the part that matters for per-student records — it is
    // scoped to this student so a rebuild for Ana cannot archive anyone else's.
    const archived = supabase.writesTo("journeys", "update");
    expect(archived).toHaveLength(1);
    expect(archived[0].patch.status).toBe("archived");
    expect(archived[0].filters).toContainEqual(["id", "j2", "neq"]);
    expect(archived[0].filters).toContainEqual(["student_id", "st1"]);

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

  it("does not cost the student their old journey when saving the steps fails", async () => {
    const supabase = fakeSupabase({
      user: { id: "u1" },
      data: {
        students: { data: STUDENT, error: null },
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

    const res = await POST(postReq());
    expect(res.status).toBe(500);

    // The half-built journey is rolled back...
    const deleted = supabase.writesTo("journeys", "delete");
    expect(deleted).toHaveLength(1);
    expect(deleted[0].filters).toContainEqual(["id", "j2"]);

    // ...and the journey the student already had is left active. A failed
    // rebuild must not be indistinguishable from a successful one.
    expect(supabase.writesTo("journeys", "update")).toHaveLength(0);
  });

  it("passes the derived profile through to the service", async () => {
    createClient.mockResolvedValue(withProfile());
    callRagService.mockResolvedValue({ ok: true, data: { steps: [], note: "none" } });
    await POST(postReq());
    expect(callRagService).toHaveBeenCalledWith("/journey", { profile: PROFILE });
  });

  it("looks the profile up by student, not by therapist", async () => {
    let seen = null;
    const supabase = fakeSupabase({
      user: { id: "u1" },
      data: {
        students: { data: STUDENT, error: null },
        learner_profiles: (state) => {
          seen = state.filters;
          return { data: { profile: PROFILE }, error: null };
        },
        journeys: { data: null, error: null },
      },
    });
    createClient.mockResolvedValue(supabase);
    callRagService.mockResolvedValue({ ok: true, data: { steps: [], note: "none" } });

    await POST(postReq());

    expect(seen).toContainEqual(["student_id", "st1"]);
    expect(seen).not.toContainEqual(["user_id", "u1"]);
  });
});
