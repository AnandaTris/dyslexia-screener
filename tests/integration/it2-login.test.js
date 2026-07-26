/**
 * Integrated Test 2 — Login
 *
 * The sequence under test, from the plan:
 *
 *   TestRunner -> AuthService: login(email, password)
 *   AuthService -> UserRepository: findUser(email)
 *   UserRepository --> AuthService: Stored Password
 *   AuthService -> AuthService: compare Passwords
 *   AuthService --> TestRunner: Login Successful
 *
 * The real `login` action runs against the same in-memory UserRepository the
 * sign-up flow writes to, so this registers an account and then logs into it —
 * UC1 and UC2 exercised as one chain.
 *
 * Note on where the comparison happens: this project holds no password hashes,
 * and must not. Supabase Auth stores the credential and compares it, so "compare
 * Passwords" is inside AuthService (the double). What the test asserts is that the
 * repository was consulted and that the stored password admitted the user.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureRedirect, formDataOf } from "../support/redirect.js";
import { createFakeSupabase, createUserRepository } from "../support/supabase.js";

const mocks = vi.hoisted(() => ({ client: { value: null }, edgeClient: { value: null } }));

vi.mock("next/navigation", async () => {
  const { redirect } = await import("../support/redirect.js");
  return { redirect };
});

vi.mock("../../lib/supabase/server.js", () => ({
  createClient: async () => mocks.client.value,
}));

// The middleware builds its own client against the request's cookies rather
// than going through lib/supabase/server.js, so it is doubled separately.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => mocks.edgeClient.value,
}));

const { login, signup } = await import("../../app/login/actions.js");
const { middleware } = await import("../../middleware.js");
const { NextRequest } = await import("next/server");

let userRepository;

beforeEach(() => {
  userRepository = createUserRepository();
  // Confirmation off so a freshly registered account is immediately usable — with
  // it on, the same chain correctly stops at "confirm your email".
  mocks.client.value = createFakeSupabase({
    userRepository,
    requireEmailConfirmation: false,
  });
});

describe("Integrated Test 2 — Login", () => {
  it("login -> findUser -> stored password -> compare -> login successful", async () => {
    // Register first, so the account being logged into is one the system created.
    await captureRedirect(() =>
      signup(formDataOf({ email: "teacher@school.edu", password: "correct-horse" })),
    );
    userRepository.calls.length = 0;

    const redirected = await captureRedirect(() =>
      login(formDataOf({ email: "teacher@school.edu", password: "correct-horse" })),
    );

    // AuthService asked UserRepository for the stored user, once.
    expect(userRepository.calls).toEqual([["findUser", "teacher@school.edu"]]);

    // The stored password admitted the user: login successful.
    expect(redirected.pathname).toBe("/");
    expect(redirected.params.error).toBeUndefined();
  });

  it("happy: the middleware refreshes the session on a later request", async () => {
    // Second half of the plan's happy row. `getUser()` is what renews the token
    // — that is why the middleware calls it on every request rather than
    // reading the cookie directly.
    const refreshes = [];
    mocks.edgeClient.value = {
      auth: {
        async getUser() {
          refreshes.push(true);
          return { data: { user: { id: "user-1", email: "teacher@school.edu" } } };
        },
      },
    };

    const response = await middleware(new NextRequest("http://localhost:3000/"));

    expect(refreshes).toEqual([true]);
    // Access granted: the request passes through instead of being redirected.
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("error: invalid credentials are rejected with no session", async () => {
    await captureRedirect(() =>
      signup(formDataOf({ email: "teacher@school.edu", password: "correct-horse" })),
    );
    userRepository.calls.length = 0;

    const redirected = await captureRedirect(() =>
      login(formDataOf({ email: "teacher@school.edu", password: "wrong-password" })),
    );

    // The repository was still consulted — the account exists, the password did
    // not match it.
    expect(userRepository.calls).toEqual([["findUser", "teacher@school.edu"]]);

    // Rejected, and the reason comes back to the login form.
    expect(redirected.pathname).toBe("/login");
    expect(redirected.params.error).toMatch(/don't match an account/i);
  });

  it("error: no session means a later request is turned away by the middleware", async () => {
    mocks.edgeClient.value = {
      auth: { async getUser() { return { data: { user: null } }; } },
    };

    const page = await middleware(new NextRequest("http://localhost:3000/"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");

    // An API call gets JSON rather than an HTML login page, which would blow up
    // on res.json() in the browser.
    const api = await middleware(new NextRequest("http://localhost:3000/api/analyze"));
    expect(api.status).toBe(401);
  });
});
