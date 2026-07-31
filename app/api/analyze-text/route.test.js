/**
 * Planned Unit Test — API route: error analysis submission.
 *
 * From the test plan: "API routes (screening submission, error analysis
 * submission): a valid request returns a stored result, and a request with no
 * file returns the documented error. Downstream services are mocked so the
 * route logic is tested in isolation."
 *
 * So the NLP pipeline is mocked here — the route's job is validation, auth,
 * dispatch and persistence, not classification. The pipeline itself runs for
 * real in tests/integration/it4-analyse-writing-sample.test.js.
 *
 * This route takes pasted text rather than an upload, so "no file" is a request
 * with no `text` field.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../../tests/support/supabase.js";

const mocks = vi.hoisted(() => ({ client: { value: null } }));

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => mocks.client.value,
}));

vi.mock("../../../lib/nlp/analyze", () => ({ analyzeWriting: vi.fn() }));

const { POST } = await import("./route.js");
const { analyzeWriting } = await import("../../../lib/nlp/analyze");

const EDUCATOR = { id: "user-1", email: "teacher@school.edu" };

const SAMPLE = "My frend and I went to the park after school and it was very fun.";

/** The shape `analyzeWriting` returns on success, trimmed to what the route reads. */
const ANALYSIS = {
  ok: true,
  statistics: { words: 14 },
  errors: [{ produced: "frend", target: "friend", category: "orthographic" }],
  categoryCounts: { orthographic: 1 },
  profile: { dominant: "surface", label: "Surface / orthographic pattern", confidence: 0.6 },
};

function request(body) {
  return new Request("http://localhost:3000/api/analyze-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.value = createFakeSupabase({ currentUser: EDUCATOR });
  analyzeWriting.mockResolvedValue(ANALYSIS);
});

describe("POST /api/analyze-text", () => {
  it("valid request: returns the analysis and stores it", async () => {
    const response = await POST(request({ text: SAMPLE, writerAge: 9 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.text).toBe(SAMPLE);
    expect(body.analysis.profile.dominant).toBe("surface");

    // The pipeline was asked for an analysis of this sample, with the age.
    expect(analyzeWriting).toHaveBeenCalledWith(SAMPLE, { writerAge: 9, transcribed: false });

    // One row, attributed to the signed-in user, with the columns the dashboard
    // reads lifted out of the analysis.
    const rows = mocks.client.value.rowsIn("error_analyses");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: EDUCATOR.id,
      source: "text",
      sample_text: SAMPLE,
      writer_age: 9,
      word_count: 14,
      error_count: 1,
      dominant_profile: "surface",
    });
  });

  it("no sample submitted: returns the documented error and stores nothing", async () => {
    const response = await POST(request({ writerAge: 9 }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Request must include a text field.");

    // The pipeline was never started and nothing was written.
    expect(analyzeWriting).not.toHaveBeenCalled();
    expect(mocks.client.value.rowsIn("error_analyses")).toEqual([]);
  });
});
