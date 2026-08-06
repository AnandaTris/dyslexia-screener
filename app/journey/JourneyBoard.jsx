"use client";

import { useState } from "react";
import { progressFor } from "../../lib/journey";

const NEXT_STATUS = { not_started: "done", in_progress: "done", done: "not_started" };

export default function JourneyBoard({ initialJourney, studentId, studentName }) {
  const [journey, setJourney] = useState(initialJourney);
  const [building, setBuilding] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [busyStep, setBusyStep] = useState(null);

  const progress = progressFor(journey?.steps);

  const build = async () => {
    setBuilding(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/journey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not build a journey.");
        return;
      }
      if (!data.journey) {
        setNote(data.note);
        return;
      }
      setJourney(data.journey);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBuilding(false);
    }
  };

  const toggleStep = async (step) => {
    const status = NEXT_STATUS[step.status] ?? "done";
    setBusyStep(step.id);
    setError(null);

    // Optimistic: the checkbox should not lag behind the click. Rolled back
    // below if the write is rejected.
    const previous = journey.steps;
    setJourney((j) => ({
      ...j,
      steps: j.steps.map((s) => (s.id === step.id ? { ...s, status } : s)),
    }));

    try {
      const res = await fetch("/api/journey/step", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: step.id, status }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Could not update that step.");
        setJourney((j) => ({ ...j, steps: previous }));
      }
    } catch {
      setError("Could not reach the server.");
      setJourney((j) => ({ ...j, steps: previous }));
    } finally {
      setBusyStep(null);
    }
  };

  if (!journey) {
    return (
      <div>
        <p className="empty-state">
          {studentName} doesn&apos;t have a journey yet. Building one uses their
          screening profile to pick steps from the uploaded resources — every step
          cites where it came from.
        </p>
        {note && <div className="info-box">{note}</div>}
        {error && (
          <div className="chat-offline" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary" onClick={build} disabled={building}>
          {building ? "Building…" : "Build my journey"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="progress-row">
        <div
          className="progress-bar"
          role="img"
          aria-label={`${progress.percent}% complete`}
        >
          <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
        </div>
        <span className="progress-label">
          {progress.done} of {progress.total} done · {progress.percent}%
        </span>
      </div>

      {error && (
        <div className="chat-offline" role="alert">
          {error}
        </div>
      )}

      <ol className="journey-steps">
        {journey.steps.map((step) => (
          <li key={step.id} className={`journey-step ${step.status}`}>
            <label className="step-head">
              <input
                type="checkbox"
                checked={step.status === "done"}
                disabled={busyStep === step.id}
                onChange={() => toggleStep(step)}
              />
              <span className="step-title">{step.title}</span>
            </label>
            <p className="step-description">{step.description}</p>
            {step.citations?.length > 0 && (
              <div className="chat-citations">
                Sources: {step.citations.map((c) => c.title || c.id).join(", ")}
              </div>
            )}
          </li>
        ))}
      </ol>

      <button className="btn btn-ghost" onClick={build} disabled={building}>
        {building ? "Rebuilding…" : "Rebuild from the latest profile"}
      </button>
      <p className="auth-hint">
        Rebuilding archives this journey and starts a fresh one. The old progress is
        kept, not deleted, and no other student is affected.
      </p>
    </div>
  );
}
