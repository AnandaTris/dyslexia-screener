import Link from "next/link";
import PasswordField from "../components/PasswordField";
import { signup } from "../login/actions";

export const metadata = {
  title: "Create an account — Writing Sample Screener",
};

export default async function SignupPage({ searchParams }) {
  const params = await searchParams;
  const error = params?.error;
  const message = params?.message;

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-heading">
        <div className="auth-brand">
          <h1 id="auth-heading">Create an account</h1>
          <p className="auth-subtitle">
            Screening results are saved to your account and visible only to you.
          </p>
        </div>

        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="info-box" role="status">
            {message}
          </div>
        )}

        <form className="auth-form" action={signup}>
          <label className="auth-label" htmlFor="email">
            Email
          </label>
          <input
            className="auth-input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />

          <PasswordField
            autoComplete="new-password"
            hint="At least 6 characters."
          />

          <button className="btn btn-primary btn-block" type="submit">
            Create account
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
