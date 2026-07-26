/**
 * UC3 + UC8 — Predict Dyslexia + Call Model (unit)
 *
 * One test per row of the test plan:
 *
 *  | Path  | Input                        | Expected output      |
 *  |-------|------------------------------|----------------------|
 *  | Happy | Image attached / uploaded    | Prediction result    |
 *  | Error | No image attached / uploaded | Alert to attach file |
 *
 * Unit under test: the screening route (app/api/analyze/route.js) — the plan's
 * PredictionService — with the vision model (DyslexiaModel) and Supabase mocked.
 * `verifyFilePresent(image)` in the plan is the route's own file check.
 *
 * NOT COVERED, and worth knowing: `lib/screening/verdict.js` has no unit tests.
 * That module is the decision rule — the score threshold and the guard that holds
 * a verdict at "unlikely" when a young writer's only indicators are letter
 * reversals. It is the project's most defensible design choice and the thing that
 * makes the output a transparent rule rather than a raw model label. It is now
 * exercised only indirectly, through the happy path below and Integrated Test 3.
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

// The route constructs its SDK client at module load, so the class has to
// forward to whatever double the current test installed.
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

const SIGNED_IN = { id: "user-1", email: "teacher@school.edu" };

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  mocks.model.value = createFakeDyslexiaModel();
  mocks.client.value = createFakeSupabase({ currentUser: SIGNED_IN });
});

describe("UC3 + UC8 — Predict Dyslexia", () => {
  it("happy: an attached image is sent to the model and a prediction comes back", async () => {
    // Mock: PredictionService receives a prediction result for
    // predict(image, studentRef).
    const response = await POST(screeningRequest({ file: writingSampleFile(), writerAge: 9 }));
    const body = await response.json();

    expect(response.status).toBe(200);

    // The model was called once, with the file bytes, its mime type, and the
    // writer's age — the prompt discounts reversals for young writers, so the age
    // has to reach it.
    expect(mocks.model.value.calls).toHaveLength(1);
    const [imagePart, textPart] = mocks.model.value.calls[0].contents[0].parts;
    expect(imagePart.inlineData.mimeType).toBe("image/jpeg");
    expect(imagePart.inlineData.data.length).toBeGreaterThan(0);
    expect(textPart.text).toMatch(/The writer is 9 years old/);

    // Prediction result for the sample: risk label, confidence, evidence.
    expect(body.verdict).toBe("likely");
    expect(body.likelihoodScore).toBe(72);
    expect(body.transcription).toContain("The dog ran");
    expect(body.indicators).toHaveLength(2);
  });

  it("error: no image attached, so the caller is alerted to attach a file", async () => {
    // Mock: verifyFilePresent(image) = false, sends alert to upload image.
    const response = await POST(screeningRequest({}));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/must include a photo or PDF/i);
    // No model quota spent on a request carrying nothing to analyse.
    expect(mocks.model.value.calls).toHaveLength(0);
  });
});
