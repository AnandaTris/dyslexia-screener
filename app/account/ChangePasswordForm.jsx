"use client";

import { useState } from "react";
import { changePassword } from "./actions";

export default function ChangePasswordForm() {
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  async function onSubmit(formData) {
    setError(null);
    setOk(null);
    const result = await changePassword(formData);
    if (result?.error) setError(result.error);
    else setOk(result.ok);
  }

  return (
    <form action={onSubmit} className="student-form">
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

      <label className="auth-label" htmlFor="password">
        New password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        className="auth-input"
        autoComplete="new-password"
        required
      />

      <label className="auth-label" htmlFor="confirm">
        Type it again
      </label>
      <input
        id="confirm"
        name="confirm"
        type="password"
        className="auth-input"
        autoComplete="new-password"
        required
      />
      <p className="auth-hint">At least 6 characters.</p>

      <div className="actions">
        <button type="submit" className="btn btn-primary">
          Change password
        </button>
      </div>
    </form>
  );
}
