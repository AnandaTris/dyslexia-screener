"use client";

import { useState } from "react";
import { createStudent } from "./actions";

export default function AddStudentForm() {
  const [error, setError] = useState(null);

  // The action redirects on success, so anything that comes back is a failure.
  async function onSubmit(formData) {
    const result = await createStudent(formData);
    if (result?.error) setError(result.error);
  }

  return (
    <form action={onSubmit} className="student-form">
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <label className="auth-label" htmlFor="display_name">
        Student name
      </label>
      <input
        id="display_name"
        name="display_name"
        className="auth-input"
        autoComplete="off"
        required
      />

      <label className="auth-label" htmlFor="birth_year">
        Year of birth (optional)
      </label>
      <input
        id="birth_year"
        name="birth_year"
        className="auth-input"
        inputMode="numeric"
        placeholder="e.g. 2017"
        autoComplete="off"
      />
      <p className="auth-hint">
        Used only to judge whether letter reversals are expected at their age, and to
        prefill the screener.
      </p>

      <div className="actions">
        <button type="submit" className="btn btn-primary">
          Add student
        </button>
      </div>
    </form>
  );
}
