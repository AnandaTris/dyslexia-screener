"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { stashHandoff } from "../lib/screening/handoff";
import { getScreeningOutcomeView } from "../lib/screening/presentation";
import { createClient } from "../lib/supabase/client";
import { signout } from "./login/actions";

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

/**
 * fetch() rejects with a bare TypeError whenever no HTTP response arrives at
 * all: "Load failed" in Safari, "Failed to fetch" in Chrome. Neither tells the
 * user anything. The usual cause here is middleware answering 401 while the
 * image is still uploading, which drops the connection and takes the real
 * message ("Your session expired") down with it.
 */
function describeFailure(err) {
  if (err instanceof TypeError) {
    return "Couldn't reach the server. Your session may have expired, so try signing in again.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export default function Home() {
  const [userEmail, setUserEmail] = useState(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [writerAge, setWriterAge] = useState("");
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState("");

  // RLS scopes this to the signed-in therapist, so no therapist_id filter is
  // needed from the browser.
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

  // Prefill the age from the student's year of birth. The field stays editable
  // — a typed value still wins on the server — but this stops the reversal
  // guard depending on someone remembering to fill it in.
  useEffect(() => {
    const student = students.find((s) => s.id === studentId);
    if (!student?.birth_year) return;
    const age = new Date().getFullYear() - Number(student.birth_year);
    if (age >= 0) setWriterAge(String(age));
  }, [studentId, students]);
  const inputRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  const acceptFile = useCallback((f) => {
    if (!f.type.startsWith("image/") && f.type !== "application/pdf") {
      setError("Please upload a photo (JPEG, PNG, WebP, GIF) or a PDF.");
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setError("File is larger than 8 MB. Please use a smaller photo or PDF.");
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
    // Each createObjectURL pins its blob in memory until revoked, so drop the
    // previous preview before replacing it.
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) acceptFile(dropped);
    },
    [acceptFile]
  );

  const parsedAge = writerAge === "" ? null : Number(writerAge);
  const isPdf = file?.type === "application/pdf";
  const outcomeView = result?.isWritingSample
    ? getScreeningOutcomeView(result)
    : null;

  const analyze = async () => {
    if (!file) return;
    // Checked here as well as server-side so the therapist finds out before the
    // upload goes over the wire, not after.
    if (!studentId) {
      setError("Pick a student before screening.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Multipart with the raw File, not base64 inside JSON. Base64 inflates
      // the body by a third and forces the whole encoded copy into memory
      // before a single byte goes out; the browser streams this instead.
      const form = new FormData();
      form.append("file", file);
      form.append("student_id", studentId);
      if (parsedAge !== null) form.append("writerAge", String(parsedAge));

      const res = await fetch("/api/analyze", { method: "POST", body: form });

      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data?.error || `Analysis failed (${res.status}).`);
      }
      if (!data) throw new Error("The server returned an unreadable response.");
      setResult(data);
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Hands the transcription to the analyser and navigates there. The stash is
   * best-effort: if sessionStorage refused it we still go, because the analyser
   * with an empty box is a worse experience but not a broken one.
   */
  const identifyPattern = () => {
    stashHandoff({ text: result?.transcription, writerAge: parsedAge });
    router.push("/analysis");
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-main">
          <h1>Writing Sample Screener</h1>
          <span className="tagline">
            Flags written-output patterns associated with dyslexia
          </span>
        </div>
        <div className="user-bar">
          <Link className="nav-link" href="/analysis">
            Error pattern analyser
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
        <strong>This is a screening aid, not a diagnosis.</strong> Dyslexia can
        only be identified through a full psychoeducational assessment by a
        qualified psychologist. Results here indicate whether a formal
        assessment may be worth pursuing.
      </div>

      <div className="columns">
        <section className="upload-card" aria-label="Upload a writing sample">
          <h2>1. Upload the handwriting</h2>

          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {file ? (
              <span>{file.name}</span>
            ) : (
              <span>
                Drag a photo or PDF here, or click to browse.
                <br />
                Clear scans of a full paragraph work best.
              </span>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) acceptFile(f);
            }}
          />

          {/* <img> cannot render a PDF, so PDFs get the browser's own viewer
              via <object>. The fallback inside it shows when a browser has no
              built-in viewer. */}
          {previewUrl && (
            <div className="preview">
              {isPdf ? (
                <object
                  data={previewUrl}
                  type="application/pdf"
                  aria-label={`Preview of ${file?.name ?? "the uploaded PDF"}`}
                >
                  <p className="preview-fallback">
                    {file?.name} — your browser can&apos;t preview PDFs, but the
                    file will still be analysed.
                  </p>
                </object>
              ) : (
                <img src={previewUrl} alt="Preview of uploaded writing sample" />
              )}
            </div>
          )}

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
              "The result is filed against this student's record."
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
              disabled={loading || !file || !studentId}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Analysing…
                </>
              ) : (
                "Screen this sample"
              )}
            </button>
            {file && (
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
          aria-label="Screening results"
          aria-live="polite"
        >
          {!result && !loading && (
            <p className="empty-state">
              Results will appear here. The sample is read for letter reversals,
              transpositions, phonetic spelling, omissions, spacing and sizing,
              then scored for whether a formal assessment is worth pursuing.
            </p>
          )}

          {loading && <p className="empty-state">Reading the sample…</p>}

          {result && !result.isWritingSample && (
            <>
              <h2>Not a writing sample</h2>
              <p className="summary">{result.summary}</p>
            </>
          )}

          {result && result.isWritingSample && (
            <>
              <h2>Screening report</h2>

              <div
                className={`verdict-banner ${outcomeView.className}`}
              >
                <div className="verdict-word">
                  {outcomeView.heading}
                </div>
                <div className="gauge" aria-hidden="true">
                  <div
                    className="gauge-fill"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, result.likelihoodScore)
                      )}%`
                    }}
                  />
                </div>
                <div className="gauge-label">
                  Evidence strength: {result.likelihoodScore}/100
                </div>
                {/* Only set when the rule overrode a score that would
                    otherwise have read "likely". Without it the banner and
                    the gauge look like they contradict each other. */}
                {result.verdictHeldReason && (
                  <p className="verdict-held">{result.verdictHeldReason}</p>
                )}
                <p className="verdict-reasoning">{result.verdictReasoning}</p>

                {/* Concrete indicators are useful to inspect even when one
                    sample does not cross the assessment threshold. */}
                {outcomeView.showPatternAnalysis && (
                  <div className="verdict-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={identifyPattern}
                    >
                      Identify the error pattern →
                    </button>
                    <p className="auth-hint">
                      Opens the analyser with this transcription filled in, so
                      you can check it against the original before analysing.
                    </p>
                  </div>
                )}
              </div>

              <p className="summary">{result.summary}</p>

              <h3 className="section-label">
                Indicators found ({result.indicators.length})
              </h3>
              {result.indicators.length === 0 && (
                <p className="empty-state">
                  No clear dyslexia-associated indicators were observed in this
                  sample.
                </p>
              )}
              {result.indicators.map((ind, i) => (
                <div key={i} className={`indicator ${ind.strength}`}>
                  <div className="ind-head">
                    <span className="ind-name">{ind.name}</span>
                    <span className={`ind-strength ${ind.strength}`}>
                      {ind.strength}
                    </span>
                  </div>
                  <p className="ind-evidence">{ind.evidence}</p>
                </div>
              ))}

              {result.importantCaveats?.length > 0 && (
                <>
                  <h3 className="section-label">Caveats for this sample</h3>
                  <ul className="caveats">
                    {result.importantCaveats.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              )}

              {result.transcription && (
                <>
                  <h3 className="section-label">Transcription</h3>
                  <p className="transcription">{result.transcription}</p>
                  <p className="auth-hint">
                    To break these spellings down into phonological,
                    orthographic, morphological and visual error patterns, paste
                    this into the{" "}
                    <Link className="nav-link" href="/analysis">
                      error pattern analyser
                    </Link>
                    .
                  </p>
                </>
              )}

              <div className="next-steps">
                <strong>Next steps:</strong> if multiple indicators appear
                across several writing samples, consider a formal assessment
                through an educational psychologist or a specialist
                organisation such as the Dyslexia Association of Singapore. One
                sample is never enough to draw conclusions.
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
