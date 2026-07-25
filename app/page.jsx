"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import ErrorAnalysis from "./components/ErrorAnalysis";
import { signout } from "./login/actions";

export default function Home() {
  const [userEmail, setUserEmail] = useState(null);
  const [mode, setMode] = useState("image");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [sampleText, setSampleText] = useState("");
  const [writerAge, setWriterAge] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  const acceptFile = useCallback((f) => {
    if (!f.type.startsWith("image/")) {
      setError("Please upload an image file (JPEG, PNG, WebP, or GIF).");
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setError("Image is larger than 8 MB. Please use a smaller image.");
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
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

  const analyze = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read the image."));
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mediaType: file.type,
          writerAge: parsedAge
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Analysis failed.");
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const analyzeText = async () => {
    if (sampleText.trim().length < 20) {
      setError("Paste at least 20 characters of the student's writing.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/analyze-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sampleText, writerAge: parsedAge })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Analysis failed.");
      }
      setResult({ isWritingSample: true, textOnly: true, ...data });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setSampleText("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const switchMode = (next) => {
    setMode(next);
    setResult(null);
    setError(null);
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
        {userEmail && (
          <div className="user-bar">
            <span className="user-email">{userEmail}</span>
            <form action={signout}>
              <button type="submit" className="btn btn-ghost">
                Sign out
              </button>
            </form>
          </div>
        )}
      </header>

      <div className="disclaimer-band" role="note">
        <strong>This is a screening aid, not a diagnosis.</strong> Dyslexia can
        only be identified through a full psychoeducational assessment by a
        qualified psychologist. Results here indicate whether a formal
        assessment may be worth pursuing.
      </div>

      <div className="columns">
        <section className="upload-card" aria-label="Add a writing sample">
          <h2>1. Add a writing sample</h2>

          <div className="mode-tabs" role="tablist" aria-label="Input method">
            <button
              role="tab"
              aria-selected={mode === "image"}
              className={`mode-tab ${mode === "image" ? "active" : ""}`}
              onClick={() => switchMode("image")}
            >
              Photo of writing
            </button>
            <button
              role="tab"
              aria-selected={mode === "text"}
              className={`mode-tab ${mode === "text" ? "active" : ""}`}
              onClick={() => switchMode("text")}
            >
              Typed text
            </button>
          </div>

          {mode === "image" ? (
            <>
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
                    Drag an image here or click to browse.
                    <br />
                    Clear photos of a full paragraph work best.
                  </span>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) acceptFile(f);
                }}
              />

              {previewUrl && (
                <div className="preview">
                  <img src={previewUrl} alt="Preview of uploaded writing sample" />
                </div>
              )}
            </>
          ) : (
            <>
              <label className="auth-label" htmlFor="sample-text">
                Type or paste the student&apos;s writing
              </label>
              <textarea
                id="sample-text"
                className="sample-textarea"
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                placeholder="Copy the writing exactly as the student wrote it, including the spelling mistakes."
                rows={10}
              />
              <p className="auth-hint">
                {sampleText.trim() ? `${sampleText.trim().split(/\s+/).length} words` : "50 words or more gives a more stable pattern."}
              </p>
            </>
          )}

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
              onClick={mode === "image" ? analyze : analyzeText}
              disabled={loading || (mode === "image" ? !file : sampleText.trim().length < 20)}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Analysing…
                </>
              ) : (
                "Analyse sample"
              )}
            </button>
            {(file || sampleText) && (
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
              Results will appear here after analysis. A photo is screened for
              letter reversals, transpositions, phonetic spelling, omissions,
              spacing and sizing, then the writing is broken down into
              phonological, orthographic, morphological and visual error
              patterns. Typed text goes straight to the error analysis.
            </p>
          )}

          {loading && <p className="empty-state">Reading the sample…</p>}

          {result && result.textOnly && (
            <>
              <h2>Error pattern report</h2>
              <ErrorAnalysis analysis={result.analysis} />
            </>
          )}

          {result && !result.textOnly && !result.isWritingSample && (
            <>
              <h2>Not a writing sample</h2>
              <p className="summary">{result.summary}</p>
            </>
          )}

          {result && !result.textOnly && result.isWritingSample && (
            <>
              <h2>Screening report</h2>

              <div
                className={`verdict-banner ${
                  result.verdict === "likely" ? "v-likely" : "v-unlikely"
                }`}
              >
                <div className="verdict-word">
                  {result.verdict === "likely"
                    ? "Likely shows dyslexia indicators"
                    : "Unlikely to show dyslexia indicators"}
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
                <p className="verdict-reasoning">{result.verdictReasoning}</p>
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
                </>
              )}

              {result.errorAnalysis && <ErrorAnalysis analysis={result.errorAnalysis} />}

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
