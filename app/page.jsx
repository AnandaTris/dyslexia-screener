"use client";

import { useCallback, useRef, useState } from "react";

export default function Home() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

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
          mediaType: file.type
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

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Writing Sample Screener</h1>
        <span className="tagline">
          Flags written-output patterns associated with dyslexia
        </span>
      </header>

      <div className="disclaimer-band" role="note">
        <strong>This is a screening aid, not a diagnosis.</strong> Dyslexia can
        only be identified through a full psychoeducational assessment by a
        qualified psychologist. Results here indicate whether a formal
        assessment may be worth pursuing.
      </div>

      <div className="columns">
        <section className="upload-card" aria-label="Upload writing sample">
          <h2>1. Upload a writing sample</h2>
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

          <div className="actions">
            <button
              className="btn btn-primary"
              onClick={analyze}
              disabled={!file || loading}
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
              Results will appear here after analysis. The screener looks for
              letter reversals, transpositions, phonetic spelling, omissions,
              inconsistent spacing and sizing, and homophone confusion.
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
