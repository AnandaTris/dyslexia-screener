/**
 * The screening decision rule.
 *
 * The vision model returns a `verdict` label and a `likelihoodScore` as two
 * independent fields, and nothing made them agree — a sample could come back
 * labelled "likely" with a score of 20. The developmental safeguard in the
 * system prompt ("only output likely if there is evidence beyond reversals
 * alone" for young writers) had the same problem: it was a request to the
 * model, not something the system enforced.
 *
 * This module is the decision itself. The model supplies evidence — a score,
 * a list of indicators — and the rule below turns that evidence into the
 * verdict shown to the educator. The cutoff is one number you can tune, and
 * the safeguard runs on every sample instead of being hoped for.
 *
 * This is a transparent rule over features an LLM extracted, NOT a trained
 * classifier. Describe it that way.
 */

// Evidence strength at or above which a sample is worth a formal assessment.
// Matches the anchoring given to the model in the system prompt, where 55-75
// is "clear evidence across 2-3 categories".
export const LIKELY_SCORE_THRESHOLD = 55;

// Below this age, letter reversals are a normal stage of writing development
// rather than an indicator of anything, so reversal-only evidence cannot carry
// a verdict on its own.
export const DEVELOPMENTAL_REVERSAL_AGE = 7;

/**
 * Coerces the model's score into an integer 0-100. The model is asked for a
 * number in that range but nothing guarantees one, and a NaN reaching the
 * gauge renders as an empty bar with no explanation.
 */
export function normaliseScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * True when there is reversal evidence and it is the ONLY kind present. An
 * empty list is not reversal-only — there is simply no evidence, which the
 * score threshold already handles.
 */
function isReversalOnly(indicators) {
  return (
    indicators.length > 0 &&
    indicators.every((indicator) => indicator?.category === "reversal")
  );
}

function buildOutcome(indicators, assessmentRecommended = false) {
  if (indicators.length === 0) {
    return {
      code: "no_clear_indicators",
      heading: "No clear indicators found in this sample",
      allowPatternAnalysis: false,
    };
  }

  if (assessmentRecommended) {
    return {
      code: "assessment_recommended",
      heading: "Further assessment recommended",
      allowPatternAnalysis: true,
    };
  }

  return {
    code: "continue_screening",
    heading: "Indicators found — continue screening",
    allowPatternAnalysis: true,
  };
}

/**
 * Decides the verdict from the evidence the model extracted.
 *
 * Returns the compatibility verdict, cleaned score, user-facing screening
 * outcome, and a `reason` that is non-null only when the developmental rule
 * overrode a score that would otherwise have read "likely".
 */
export function decideVerdict({
  isWritingSample,
  likelihoodScore,
  indicators,
  writerAge,
} = {}) {
  const score = normaliseScore(likelihoodScore);
  const list = Array.isArray(indicators) ? indicators : [];

  // Nothing to screen. The prompt asks for a zero score here; this guarantees it.
  if (!isWritingSample) {
    return { verdict: "unlikely", score: 0, reason: null };
  }

  // A score without concrete indicators is not evidence. Keep the raw model
  // response in storage for audit, but never turn that inconsistency into a
  // positive decision shown to an educator.
  if (list.length === 0) {
    return {
      verdict: "unlikely",
      score: 0,
      reason: null,
      outcome: buildOutcome(list),
    };
  }

  if (score < LIKELY_SCORE_THRESHOLD) {
    return {
      verdict: "unlikely",
      score,
      reason: null,
      outcome: buildOutcome(list),
    };
  }

  const age = Number(writerAge);
  const isYoungWriter =
    Number.isFinite(age) && age > 0 && age < DEVELOPMENTAL_REVERSAL_AGE;

  if (isYoungWriter && isReversalOnly(list)) {
    return {
      verdict: "unlikely",
      score,
      reason:
        `Every indicator found is a letter reversal, which is a normal stage of ` +
        `writing development at age ${age}. The evidence is real, but it does not ` +
        `distinguish this writer, so the verdict is held at "unlikely" until there ` +
        `is evidence beyond reversals.`,
      outcome: buildOutcome(list),
    };
  }

  return {
    verdict: "likely",
    score,
    reason: null,
    outcome: buildOutcome(list, true),
  };
}
