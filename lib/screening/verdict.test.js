/**
 * Planned Unit Test — verdict.js (PS1 verdict rule)
 *
 * From the test plan:
 *
 *   "A score of 55 or more returns 'likely'; the exception where every indicator
 *    is a letter reversal and the writer is under seven returns 'unlikely'; a
 *    score below 55 returns 'unlikely'. It needs no mocking, since it takes
 *    evidence in and returns a verdict with no external calls."
 *
 * One test per sentence of that row. No doubles: the rule is a pure function.
 */

import { describe, expect, it } from "vitest";
import { decideVerdict, DEVELOPMENTAL_REVERSAL_AGE, LIKELY_SCORE_THRESHOLD } from "./verdict.js";

/** Evidence of more than one kind, so the developmental exception cannot apply. */
const MIXED_INDICATORS = [
  { name: "Letter reversal", category: "reversal", strength: "strong" },
  { name: "Phonetic spelling", category: "phonetic_spelling", strength: "moderate" },
];

const REVERSALS_ONLY = [
  { name: "b/d reversal", category: "reversal", strength: "strong" },
  { name: "p/q reversal", category: "reversal", strength: "moderate" },
];

describe("decideVerdict", () => {
  it("returns 'likely' for a score at or above the threshold", () => {
    const decision = decideVerdict({
      isWritingSample: true,
      likelihoodScore: LIKELY_SCORE_THRESHOLD,
      indicators: MIXED_INDICATORS,
      writerAge: 9,
    });

    expect(decision.verdict).toBe("likely");
    expect(decision.score).toBe(LIKELY_SCORE_THRESHOLD);
    // Nothing was overridden, so there is nothing to explain to the educator.
    expect(decision.reason).toBeNull();
    expect(decision.outcome).toEqual({
      code: "assessment_recommended",
      heading: "Further assessment recommended",
      allowPatternAnalysis: true,
    });
  });

  it("holds the verdict at 'unlikely' when a young writer's only evidence is reversals", () => {
    const decision = decideVerdict({
      isWritingSample: true,
      likelihoodScore: 72,
      indicators: REVERSALS_ONLY,
      writerAge: DEVELOPMENTAL_REVERSAL_AGE - 1,
    });

    expect(decision.verdict).toBe("unlikely");
    // The score is NOT suppressed along with the verdict: the gauge still reads
    // 72, which is exactly why the reason has to come back with it.
    expect(decision.score).toBe(72);
    expect(decision.reason).toMatch(/letter reversal/i);
    expect(decision.outcome).toEqual({
      code: "continue_screening",
      heading: "Indicators found — continue screening",
      allowPatternAnalysis: true,
    });

    // The same evidence from an older writer is not held back.
    expect(
      decideVerdict({
        isWritingSample: true,
        likelihoodScore: 72,
        indicators: REVERSALS_ONLY,
        writerAge: DEVELOPMENTAL_REVERSAL_AGE,
      }).verdict,
    ).toBe("likely");
  });

  it("returns 'unlikely' for a score below the threshold", () => {
    const decision = decideVerdict({
      isWritingSample: true,
      likelihoodScore: LIKELY_SCORE_THRESHOLD - 1,
      indicators: MIXED_INDICATORS,
      writerAge: 9,
    });

    expect(decision.verdict).toBe("unlikely");
    expect(decision.score).toBe(LIKELY_SCORE_THRESHOLD - 1);
    expect(decision.reason).toBeNull();
    expect(decision.outcome).toEqual({
      code: "continue_screening",
      heading: "Indicators found — continue screening",
      allowPatternAnalysis: true,
    });
  });

  it("reports no clear indicators when a low-scoring sample has no evidence", () => {
    const decision = decideVerdict({
      isWritingSample: true,
      likelihoodScore: 20,
      indicators: [],
      writerAge: 9,
    });

    expect(decision.outcome).toEqual({
      code: "no_clear_indicators",
      heading: "No clear indicators found in this sample",
      allowPatternAnalysis: false,
    });
  });

  it("does not recommend assessment from a model score with no indicators", () => {
    const decision = decideVerdict({
      isWritingSample: true,
      likelihoodScore: 80,
      indicators: [],
      writerAge: 9,
    });

    expect(decision.verdict).toBe("unlikely");
    expect(decision.score).toBe(0);
    expect(decision.outcome.code).toBe("no_clear_indicators");
  });
});
