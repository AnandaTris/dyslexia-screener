import { login, signup } from "./actions";

export const metadata = {
  title: "Sign in — Writing Sample Screener",
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const error = params?.error;
  const message = params?.message;

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Writing Sample Screener</h1>
        <span className="tagline">Sign in to screen and save samples</span>
      </header>

      <section className="upload-card auth-card" aria-label="Sign in">
        <h2>Sign in or create an account</h2>

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

        <form className="auth-form">
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

          <label className="auth-label" htmlFor="password">
            Password
          </label>
          <input
            className="auth-input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={6}
            required
          />

          <div className="actions">
            <button className="btn btn-primary" formAction={login}>
              Sign in
            </button>
            <button className="btn btn-ghost" formAction={signup}>
              Create account
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
