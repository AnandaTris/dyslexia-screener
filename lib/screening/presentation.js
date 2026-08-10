const OUTCOME_CLASSES = {
  assessment_recommended: "v-likely",
  continue_screening: "v-monitor",
  no_clear_indicators: "v-unlikely",
};

export function getScreeningOutcomeView(result) {
  const outcome = result.screeningOutcome;
  return {
    heading: outcome.heading,
    className: OUTCOME_CLASSES[outcome.code],
    showPatternAnalysis: Boolean(
      outcome.allowPatternAnalysis &&
        typeof result.transcription === "string" &&
        result.transcription.trim(),
    ),
  };
}
