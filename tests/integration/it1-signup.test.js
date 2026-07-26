/**
 * Integrated Test 1 — Sign Up
 *
 * The sequence under test, from the plan:
 *
 *   TestRunner -> AuthService: register(email, password, mobile)
 *   AuthService -> EmailVerificationService: verifyEmail(email)
 *   EmailVerificationService --> AuthService: verification = true
 *   AuthService -> UserRepository: save(user)
 *   UserRepository --> AuthService: userId
 *   AuthService --> TestRunner: Account Created
 *
 * Unlike the unit suite, nothing here is a per-test `vi.fn()`. The real `signup`
 * action runs against a real EmailVerificationService double and a real in-memory
 * UserRepository, wired together behind the Supabase client shape, so the test
 * asserts the ORDER of messages and not just the final answer.
 *
 * Strategy: bottom-up, call-graph. The leaf collaborators are faked; everything
 * above them is the real code.
 *
 * `mobile` is passed as the diagram specifies. The application does not read it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureRedirect, formDataOf } from "../support/redirect.js";
import {
  createEmailVerificationService,
  createFakeSupabase,
  createUserRepository,
} from "../support/supabase.js";

const mocks = vi.hoisted(() => ({ client: { value: null } }));

vi.mock("next/navigation", async () => {
  const { redirect } = await import("../support/redirect.js");
  return { redirect };
});

vi.mock("../../lib/supabase/server.js", () => ({
  createClient: async () => mocks.client.value,
}));

const { signup } = await import("../../app/login/actions.js");

let userRepository;
let emailVerificationService;

beforeEach(() => {
  // Wires the three collaborators from the diagram into one client.
  userRepository = createUserRepository();
  emailVerificationService = createEmailVerificationService();
  mocks.client.value = createFakeSupabase({
    userRepository,
    emailVerificationService,
    requireEmailConfirmation: true,
  });
});

describe("Integrated Test 1 — Sign Up", () => {
  it("register -> verifyEmail -> save -> userId -> account created", async () => {
    const redirected = await captureRedirect(() =>
      signup(
        formDataOf({
          email: "teacher@school.edu",
          password: "correct-horse",
          mobile: "+6591234567",
        }),
      ),
    );

    // AuthService consulted EmailVerificationService with the address given.
    expect(emailVerificationService.calls).toEqual(["teacher@school.edu"]);

    // Verification passed, so the user reached UserRepository — and the save
    // happened after the lookup, in that order.
    expect(userRepository.calls).toEqual([
      ["findUser", "teacher@school.edu"],
      ["save", "teacher@school.edu"],
    ]);

    // UserRepository issued a userId and the row is really there.
    const [stored] = userRepository.all();
    expect(stored.id).toMatch(/^user-/);
    expect(stored.email).toBe("teacher@school.edu");
    expect(stored.emailConfirmed).toBe(false);

    // Account created, reported back to the caller.
    expect(redirected.pathname).toBe("/login");
    expect(redirected.params.message).toMatch(/Account created/i);
  });
});
