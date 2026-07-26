/**
 * UC2 + UC7 — Login + User Authentication (unit)
 *
 * One test per row of the test plan:
 *
 *  | Path  | Input                                    | Expected output    |
 *  |-------|------------------------------------------|--------------------|
 *  | Happy | Valid email and password                 | Logs in to account |
 *  | Error | Invalid email or password / empty input  | Unable to login    |
 *
 * Unit under test: the `login` server action in app/login/actions.js, with
 * AuthService mocked to return `authenticate(email, password) = true | false`.
 *
 * The error row names two inputs — bad credentials and empty input. This suite
 * covers the empty-input case, because it is the weaker of the two: the action
 * does no validation of its own and forwards blank credentials straight to
 * Supabase. The form's `required` attribute is the only guard and it is
 * client-side only, so a direct POST bypasses it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureRedirect, formDataOf } from "../support/redirect.js";
import { AUTH_ERRORS } from "../support/supabase.js";

const mocks = vi.hoisted(() => ({ client: { value: null } }));

vi.mock("next/navigation", async () => {
  const { redirect } = await import("../support/redirect.js");
  return { redirect };
});

vi.mock("../../lib/supabase/server.js", () => ({
  createClient: async () => mocks.client.value,
}));

const { login } = await import("../../app/login/actions.js");

/**
 * AuthService double. `authenticate` stands in for Supabase's
 * `signInWithPassword`: true issues a session, false returns the terse
 * `invalid_credentials` error.
 */
function mockAuthService({ authenticate }) {
  const signInWithPassword = vi.fn().mockResolvedValue(
    authenticate
      ? {
          data: {
            user: { id: "user-1", email: "teacher@school.edu" },
            session: { access_token: "token" },
          },
          error: null,
        }
      : { data: { user: null, session: null }, error: AUTH_ERRORS.invalidCredentials },
  );

  mocks.client.value = { auth: { signInWithPassword } };
  return signInWithPassword;
}

beforeEach(() => {
  mocks.client.value = null;
});

describe("UC2 + UC7 — Login", () => {
  it("happy: a valid email and password log the user in to their account", async () => {
    // Mock: authenticate(email, password) = true, user logs in to account.
    const signInWithPassword = mockAuthService({ authenticate: true });

    const redirected = await captureRedirect(() =>
      login(formDataOf({ email: "teacher@school.edu", password: "correct-horse" })),
    );

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "teacher@school.edu",
      password: "correct-horse",
    });

    // Logged in: dropped on the screener, with no error in the URL.
    expect(redirected.pathname).toBe("/");
    expect(redirected.params.error).toBeUndefined();
  });

  it("error: empty input leaves the user unable to log in, and asks for valid input", async () => {
    // Mock: authenticate(email, password) = false, request for valid input.
    const signInWithPassword = mockAuthService({ authenticate: false });

    const redirected = await captureRedirect(() => login(formDataOf({ email: "", password: "" })));

    // Documenting current behaviour: the blank values are forwarded as-is.
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "", password: "" });

    expect(redirected.pathname).toBe("/login");
    // The raw Supabase message is replaced with one that says what to do next.
    expect(redirected.params.error).toMatch(/don't match an account/i);
  });
});
