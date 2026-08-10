import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));

import { changePassword } from "./actions.js";
import { createClient } from "../../lib/supabase/server";

const form = (fields) => ({ get: (k) => (k in fields ? fields[k] : null) });

function fakeAuth({ user = { id: "u1" }, updateError = null } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      getUser: async () => ({ data: { user } }),
      updateUser: async (args) => {
        calls.push(args);
        return { data: {}, error: updateError };
      },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("changePassword", () => {
  it("rejects a password under the minimum", async () => {
    const sb = fakeAuth();
    createClient.mockResolvedValue(sb);

    expect(await changePassword(form({ password: "12345", confirm: "12345" }))).toEqual({
      error: "Use at least 6 characters.",
    });
    expect(sb.calls).toHaveLength(0);
  });

  it("rejects a mismatched confirmation", async () => {
    const sb = fakeAuth();
    createClient.mockResolvedValue(sb);

    expect(await changePassword(form({ password: "abcdef", confirm: "abcdeg" }))).toEqual({
      error: "Those two passwords don't match.",
    });
    expect(sb.calls).toHaveLength(0);
  });

  it("refuses to keep the shared initial password", async () => {
    // The whole point of this page. Accepting 123456 here would let a student
    // "change" their password to the one everybody already knows.
    const sb = fakeAuth();
    createClient.mockResolvedValue(sb);

    expect(await changePassword(form({ password: "123456", confirm: "123456" }))).toEqual({
      error: "Pick something other than the starting password.",
    });
    expect(sb.calls).toHaveLength(0);
  });

  it("requires a signed-in user", async () => {
    createClient.mockResolvedValue(fakeAuth({ user: null }));

    expect(await changePassword(form({ password: "abcdef", confirm: "abcdef" }))).toEqual({
      error: "You must be signed in.",
    });
  });

  it("updates the password on the caller's own session", async () => {
    const sb = fakeAuth();
    createClient.mockResolvedValue(sb);

    const result = await changePassword(form({ password: "abcdef", confirm: "abcdef" }));

    expect(sb.calls[0]).toEqual({ password: "abcdef" });
    expect(result.ok).toMatch(/changed/i);
  });

  it("reports a failed update without claiming success", async () => {
    createClient.mockResolvedValue(fakeAuth({ updateError: { message: "boom" } }));

    expect(await changePassword(form({ password: "abcdef", confirm: "abcdef" }))).toEqual({
      error: "Could not change your password.",
    });
  });
});
