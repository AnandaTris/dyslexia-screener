import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createStudent, createStudentLogin, resetStudentPassword } from "./actions.js";
import { createClient } from "../../lib/supabase/server";
import { createAdminClient } from "../../lib/supabase/admin";
import { fakeSupabase } from "../../tests/support/queryBuilder.js";

const form = (fields) => ({ get: (k) => (k in fields ? fields[k] : null) });

beforeEach(() => vi.clearAllMocks());

describe("createStudent", () => {
  it("rejects a blank name", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: { id: "u1" } }));
    expect(await createStudent(form({ display_name: "   " }))).toEqual({
      error: "Enter the student's name.",
    });
  });

  it("rejects a birth year outside the allowed range", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: { id: "u1" } }));
    expect(await createStudent(form({ display_name: "Ana", birth_year: "1200" }))).toEqual({
      error: "Enter a four-digit year of birth, or leave it blank.",
    });
  });

  it("rejects a non-numeric birth year", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: { id: "u1" } }));
    expect(await createStudent(form({ display_name: "Ana", birth_year: "two thousand" }))).toEqual(
      { error: "Enter a four-digit year of birth, or leave it blank." }
    );
  });

  it("requires a signed-in user", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: null }));
    expect(await createStudent(form({ display_name: "Ana" }))).toEqual({
      error: "You must be signed in.",
    });
  });

  it("trims the name and stores a null birth year when left blank", async () => {
    const sb = fakeSupabase({
      user: { id: "u1" },
      data: { students: { data: [{ id: "st1" }], error: null } },
    });
    createClient.mockResolvedValue(sb);

    await expect(createStudent(form({ display_name: " Ana ", birth_year: "" }))).rejects.toThrow(
      "REDIRECT"
    );

    expect(sb.writesTo("students", "insert")[0].rows).toEqual({
      therapist_id: "u1",
      display_name: "Ana",
      birth_year: null,
    });
  });

  it("stores a valid birth year as a number", async () => {
    const sb = fakeSupabase({
      user: { id: "u1" },
      data: { students: { data: [{ id: "st1" }], error: null } },
    });
    createClient.mockResolvedValue(sb);

    await expect(
      createStudent(form({ display_name: "Ana", birth_year: "2017" }))
    ).rejects.toThrow("REDIRECT");

    expect(sb.writesTo("students", "insert")[0].rows.birth_year).toBe(2017);
  });

  it("reports an insert failure instead of redirecting", async () => {
    const sb = fakeSupabase({
      user: { id: "u1" },
      data: { students: { data: null, error: { message: "row-level security" } } },
    });
    createClient.mockResolvedValue(sb);

    expect(await createStudent(form({ display_name: "Ana" }))).toEqual({
      error: "Could not add that student.",
    });
  });
});

// A double for the slice of the admin API these actions use.
function fakeAdmin({ createResult, updateResult, deleteResult } = {}) {
  const calls = { create: [], update: [], delete: [] };
  return {
    calls,
    auth: {
      admin: {
        createUser: async (args) => {
          calls.create.push(args);
          return createResult ?? { data: { user: { id: "auth-1" } }, error: null };
        },
        updateUserById: async (id, args) => {
          calls.update.push({ id, args });
          return updateResult ?? { data: {}, error: null };
        },
        deleteUser: async (id) => {
          calls.delete.push(id);
          return deleteResult ?? { error: null };
        },
      },
    },
  };
}

const THERAPIST_USER = { id: "t1" };
const student = (extra = {}) => ({
  id: "st1",
  display_name: "Ana",
  auth_user_id: null,
  login_email: null,
  ...extra,
});

describe("createStudentLogin", () => {
  it("rejects a malformed email before touching the admin API", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: THERAPIST_USER }));

    expect(await createStudentLogin(form({ student_id: "st1", email: "ana" }))).toEqual({
      error: "Enter a valid email address.",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    createClient.mockResolvedValue(fakeSupabase({ user: null }));

    expect(
      await createStudentLogin(form({ student_id: "st1", email: "ana@example.com" }))
    ).toEqual({ error: "You must be signed in." });
  });

  it("refuses to run on a student account", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ user: { id: "s1", app_metadata: { role: "student" } } })
    );

    expect(
      await createStudentLogin(form({ student_id: "st1", email: "ana@example.com" }))
    ).toEqual({ error: "Only a therapist can issue a login." });
  });

  it("404s another therapist's student", async () => {
    // loadStudent filters by therapist_id, so someone else's id resolves to null.
    createClient.mockResolvedValue(
      fakeSupabase({ user: THERAPIST_USER, data: { students: { data: null, error: null } } })
    );

    expect(
      await createStudentLogin(form({ student_id: "st1", email: "ana@example.com" }))
    ).toEqual({ error: "That student was not found." });
  });

  it("refuses to issue a second login over the top of the first", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({
        user: THERAPIST_USER,
        data: { students: { data: student({ auth_user_id: "auth-0" }), error: null } },
      })
    );

    expect(
      await createStudentLogin(form({ student_id: "st1", email: "new@example.com" }))
    ).toEqual({ error: "Ana already has a login." });
  });

  it("creates the account with the claim, the initial password and no email", async () => {
    const sb = fakeSupabase({
      user: THERAPIST_USER,
      data: { students: { data: student(), error: null } },
    });
    createClient.mockResolvedValue(sb);
    const admin = fakeAdmin();
    createAdminClient.mockReturnValue(admin);

    const result = await createStudentLogin(
      form({ student_id: "st1", email: " Ana@Example.COM " })
    );

    expect(admin.calls.create[0]).toEqual({
      email: "ana@example.com",
      password: "123456",
      // email_confirm keeps this off SMTP entirely — the project has already
      // exhausted Supabase's built-in send quota once.
      email_confirm: true,
      app_metadata: { role: "student", student_id: "st1" },
    });
    expect(sb.writesTo("students", "update")[0].patch).toEqual({
      auth_user_id: "auth-1",
      login_email: "ana@example.com",
    });
    expect(result.ok).toContain("ana@example.com");
    expect(result.ok).toContain("123456");
  });

  it("reports a taken email in plain words", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ user: THERAPIST_USER, data: { students: { data: student(), error: null } } })
    );
    createAdminClient.mockReturnValue(
      fakeAdmin({
        createResult: { data: null, error: { message: "A user with this email address has already been registered" } },
      })
    );

    expect(
      await createStudentLogin(form({ student_id: "st1", email: "ana@example.com" }))
    ).toEqual({ error: "That email already has an account." });
  });

  it("deletes the orphaned auth user when the link write fails", async () => {
    // Otherwise an auth user exists that nothing points at, and every retry
    // hits "already registered" — an unrecoverable state from one dropped
    // connection.
    createClient.mockResolvedValue(
      fakeSupabase({
        user: THERAPIST_USER,
        data: {
          "students.select": { data: student(), error: null },
          "students.update": { data: null, error: { message: "boom" } },
        },
      })
    );
    const admin = fakeAdmin();
    createAdminClient.mockReturnValue(admin);

    const result = await createStudentLogin(
      form({ student_id: "st1", email: "ana@example.com" })
    );

    expect(admin.calls.delete).toEqual(["auth-1"]);
    expect(result.error).toBe("Could not create that login — try again.");
  });

  it("names the address when even the cleanup fails", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({
        user: THERAPIST_USER,
        data: {
          "students.select": { data: student(), error: null },
          "students.update": { data: null, error: { message: "boom" } },
        },
      })
    );
    createAdminClient.mockReturnValue(
      fakeAdmin({ deleteResult: { error: { message: "also boom" } } })
    );

    const result = await createStudentLogin(
      form({ student_id: "st1", email: "ana@example.com" })
    );

    expect(result.error).toContain("ana@example.com");
    expect(result.error).toMatch(/dashboard/i);
  });

  it("says so when the service-role key is not configured", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ user: THERAPIST_USER, data: { students: { data: student(), error: null } } })
    );
    createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    });

    expect(
      await createStudentLogin(form({ student_id: "st1", email: "ana@example.com" }))
    ).toEqual({ error: "Student logins are not set up on this server." });
  });
});

describe("login actions when student_accounts.sql has not been applied", () => {
  // loadStudent now flags this rather than 404ing. Without the guard below,
  // createStudentLogin would create a real auth user and only then discover the
  // link column is missing — leaving an account nothing points at, and every
  // retry failing with "already registered" forever.
  const unmigrated = () =>
    fakeSupabase({
      user: THERAPIST_USER,
      data: { students: { data: student({ loginsUnavailable: true }), error: null } },
    });

  it("refuses to create a login, without touching the admin API", async () => {
    createClient.mockResolvedValue(unmigrated());

    const result = await createStudentLogin(
      form({ student_id: "st1", email: "ana@example.com" })
    );

    expect(result.error).toMatch(/student_accounts\.sql/);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses to reset a password rather than blaming the student", async () => {
    // "Ana does not have a login yet" would be a lie: the column that records it
    // does not exist, so nothing is known either way.
    createClient.mockResolvedValue(unmigrated());

    const result = await resetStudentPassword(form({ student_id: "st1" }));

    expect(result.error).toMatch(/student_accounts\.sql/);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("resetStudentPassword", () => {
  it("puts the password back to the initial one", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({
        user: THERAPIST_USER,
        data: { students: { data: student({ auth_user_id: "auth-1" }), error: null } },
      })
    );
    const admin = fakeAdmin();
    createAdminClient.mockReturnValue(admin);

    const result = await resetStudentPassword(form({ student_id: "st1" }));

    expect(admin.calls.update[0]).toEqual({ id: "auth-1", args: { password: "123456" } });
    expect(result.ok).toContain("123456");
  });

  it("refuses when the student has no login yet", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ user: THERAPIST_USER, data: { students: { data: student(), error: null } } })
    );

    expect(await resetStudentPassword(form({ student_id: "st1" }))).toEqual({
      error: "Ana does not have a login yet.",
    });
  });

  it("refuses to run on a student account", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ user: { id: "s1", app_metadata: { role: "student" } } })
    );

    expect(await resetStudentPassword(form({ student_id: "st1" }))).toEqual({
      error: "Only a therapist can reset a password.",
    });
  });

  it("reports a failed reset without claiming success", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({
        user: THERAPIST_USER,
        data: { students: { data: student({ auth_user_id: "auth-1" }), error: null } },
      })
    );
    createAdminClient.mockReturnValue(
      fakeAdmin({ updateResult: { data: null, error: { message: "boom" } } })
    );

    expect(await resetStudentPassword(form({ student_id: "st1" }))).toEqual({
      error: "Could not reset that password.",
    });
  });
});
