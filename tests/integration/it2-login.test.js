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

const mocks = vi.hoisted(() => ({ client: { value: null } }));

vi.mock("next/navigation", async () => {
  const { redirect } = await import("../support/redirect.js");
  return { redirect };
});

vi.mock("../../lib/supabase/server.js", () => ({
  createClient: async () => mocks.client.value,
}));

const { login, signup } = await import("../../app/login/actions.js");

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
});
