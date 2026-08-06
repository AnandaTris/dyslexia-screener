/**
 * Integrated Test 5 — Per-student records.
 *
 * Real collaborators throughout: the actual screening route, the actual
 * deriveProfile, the actual journey route and loadActiveJourney. Only the two
 * true boundaries are doubled — Gemini and the RAG service — plus Supabase,
 * whose double now honours `onConflict` so a unique constraint is modelled
 * rather than assumed.
 *
 * The case that matters is the first one. Before per-student records,
 * learner_profiles.user_id was the PRIMARY KEY and the upsert conflicted on
 * user_id, so screening a second student overwrote the first student's profile
 * and silently destroyed the basis for their journey.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
  rag: { value: null },
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

vi.mock("../../lib/ragService.js", () => ({
  callRagService: (...args) => mocks.rag.value(...args),
}));

const { POST: screen } = await import("../../app/api/analyze/route.js");

const THERAPIST = { id: "therapist-1", email: "therapist@das.sg" };

const ANA = {
  id: "student-ana",
  therapist_id: THERAPIST.id,
  display_name: "Ana",
  birth_year: 2015,
};
const BEN = {
  id: "student-ben",
  therapist_id: THERAPIST.id,
  display_name: "Ben",
  birth_year: 2016,
};

// reversal(strong) + phonetic_spelling(moderate) -> visual_spatial leads.
const REVERSAL_HEAVY = screeningJson();

// Only sound-based indicators, so phonological leads instead. Two students with
// genuinely different profiles is the whole point of the first test.
const SOUND_HEAVY = screeningJson({
  indicators: [
    { category: "phonetic_spelling", detail: "spelt as it sounds", strength: "strong" },
    { category: "omission", detail: "missing sounds", strength: "strong" },
  ],
});

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  mocks.client.value = createFakeSupabase({
    currentUser: THERAPIST,
    students: [ANA, BEN],
  });
  mocks.rag.value = vi.fn();
});

describe("Integrated Test 5 — Per-student records", () => {
  it("screening a second student does not overwrite the first student's profile", async () => {
    mocks.model.value = createFakeDyslexiaModel({ screening: REVERSAL_HEAVY });
    const first = await screen(
      screeningRequest({ file: writingSampleFile(), studentId: ANA.id })
    );
    expect(first.status).toBe(200);

    mocks.model.value = createFakeDyslexiaModel({ screening: SOUND_HEAVY });
    const second = await screen(
      screeningRequest({ file: writingSampleFile(), studentId: BEN.id })
    );
    expect(second.status).toBe(200);

    // Two rows survive, keyed by student. The double replaces on the declared
    // onConflict column, so if the route still conflicted on user_id this would
    // be a single row and Ana's profile would be gone.
    const profiles = mocks.client.value.rowsIn("learner_profiles");
    expect(profiles).toHaveLength(2);

    const ana = profiles.find((p) => p.student_id === ANA.id);
    const ben = profiles.find((p) => p.student_id === BEN.id);
    expect(ana.profile.primary_label).toBe("visual_spatial");
    expect(ben.profile.primary_label).toBe("phonological");
  });

  it("re-screening the same student replaces that student's profile only", async () => {
    mocks.model.value = createFakeDyslexiaModel({ screening: REVERSAL_HEAVY });
    await screen(screeningRequest({ file: writingSampleFile(), studentId: ANA.id }));
    await screen(screeningRequest({ file: writingSampleFile(), studentId: BEN.id }));

    // Ana is screened again and her pattern has changed.
    mocks.model.value = createFakeDyslexiaModel({ screening: SOUND_HEAVY });
    await screen(screeningRequest({ file: writingSampleFile(), studentId: ANA.id }));

    const profiles = mocks.client.value.rowsIn("learner_profiles");
    expect(profiles).toHaveLength(2);
    expect(profiles.find((p) => p.student_id === ANA.id).profile.primary_label).toBe(
      "phonological"
    );
    // Ben is untouched by a screening that was never his.
    expect(profiles.find((p) => p.student_id === BEN.id).profile.primary_label).toBe(
      "visual_spatial"
    );
  });

  it("files each screening against the student it was run for", async () => {
    mocks.model.value = createFakeDyslexiaModel({ screening: REVERSAL_HEAVY });
    await screen(screeningRequest({ file: writingSampleFile(), studentId: ANA.id }));
    await screen(screeningRequest({ file: writingSampleFile(), studentId: BEN.id }));

    const screenings = mocks.client.value.rowsIn("screenings");
    expect(screenings.map((s) => s.student_id)).toEqual([ANA.id, BEN.id]);
    // The therapist is still recorded, because RLS is enforced on user_id.
    expect(screenings.every((s) => s.user_id === THERAPIST.id)).toBe(true);
  });

  it("refuses a student belonging to another therapist, before spending model quota", async () => {
    mocks.model.value = createFakeDyslexiaModel({ screening: REVERSAL_HEAVY });

    const response = await screen(
      screeningRequest({ file: writingSampleFile(), studentId: "someone-elses-student" })
    );

    expect(response.status).toBe(404);
    expect(mocks.model.value.calls).toHaveLength(0);
    expect(mocks.client.value.rowsIn("screenings")).toHaveLength(0);
    expect(mocks.client.value.rowsIn("learner_profiles")).toHaveLength(0);
  });

  it("takes the writer's age from the student when none is typed", async () => {
    mocks.model.value = createFakeDyslexiaModel({ screening: REVERSAL_HEAVY });

    await screen(screeningRequest({ file: writingSampleFile(), studentId: ANA.id }));

    // Ana was born in 2015, so the prompt must carry her age — the verdict rule
    // discounts reversals for young writers, and this is what stops that guard
    // depending on someone remembering to fill a field in.
    const expected = new Date().getFullYear() - ANA.birth_year;
    const [, textPart] = mocks.model.value.calls[0].contents[0].parts;
    expect(textPart.text).toMatch(new RegExp(`The writer is ${expected} years old`));
  });
});
