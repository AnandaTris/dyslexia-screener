/**
 * Test doubles for the vision model the screener calls (the plan's
 * DyslexiaModel) and helpers for building the multipart request the route
 * handler actually receives.
 *
 * The route reads exactly two things off the SDK: `ai.models.generateContent`
 * and `response.text`. The double implements that surface and nothing else, and
 * records every request so a test can assert what was sent to the model — the
 * file bytes, the mime type, and whether the writer's age reached the prompt.
 */

/** The JSON body the real model is instructed to return. */
export function screeningJson(overrides = {}) {
  return {
    isWritingSample: true,
    transcription: "The dog ran to the bark and the ball was reb.",
    verdict: "likely",
    likelihoodScore: 72,
    verdictReasoning: "Multiple reversals and phonetic spellings across the sample.",
    indicators: [
      {
        name: "Letter reversal",
        category: "reversal",
        evidence: '"dof" for "dog"',
        strength: "strong",
      },
      {
        name: "Phonetic spelling",
        category: "phonetic_spelling",
        evidence: '"reb" for "red"',
        strength: "moderate",
      },
    ],
    summary: "The sample shows several dyslexia-associated patterns.",
    importantCaveats: ["One sample is one data point."],
    ...overrides,
  };
}

/**
 * @param {object} options
 * @param {object} [options.screening] parsed JSON the model should return
 * @param {string} [options.rawText]   raw string to return instead (for malformed output)
 * @param {Error}  [options.throws]    error the model call should reject with
 */
export function createFakeDyslexiaModel({ screening, rawText, throws } = {}) {
  const calls = [];

  return {
    calls,
    models: {
      async generateContent(request) {
        calls.push(request);
        if (throws) throw throws;
        if (rawText !== undefined) return { text: rawText };
        return { text: JSON.stringify(screening ?? screeningJson()) };
      },
    },
  };
}

/** A stand-in photo of handwriting. Content is irrelevant; type and size are not. */
export function writingSampleFile({
  name = "handwriting.jpg",
  type = "image/jpeg",
  bytes = 2048,
} = {}) {
  return new File([new Uint8Array(bytes).fill(65)], name, { type });
}

/**
 * Builds the request the screener route receives: multipart/form-data with the
 * file under `file`, exactly as app/page.jsx posts it. Omit `file` to exercise
 * the "no image attached" path.
 */
export function screeningRequest({ file, writerAge, studentId = "student-1" } = {}) {
  const form = new FormData();
  if (file) form.set("file", file);
  if (writerAge !== undefined) form.set("writerAge", String(writerAge));
  // Every screening is filed against a student. Defaulted so existing tests read
  // unchanged; pass `studentId: null` to exercise the missing-student path.
  if (studentId) form.set("student_id", studentId);

  return new Request("http://localhost:3000/api/analyze", {
    method: "POST",
    body: form,
  });
}
