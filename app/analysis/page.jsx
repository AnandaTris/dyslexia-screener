"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { takeHandoff } from "../../lib/screening/handoff";
import { createClient } from "../../lib/supabase/client";
import ErrorAnalysis from "../components/ErrorAnalysis";
import { signout } from "../login/actions";

/**
 * Reads a response body as JSON without throwing on a non-JSON body. An
 * unauthenticated request or a dev-server error page answers with HTML, and
 * res.json() on that throws a parser message that tells the user nothing.
 */
async function readJson(res) {
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function describeFailure(err) {
  if (err instanceof TypeError) {
    return "Couldn't reach the server. Your session may have expired, so try signing in again.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export default function AnalysisPage() {
  const [userEmail, setUserEmail] = useState(null);
  const [sampleText, setSampleText] = useState("");
  const [writerAge, setWriterAge] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [fromScreener, setFromScreener] = useState(false);
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  // RLS scopes this to the signed-in therapist, so no therapist_id filter is
  // needed from the browser. Same read as the screener's picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("students")
        .select("id, display_name, birth_year")
        .order("display_name", { ascending: true });
      if (!cancelled) setStudents(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Picks up a sample handed over by the screener. Runs in an effect because
   * sessionStorage does not exist during server rendering, and reads once on
   * mount because the handoff is consumed and erased on read.
   *
   * The text is filled in but deliberately not analysed automatically: it came
   * from a vision transcription, and every error category below is computed by
   * comparing the writing to its intended spelling. A misread letter would show
   * up as the student's error. The educator checks it first.
   */
  useEffect(() => {
    const handoff = takeHandoff();
    if (!handoff) return;
    setSampleText(handoff.text);
    if (handoff.writerAge !== null) setWriterAge(String(handoff.writerAge));
    if (handoff.studentId) setStudentId(handoff.studentId);
    setFromScreener(true);
  }, []);

  /**
   * Fills the age from the chosen student's year of birth, but only into an
   * empty field. The screener overwrites unconditionally because nothing
   * upstream of it can have set the value; here a handoff may have carried an
   * age the educator typed by hand, and recomputing from birth year would throw
   * that correction away.
   */
  useEffect(() => {
    if (writerAge !== "") return;
    const student = students.find((s) => s.id === studentId);
    if (!student?.birth_year) return;
    const age = new Date().getFullYear() - Number(student.birth_year);
    if (age >= 0) setWriterAge(String(age));
  }, [studentId, students, writerAge]);

  const trimmed = sampleText.trim();
  const parsedAge = writerAge === "" ? null : Number(writerAge);

  const analyze = async () => {
    if (trimmed.length < 20) {
      setError("Paste at least 20 characters of the student's writing.");
      return;
    }
    if (!studentId) {
      setError("Choose which student wrote this before analysing.");
      return;
    }
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const res = await fetch("/api/analyze-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sampleText,
          writerAge: parsedAge,
          student_id: studentId,
        })
      });

      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data?.error || `Analysis failed (${res.status}).`);
      }
      if (!data) throw new Error("The server returned an unreadable response.");
      setAnalysis(data.analysis);
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setSampleText("");
    setAnalysis(null);
    setError(null);
    setFromScreener(false);
  };

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-main">
          <h1>Error Pattern Analyser</h1>
          <span className="tagline">
            Breaks spelling errors into phonological, orthographic,
            morphological and visual patterns
          </span>
        </div>
        <div className="user-bar">
          <Link className="nav-link" href="/">
            Screener
          </Link>
          {userEmail && (
            <>
              <Link className="nav-link" href="/dashboard">
                Dashboard
              </Link>
              <span className="user-email">{userEmail}</span>
              <form action={signout}>
                <button type="submit" className="btn btn-ghost">
                  Sign out
                </button>
              </form>
            </>
          )}
        </div>
      </header>

      <div className="disclaimer-band" role="note">
        <strong>This describes error patterns, not a diagnosis.</strong> The
        profile below summarises what a sample&apos;s spelling errors are made
        of, to help target teaching. It is not an assessment of the writer.
      </div>

      <div className="columns">
        <section className="upload-card" aria-label="Add a writing sample">
          <h2>1. Paste the writing</h2>

          {/* The handed-over text is a machine transcription of handwriting, so
              it is presented as something to check rather than something that
              is already correct. */}
          {fromScreener && (
            <div className="handoff-note" role="status">
              Filled in from the screening you just ran.{" "}
              <strong>Check it against the original</strong> — this was read off
              the handwriting automatically, and any letter it misread will be
              counted as the student&apos;s error.
            </div>
          )}

          <label className="auth-label" htmlFor="sample-text">
            Type or paste the student&apos;s writing
          </label>
          <textarea
            id="sample-text"
            className="sample-textarea"
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            placeholder="Copy the writing exactly as the student wrote it, including the spelling mistakes."
            rows={12}
          />
          <p className="auth-hint">
            {trimmed
              ? `${trimmed.split(/\s+/).length} words`
              : "50 words or more gives a more stable pattern."}
          </p>

          <label className="auth-label" htmlFor="student">
            Student
          </label>
          <select
            id="student"
            className="auth-input"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            required
          >
            <option value="">Choose a student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
          <p className="auth-hint">
            {students.length === 0 ? (
              <>
                No students yet — <Link href="/students">add one first</Link>.
              </>
            ) : (
              "This sample joins that student's error trend."
            )}
          </p>

          <label className="auth-label" htmlFor="writer-age">
            Writer&apos;s age (optional)
          </label>
          <input
            id="writer-age"
            className="auth-input age-input"
            type="number"
            min="3"
            max="99"
            value={writerAge}
            onChange={(e) => setWriterAge(e.target.value)}
            placeholder="e.g. 9"
          />
          <p className="auth-hint">
            Used only to judge whether reversals are developmentally expected.
          </p>

          <div className="actions">
            <button
              className="btn btn-primary"
              onClick={analyze}
              disabled={loading || trimmed.length < 20 || !studentId}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Analysing…
                </>
              ) : (
                "Analyse errors"
              )}
            </button>
            {sampleText && (
              <button className="btn btn-ghost" onClick={reset}>
                Clear
              </button>
            )}
          </div>

          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
        </section>

        <section
          className="sheet"
          aria-label="Error pattern report"
          aria-live="polite"
        >
          {!analysis && !loading && (
            <p className="empty-state">
              The report will appear here. Every misspelling is matched to its
              intended word, sounded out, and sorted into a category, then the
              categories are weighed into an overall error profile.
            </p>
          )}

          {loading && (
            <p className="empty-state">
              Reading the sample… the grammar model can take a moment on its
              first run.
            </p>
          )}

          {analysis && (
            <>
              <h2>Error pattern report</h2>
              <ErrorAnalysis analysis={analysis} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
