/**
 * Integrated Test 3 — Prediction Service
 *
 * The sequence under test, from the plan:
 *
 *   TestRunner -> PredictionService: predict(image, studentRef)
 *   PredictionService -> SampleRepository: save(sample)         --> sampleId
 *   PredictionService -> DyslexiaModel: predict(sample)         --> Risk Label, confidence
 *   PredictionService -> PredictionRepository: save(prediction) --> predictionId
 *   PredictionService --> TestRunner: Prediction Result
 *
 * PredictionService is the screening route; DyslexiaModel is Gemini, doubled. The
 * real `decideVerdict` rule runs — that is the integration that matters, because
 * the verdict the user sees and the verdict the model proposed are not always the
 * same, and the route is where the two meet.
 *
 * TWO DEVIATIONS from the diagram, asserted as the code actually behaves:
 *
 *  1. There is no separate SampleRepository. The sample (its transcription) and
 *     the prediction are written together as ONE row in `screenings`, after the
 *     model returns — so no `sampleId` is issued before the model call. Saving the
 *     sample first would be better: a model failure currently loses the upload.
 *
 *  2. There is no `studentRef`. A screening is attached to the signed-in educator
 *     (`user_id`), not to an identified student, so results cannot yet be grouped
 *     per learner — the same gap the README lists under "Still to do".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeDyslexiaModel,
  screeningRequest,
  writingSampleFile,
} from "../support/model.js";
import { createFakeSupabase } from "../support/supabase.js";

const mocks = vi.hoisted(() => ({
  model: { value: null },
  client: { value: null },
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateContent: (request) => mocks.model.value.models.generateContent(request),
      };
    }
  },
}));

vi.mock("../../lib/supabase/server.js", () => ({
  createClient: async () => mocks.client.value,
}));

const { POST } = await import("../../app/api/analyze/route.js");

const EDUCATOR = { id: "user-1", email: "teacher@school.edu" };

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  mocks.model.value = createFakeDyslexiaModel();
  mocks.client.value = createFakeSupabase({ currentUser: EDUCATOR });
});

describe("Integrated Test 3 — Prediction Service", () => {
  it("predict -> model -> save(prediction) -> predictionId -> prediction result", async () => {
    const response = await POST(screeningRequest({ file: writingSampleFile(), writerAge: 9 }));
    const body = await response.json();

    // DyslexiaModel was called exactly once, with the sample.
    expect(mocks.model.value.calls).toHaveLength(1);

    // PredictionRepository received one row for the signed-in educator.
    const rows = mocks.client.value.rowsIn("screenings");
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row.user_id).toBe(EDUCATOR.id);
    expect(row.verdict).toBe("likely");
    expect(row.likelihood_score).toBe(72);
    // The sample itself travels in the same row — deviation (1) above…
    expect(row.transcription).toContain("The dog ran");
    // …alongside the model's unmodified output, kept so the rule's decision and
    // the model's own label can be compared later.
    expect(row.result.indicators).toHaveLength(2);

    // Prediction Result returned to the caller: risk label + confidence.
    expect(response.status).toBe(200);
    expect(body.verdict).toBe("likely");
    expect(body.likelihoodScore).toBe(72);
  });
});
