/**
 * Planned Unit Test — Supabase auth server actions.
 *
 * From the test plan: "Supabase auth server actions (login, signup, signout):
 * valid credentials succeed and return a session; invalid credentials are
 * rejected; signup enforces required fields. The Supabase client is mocked."
 *
 * The mocked client is the in-memory double in tests/support/supabase.js. Every
 * one of these actions ends in a redirect — the real `redirect()` throws — so
 * the assertion is on where the user was sent and what the client was asked to
 * do on the way.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureRedirect, formDataOf } from "../../tests/support/redirect.js";
import { createFakeSupabase, createUserRepository } from "../../tests/support/supabase.js";

const mocks = vi.hoisted(() => ({ client: { value: null } }));

vi.mock("next/navigation", async () => {
  const { redirect } = await import("../../tests/support/redirect.js");
  return { redirect };
});

vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => mocks.client.value,
}));

const { login, signout, signup } = await import("./actions.js");

const REGISTERED = { email: "teacher@school.edu", password: "correct-horse", emailConfirmed: true };

let userRepository;
let sessions;

beforeEach(() => {
  userRepository = createUserRepository([REGISTERED]);
  const client = createFakeSupabase({ userRepository });

  // Record what the auth service handed back, so "returns a session" can be
  // asserted and not merely inferred from the redirect.
  sessions = [];
  const signIn = client.auth.signInWithPassword.bind(client.auth);
  client.auth.signInWithPassword = async (credentials) => {
    const result = await signIn(credentials);
    sessions.push(result.data.session);
    return result;
  };

  mocks.client.value = client;
});

describe("login", () => {
  it("valid credentials succeed and return a session", async () => {
    const { pathname } = await captureRedirect(() =>
      login(formDataOf({ email: REGISTERED.email, password: REGISTERED.password })),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ user: { email: REGISTERED.email } });
    expect(sessions[0].access_token).toBeTruthy();
    expect(pathname).toBe("/");
  });

  it("rejects invalid credentials with no session", async () => {
    const { pathname, params } = await captureRedirect(() =>
      login(formDataOf({ email: REGISTERED.email, password: "wrong" })),
    );

    expect(sessions).toEqual([null]);
    // Back to the form the user was filling in, with something actionable.
    expect(pathname).toBe("/login");
    expect(params.error).toMatch(/don't match an account/i);
  });
});

describe("signup", () => {
  it("enforces required fields", async () => {
    const invalidEmail = await captureRedirect(() =>
      signup(formDataOf({ email: "not-an-email", password: "long-enough" })),
    );
    expect(invalidEmail.pathname).toBe("/signup");
    expect(invalidEmail.params.error).toBeTruthy();

    const weakPassword = await captureRedirect(() =>
      signup(formDataOf({ email: "new@school.edu", password: "abc" })),
    );
    expect(weakPassword.pathname).toBe("/signup");
    expect(weakPassword.params.error).toMatch(/at least 6 characters/i);

    // Neither attempt created an account.
    expect(userRepository.all()).toHaveLength(1);
  });

  it("creates the account and sends the user to confirm their email", async () => {
    const { pathname, params } = await captureRedirect(() =>
      signup(formDataOf({ email: "new@school.edu", password: "long-enough" })),
    );

    expect(userRepository.all().map((u) => u.email)).toContain("new@school.edu");
    expect(pathname).toBe("/login");
    expect(params.message).toMatch(/check your inbox/i);
  });
});

describe("signout", () => {
  it("clears the session and returns the user to the login page", async () => {
    const { pathname } = await captureRedirect(() => signout());

    expect(mocks.client.value.signedOut).toEqual([true]);
    expect(pathname).toBe("/login");
  });
});
