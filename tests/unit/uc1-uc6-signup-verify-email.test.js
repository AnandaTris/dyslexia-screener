/**
 * UC1 + UC6 — Sign Up + Verify Email (unit)
 *
 * One test per row of the test plan:
 *
 *  | Path  | Input                             | Expected output             |
 *  |-------|-----------------------------------|-----------------------------|
 *  | Happy | Valid email, password, mobile no. | Account created             |
 *  | Error | Invalid email, password, mobile   | Account cannot be created   |
 *  | Happy | Valid email                       | Verification result = true  |
 *  | Error | Invalid email                     | Verification result = false |
 *
 * Unit under test: the `signup` server action in app/login/actions.js, with
 * AuthService (Supabase Auth) mocked per the plan's Mock column.
 *
 * Three things this suite does NOT cover, recorded so they are not mistaken for
 * passing:
 *
 *  1. MOBILE NUMBER is not part of sign-up. The form collects email and password
 *     only, and the action never reads a `mobile` field. The happy path submits
 *     one and asserts what the code does with it today: ignores it.
 *
 *  2. The row-2 Mock column names two errors — "email already exists" and "email
 *     is invalid". Only the invalid-address path is tested here, because the plan
 *     allots one row to it. The already-exists path is the one that silently
 *     re-sends confirmation mail and burns the Supabase email quota.
 *
 *  3. VERIFICATION is Supabase-hosted — there is no EmailVerificationService in
 *     this repo. The UC6 rows test the app's half: signing the user straight in
 *     when no confirmation is required, or telling them to confirm first.
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

const { signup } = await import("../../app/login/actions.js");

/** AuthService double: one mocked `signUp`, per the plan's Mock column. */
function mockAuthService(signUpResult) {
  const signUp = vi.fn().mockResolvedValue(signUpResult);
  mocks.client.value = { auth: { signUp } };
  return signUp;
}

beforeEach(() => {
  mocks.client.value = null;
});

describe("UC1 — Sign Up", () => {
  it("happy: valid email, password and mobile number create an account", async () => {
    // Mock: verifyEmail() = true, user details saved, account successfully created.
    const signUp = mockAuthService({
      data: {
        user: { id: "user-1", email: "teacher@school.edu", identities: [{ id: "i1" }] },
        session: null,
      },
      error: null,
    });

    const redirected = await captureRedirect(() =>
      signup(
        formDataOf({
          email: "teacher@school.edu",
          password: "correct-horse",
          // Not read by the action — see note (1) in the header.
          mobile: "+6591234567",
        }),
      ),
    );

    expect(signUp).toHaveBeenCalledWith({
      email: "teacher@school.edu",
      password: "correct-horse",
    });

    // Account created: the user is sent to sign in and told to confirm.
    expect(redirected.pathname).toBe("/login");
    expect(redirected.params.message).toMatch(/Account created/i);
    expect(redirected.params.error).toBeUndefined();
  });

  it("error: an invalid email means the account cannot be created", async () => {
    // Mock: verifyEmail() = false, account cannot be created, show the error.
    mockAuthService({
      data: { user: null, session: null },
      error: AUTH_ERRORS.invalidEmail,
    });

    const redirected = await captureRedirect(() =>
      signup(formDataOf({ email: "not-an-email", password: "correct-horse" })),
    );

    // Back to the form being filled in, with the reason attached.
    expect(redirected.pathname).toBe("/signup");
    expect(redirected.params.error).toBe(AUTH_ERRORS.invalidEmail.message);
  });
});

describe("UC6 — Verify Email", () => {
  it("happy: verification result = true, so the new user is signed straight in", async () => {
    // EmailVerificationService receives positive verification: sign-up returns a
    // session, meaning the address needed no further confirmation.
    mockAuthService({
      data: {
        user: { id: "user-1", email: "teacher@school.edu", identities: [{ id: "i1" }] },
        session: { access_token: "token" },
      },
      error: null,
    });

    const redirected = await captureRedirect(() =>
      signup(formDataOf({ email: "teacher@school.edu", password: "correct-horse" })),
    );

    expect(redirected.pathname).toBe("/");
    expect(redirected.params.message).toBeUndefined();
  });

  it("error: verification result = false, so the user must confirm before signing in", async () => {
    // EmailVerificationService receives negative verification: no session, and
    // the potential error is shown to the user.
    mockAuthService({
      data: {
        user: { id: "user-1", email: "teacher@school.edu", identities: [{ id: "i1" }] },
        session: null,
      },
      error: null,
    });

    const redirected = await captureRedirect(() =>
      signup(formDataOf({ email: "teacher@school.edu", password: "correct-horse" })),
    );

    expect(redirected.pathname).toBe("/login");
    expect(redirected.params.message).toMatch(/Check your inbox/i);
  });
});
