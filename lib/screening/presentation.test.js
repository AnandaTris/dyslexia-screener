import { describe, expect, it } from "vitest";
import { getScreeningOutcomeView } from "./presentation.js";

describe("screening outcome presentation", () => {
  it("shows a caution outcome and pattern analysis for indicator-bearing low scores", () => {
    const view = getScreeningOutcomeView({
      verdict: "unlikely",
      transcription: "Bcus the chrch was far.",
      indicators: [
        {
          category: "phonetic_spelling",
          strength: "moderate",
        },
      ],
      screeningOutcome: {
        code: "continue_screening",
        heading: "Indicators found — continue screening",
        allowPatternAnalysis: true,
      },
    });

    expect(view).toEqual({
      heading: "Indicators found — continue screening",
      className: "v-monitor",
      showPatternAnalysis: true,
    });
  });

  it("uses the assessment styling for samples above the follow-up threshold", () => {
    const view = getScreeningOutcomeView({
      transcription: "The sample text.",
      screeningOutcome: {
        code: "assessment_recommended",
        heading: "Further assessment recommended",
        allowPatternAnalysis: true,
      },
    });

    expect(view).toEqual({
      heading: "Further assessment recommended",
      className: "v-likely",
      showPatternAnalysis: true,
    });
  });

  it("uses the clear styling and hides analysis when no indicators were found", () => {
    const view = getScreeningOutcomeView({
      transcription: "A conventional sample.",
      screeningOutcome: {
        code: "no_clear_indicators",
        heading: "No clear indicators found in this sample",
        allowPatternAnalysis: false,
      },
    });

    expect(view).toEqual({
      heading: "No clear indicators found in this sample",
      className: "v-unlikely",
      showPatternAnalysis: false,
    });
  });

  it("requires a usable transcription before offering pattern analysis", () => {
    const view = getScreeningOutcomeView({
      transcription: "   ",
      screeningOutcome: {
        code: "continue_screening",
        heading: "Indicators found — continue screening",
        allowPatternAnalysis: true,
      },
    });

    expect(view.showPatternAnalysis).toBe(false);
  });
});
