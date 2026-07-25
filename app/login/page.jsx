import Link from "next/link";
import PasswordField from "../components/PasswordField";
import { login } from "./actions";

export const metadata = {
  title: "Sign in — Writing Sample Screener",
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const error = params?.error;
  const message = params?.message;

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-heading">
        <div className="auth-brand">
          <h1 id="auth-heading">Writing Sample Screener</h1>
          <p className="auth-subtitle">Sign in to screen and save writing samples.</p>
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

        <form className="auth-form" action={login}>
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

          <PasswordField autoComplete="current-password" />

          <button className="btn btn-primary btn-block" type="submit">
            Sign in
          </button>
        </form>

        <p className="auth-switch">
          Don&apos;t have an account? <Link href="/signup">Create one</Link>
        </p>
      </section>
    </main>
  );
}
