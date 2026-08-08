"use client";

import { useState } from "react";
import { createStudentLogin, resetStudentPassword } from "./actions";
import { INITIAL_PASSWORD } from "../../lib/studentAuth";

// Neither action redirects, so both a success and a failure come back as a
// value — unlike AddStudentForm, where anything returned is a failure.
export default function StudentLoginPanel({ studentId, studentName, loginEmail }) {
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (action, formData) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const result = await action(formData);
      if (result?.error) setError(result.error);
      else if (result?.ok) setOk(result.ok);
    } finally {
      setBusy(false);
    }
  };

  const messages = (
    <>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {ok && (
        <div className="info-box" role="status">
          {ok}
        </div>
      )}
    </>
  );

  if (loginEmail) {
    return (
      <form action={(formData) => run(resetStudentPassword, formData)} className="student-form">
        {messages}
        <input type="hidden" name="student_id" value={studentId} />
        <p>
          {studentName} signs in as <strong>{loginEmail}</strong>.
        </p>
        <p className="auth-hint">
          They see only their learning journey — never the screener, the error
          analysis or any other student.
        </p>
        <div className="actions">
          <button type="submit" className="btn btn-ghost" disabled={busy}>
            {busy ? "Resetting…" : `Reset password to ${INITIAL_PASSWORD}`}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={(formData) => run(createStudentLogin, formData)} className="student-form">
      {messages}
      <input type="hidden" name="student_id" value={studentId} />

      <label className="auth-label" htmlFor="login_email">
        Their email address
      </label>
      <input
        id="login_email"
        name="email"
        type="email"
        className="auth-input"
        autoComplete="off"
        required
      />
      <p className="auth-hint">
        No email is sent. The account is created straight away with the password{" "}
        <strong>{INITIAL_PASSWORD}</strong> — write it down and pass it on. They can
        change it once they are signed in.
      </p>

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Give this student a login"}
        </button>
      </div>
    </form>
  );
}
