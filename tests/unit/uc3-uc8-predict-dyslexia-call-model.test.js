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
 * The deterministic decision rule is tested directly in
 * `lib/screening/verdict.test.js`; this file verifies that the route supplies the
 * required context and returns that rule's user-facing outcome.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeDyslexiaModel,
  screeningJson,
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
    // writer's age, which is used only for the under-seven reversal safeguard.
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

  it("does not let the model infer or globally discount an omitted writer age", async () => {
    const response = await POST(screeningRequest({ file: writingSampleFile() }));

    expect(response.status).toBe(200);
    const request = mocks.model.value.calls[0];
    const textPart = request.contents[0].parts[1];

    expect(textPart.text).toMatch(/writer's age was not provided/i);
    expect(request.config.systemInstruction).toMatch(
      /do not infer.*age.*handwriting.*document labels/i,
    );
    expect(request.config.systemInstruction).toMatch(
      /do not globally lower.*score.*young/i,
    );
  });

  it("returns a continue-screening outcome for low scores with concrete indicators", async () => {
    mocks.model.value = createFakeDyslexiaModel({
      screening: screeningJson({
        verdict: "unlikely",
        likelihoodScore: 40,
      }),
    });

    const response = await POST(
      screeningRequest({ file: writingSampleFile(), writerAge: 6 }),
    );
    const body = await response.json();

    expect(body.verdict).toBe("unlikely");
    expect(body.screeningOutcome).toEqual({
      code: "continue_screening",
      heading: "Indicators found — continue screening",
      allowPatternAnalysis: true,
    });
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

// A screening belongs to a student, not to the therapist's account. These cover
// the boundary that makes that true.
describe("Screening is filed against a student", () => {
  it("400s when no student is named, before spending model quota", async () => {
    const response = await POST(
      screeningRequest({ file: writingSampleFile(), studentId: null })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/pick a student/i);
    expect(mocks.model.value.calls).toHaveLength(0);
  });

  it("404s for a student the therapist does not own, before spending model quota", async () => {
    mocks.client.value = createFakeSupabase({ currentUser: SIGNED_IN, students: [] });

    const response = await POST(
      screeningRequest({ file: writingSampleFile(), studentId: "someone-elses-student" })
    );

    expect(response.status).toBe(404);
    expect(mocks.model.value.calls).toHaveLength(0);
  });

  it("stores the screening and the derived profile against that student", async () => {
    const response = await POST(
      screeningRequest({ file: writingSampleFile(), writerAge: 9 })
    );
    expect(response.status).toBe(200);

    const screening = mocks.client.value.inserts.find((w) => w.table === "screenings");
    expect(screening.row.student_id).toBe("student-1");
    expect(screening.row.user_id).toBe(SIGNED_IN.id);

    // The profile is keyed on the student. Before per-student records this
    // upsert conflicted on user_id, which is exactly why screening a second
    // student overwrote the first one's profile.
    const profile = mocks.client.value.upserts.find((w) => w.table === "learner_profiles");
    expect(profile.row.student_id).toBe("student-1");
  });

  it("falls back to the student's year of birth when no age is typed", async () => {
    mocks.client.value = createFakeSupabase({
      currentUser: SIGNED_IN,
      students: [
        {
          id: "student-1",
          therapist_id: SIGNED_IN.id,
          display_name: "Young Writer",
          birth_year: new Date().getFullYear() - 6,
        },
      ],
    });

    await POST(screeningRequest({ file: writingSampleFile() }));

    // The age reaches the prompt, so the reversal guard fires without anyone
    // remembering to fill the field in.
    const [, textPart] = mocks.model.value.calls[0].contents[0].parts;
    expect(textPart.text).toMatch(/The writer is 6 years old/);
  });
});
