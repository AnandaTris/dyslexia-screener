// Persistence for error-pattern analyses.
//
// A storage failure must never lose the analysis the user is waiting on, so
// every failure here is logged and swallowed. The caller returns the report
// either way.

export async function persistErrorAnalysis(supabase, { userId, studentId = null, source, sampleText, writerAge, analysis, screeningId = null }) {
  const { error } = await supabase.from("error_analyses").insert({
    user_id: userId,
    // Whose errors these are. user_id is the therapist and is what RLS keys on;
    // student_id is what the trend charts group by. Rows written before
    // error_analyses_student.sql carry null here and simply sit outside every
    // learner's trend.
    student_id: studentId,
    screening_id: screeningId,
    source,
    sample_text: sampleText,
    writer_age: writerAge ?? null,
    word_count: analysis.statistics?.words ?? null,
    error_count: analysis.errors?.length ?? 0,
    dominant_profile: analysis.profile?.dominant ?? null,
    profile_label: analysis.profile?.label ?? null,
    profile_confidence: analysis.profile?.confidence ?? null,
    category_counts: analysis.categoryCounts ?? {},
    result: analysis,
  });

  if (error) {
    console.error("Failed to save error analysis:", error.message);
    return { saved: false, reason: error.message };
  }

  return { saved: true };
}
