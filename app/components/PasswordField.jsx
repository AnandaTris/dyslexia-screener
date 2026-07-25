"use client";

import { useId, useState } from "react";

/**
 * Password input with a show/hide toggle.
 *
 * The toggle is a real button rather than a checkbox so it can be reached by
 * keyboard in the tab order, and it carries type="button" so pressing Enter in
 * the password field submits the form instead of flipping visibility.
 */
export default function PasswordField({
  name = "password",
  label = "Password",
  autoComplete = "current-password",
  minLength = 6,
  hint = null,
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <>
      <label className="auth-label" htmlFor={id}>
        {label}
      </label>
      <div className="password-wrap">
        <input
          className="auth-input password-input"
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((shown) => !shown)}
          aria-pressed={visible}
          aria-controls={id}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint && <p className="auth-hint">{hint}</p>}
    </>
  );
}
