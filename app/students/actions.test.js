import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createStudent } from "./actions.js";
import { createClient } from "../../lib/supabase/server";
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
