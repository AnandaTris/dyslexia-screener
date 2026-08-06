import { describe, it, expect } from "vitest";
import { loadStudents, loadStudent, ageFromBirthYear } from "./students.js";
import { fakeSupabase } from "../tests/support/queryBuilder.js";

describe("loadStudents", () => {
  it("returns the therapist's students", async () => {
    const sb = fakeSupabase({
      data: { students: { data: [{ id: "st1", display_name: "Ana" }], error: null } },
    });
    expect(await loadStudents(sb, "u1")).toEqual([{ id: "st1", display_name: "Ana" }]);
  });

  it("returns an empty array rather than null when there are none", async () => {
    const sb = fakeSupabase({ data: { students: { data: null, error: null } } });
    expect(await loadStudents(sb, "u1")).toEqual([]);
  });

  it("filters by therapist_id", async () => {
    let seen = null;
    const sb = fakeSupabase({
      data: {
        students: (state) => {
          seen = state.filters;
          return { data: [], error: null };
        },
      },
    });
    await loadStudents(sb, "u1");
    expect(seen).toContainEqual(["therapist_id", "u1"]);
  });
});

describe("loadStudent", () => {
  it("returns null for a missing id without querying", async () => {
    const sb = fakeSupabase({ data: { students: { data: { id: "st1" }, error: null } } });
    expect(await loadStudent(sb, "u1", null)).toBeNull();
  });

  it("returns null when the row belongs to another therapist", async () => {
    // RLS returns no row, so the builder settles with null data.
    const sb = fakeSupabase({ data: { students: { data: null, error: null } } });
    expect(await loadStudent(sb, "u1", "st-other")).toBeNull();
  });

  it("scopes the lookup by both therapist and id", async () => {
    let seen = null;
    const sb = fakeSupabase({
      data: {
        students: (state) => {
          seen = state.filters;
          return { data: { id: "st1", display_name: "Ana" }, error: null };
        },
      },
    });
    expect(await loadStudent(sb, "u1", "st1")).toEqual({ id: "st1", display_name: "Ana" });
    expect(seen).toContainEqual(["therapist_id", "u1"]);
    expect(seen).toContainEqual(["id", "st1"]);
  });
});

describe("ageFromBirthYear", () => {
  it("is null when no year was recorded", () => {
    expect(ageFromBirthYear(null)).toBeNull();
    expect(ageFromBirthYear(undefined)).toBeNull();
  });

  it("counts whole years from the current year", () => {
    expect(ageFromBirthYear(2017, new Date("2026-08-06"))).toBe(9);
  });

  it("rejects a year in the future rather than reporting a negative age", () => {
    expect(ageFromBirthYear(2030, new Date("2026-08-06"))).toBeNull();
  });
});
