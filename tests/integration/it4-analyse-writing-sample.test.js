/**
 * Integrated Test 4 — Analyse Writing Sample (UC11 + UC12)
 *
 * From the test plan, bottom-up from the pipeline stages:
 *
 *  | Path  | Input                    | Expected output                                     | Mock                    |
 *  |-------|--------------------------|-----------------------------------------------------|-------------------------|
 *  | Happy | Writing sample submitted | Pipeline classifies the errors, profile stored in    | Pipeline runs for real  |
 *  |       |                          | error_analyses and displayed                        | (local model + lexicon) |
 *  | Error | No file submitted        | Documented no-file error, nothing stored            | None                    |
 *  | Error | A pipeline stage fails   | Failure result, error logged, flow discontinued     | T5 stage forced to fail |
 *
 * The route, the tokeniser, the word-boundary pass, the Hunspell/CMU lookups,
 * the classifier and the aggregator all run for real. Only the two boundaries
 * are doubled: Supabase, and the T5 weights.
 *
 * TWO DEVIATIONS from the plan, asserted as the code actually behaves:
 *
 *  1. The plan says "Supabase table real". It is doubled here instead. Writing
 *     to the live table needs project credentials in the test environment and
 *     leaves rows behind on every run, and `error_analyses` is row-level-secured
 *     against exactly the anonymous access a test would have. The double records
 *     the insert, so the assertion — that the analysis reaches the table with the
 *     dashboard's columns filled in — is the same assertion.
 *
 *  2. A failing pipeline stage does NOT discontinue the flow. The neural layer
 *     is optional by design: when the weights cannot be loaded the analyser
 *     falls back to the lexicon and phonology passes, reports the failure in
 *     `pipeline.neuralReason`, and warns in its caveats that real-word errors
 *     (their/there, to/too) could not be seen. A degraded report is more useful
 *     to a teacher than no report, so the third row below asserts the fallback
 *     rather than a discontinued flow.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../support/supabase.js";

const mocks = vi.hoisted(() => ({ client: { value: null } }));

vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => mocks.client.value,
}));

// The T5 weights are not in the repository — the first real load downloads
// ~70 MB from the Hugging Face hub. This stub is what makes the neural layer's
// failure deterministic for the third row; the first two switch the layer off
// at the config level instead, so it is never reached.
vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: async () => {
    throw new Error("weights unavailable");
  },
}));

const { POST } = await import("../../app/api/analyze-text/route.js");

const EDUCATOR = { id: "user-1", email: "teacher@school.edu" };

const WRITING_SAMPLE =
  "My frend and I went to the park after school. " +
  "The sun was brite so we bilt a sand castle togather. " +
  "I was very tird and we did not have enuf time to play. " +
  "We walked home befor it got dark.";

function submit(body) {
  return new Request("http://localhost:3000/api/analyze-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.client.value = createFakeSupabase({ currentUser: EDUCATOR });
});

describe("Integrated Test 4 — Analyse Writing Sample", () => {
  it("happy: the pipeline classifies the errors and the profile is stored and displayed", async () => {
    vi.stubEnv("NLP_GEC", "off");

    const response = await POST(submit({ text: WRITING_SAMPLE, writerAge: 9 }));
    const body = await response.json();

    expect(response.status).toBe(200);

    // --- displayed -------------------------------------------------------
    const { analysis } = body;
    expect(analysis.ok).toBe(true);
    expect(analysis.statistics.words).toBe(41);

    // Each stage left its mark: reconstruction (lexicon), tagging (classifier),
    // and roll-up (aggregator).
    const byProduced = Object.fromEntries(analysis.errors.map((e) => [e.produced, e]));
    expect(byProduced.frend).toMatchObject({ target: "friend", category: "orthographic" });
    expect(byProduced.enuf).toMatchObject({ target: "enough", subtype: "silent_letter" });
    expect(analysis.profile.dominant).toBe("surface");
    expect(analysis.profile.profiledErrors).toBeGreaterThanOrEqual(4);
    expect(analysis.summary).toContain("surface / orthographic pattern");
    expect(analysis.caveats.at(-1)).toContain("not a diagnosis");

    // --- stored ----------------------------------------------------------
    const rows = mocks.client.value.rowsIn("error_analyses");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: EDUCATOR.id,
      source: "text",
      sample_text: WRITING_SAMPLE,
      writer_age: 9,
      word_count: analysis.statistics.words,
      error_count: analysis.errors.length,
      dominant_profile: "surface",
    });
    // The whole report is kept alongside the lifted columns, so a finding can be
    // reopened later without re-running the pipeline.
    expect(rows[0].result.errors).toHaveLength(analysis.errors.length);
  });

  it("error: no sample submitted, so nothing is analysed and nothing is stored", async () => {
    vi.stubEnv("NLP_GEC", "off");

    const response = await POST(submit({ writerAge: 9 }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Request must include a text field.");
    expect(mocks.client.value.rowsIn("error_analyses")).toEqual([]);
  });

  it("error: the T5 stage fails, so the analysis degrades and says so", async () => {
    vi.stubEnv("NLP_GEC", "on");

    const response = await POST(submit({ text: WRITING_SAMPLE, writerAge: 9 }));
    const { analysis } = await response.json();

    // Deviation (2): the flow continues on the remaining layers.
    expect(response.status).toBe(200);
    expect(analysis.ok).toBe(true);
    expect(analysis.pipeline.layers).toMatchObject({ boundary: true, lexicon: true, neural: false });

    // The failure is reported rather than swallowed — this is the "error logged"
    // the plan asks for, carried in the response instead of only in a log line.
    expect(analysis.pipeline.neuralReason).toBe("weights unavailable");
    expect(
      analysis.caveats.some((c) => c.includes("contextual correction model was unavailable")),
    ).toBe(true);

    // Non-word misspellings were still found, so the report is degraded, not empty.
    expect(analysis.errors.length).toBeGreaterThan(0);
    expect(mocks.client.value.rowsIn("error_analyses")).toHaveLength(1);
  });
});
