import { describe, it, expect } from "vitest";
import {
  loadStudent,
  loadStudentSummaries,
  isSchemaMissing,
  ageFromBirthYear,
} from "./students.js";
import { fakeSupabase } from "../tests/support/queryBuilder.js";

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

describe("loadStudent — when student_accounts.sql has not been applied", () => {
  // The whole select is rejected when one column is missing, so asking for
  // auth_user_id against an unmigrated database returned null and the student
  // page turned that into a 404 — for a student whose profile, screenings and
  // journey were all sitting there. loadStudentSummaries already degrades
  // instead of failing; this makes loadStudent honour the same contract.
  const missingColumn = { code: "42703", message: "column students.auth_user_id does not exist" };

  const unmigrated = (row) =>
    fakeSupabase({
      data: {
        students: (state) =>
          state.columns?.includes("auth_user_id")
            ? { data: null, error: missingColumn }
            : { data: row, error: null },
      },
    });

  it("still returns the student, so the page renders instead of 404ing", async () => {
    const sb = unmigrated({ id: "st1", display_name: "Ado", birth_year: 2005 });

    expect(await loadStudent(sb, "u1", "st1")).toMatchObject({
      id: "st1",
      display_name: "Ado",
      birth_year: 2005,
    });
  });

  it("reports the login columns as absent rather than as empty", async () => {
    // null would read as "no login issued yet" and the panel would offer a form
    // whose write cannot land. The flag is what lets it say so instead.
    const student = await loadStudent(unmigrated({ id: "st1", display_name: "Ado" }), "u1", "st1");

    expect(student.loginsUnavailable).toBe(true);
    expect(student.auth_user_id).toBeNull();
    expect(student.login_email).toBeNull();
  });

  it("asks for the login columns first, and only then falls back", async () => {
    const asked = [];
    const sb = fakeSupabase({
      data: {
        students: (state) => {
          asked.push(state.columns);
          return state.columns?.includes("auth_user_id")
            ? { data: null, error: missingColumn }
            : { data: { id: "st1" }, error: null };
        },
      },
    });

    await loadStudent(sb, "u1", "st1");

    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain("auth_user_id");
    expect(asked[1]).not.toContain("auth_user_id");
  });

  it("does NOT retry an ordinary error", async () => {
    // A dropped connection is not a missing migration. Retrying would turn one
    // failed request into two and still return nothing useful.
    const asked = [];
    const sb = fakeSupabase({
      data: {
        students: (state) => {
          asked.push(state.columns);
          return { data: null, error: { code: "57014", message: "canceling statement" } };
        },
      },
    });

    expect(await loadStudent(sb, "u1", "st1")).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it("returns null when the migration is missing AND the row is another therapist's", async () => {
    const sb = fakeSupabase({
      data: {
        students: (state) =>
          state.columns?.includes("auth_user_id")
            ? { data: null, error: missingColumn }
            : { data: null, error: null },
      },
    });

    expect(await loadStudent(sb, "u1", "st-other")).toBeNull();
  });
});

describe("isSchemaMissing", () => {
  it("recognises a missing table and a missing column", () => {
    expect(isSchemaMissing({ code: "PGRST205" })).toBe(true);
    expect(isSchemaMissing({ code: "42703" })).toBe(true);
  });

  it("is false for no error and for ordinary failures", () => {
    expect(isSchemaMissing(null)).toBe(false);
    expect(isSchemaMissing({ code: "23505" })).toBe(false);
  });
});

describe("loadStudentSummaries", () => {
  it("flags a missing schema rather than reporting an empty caseload", async () => {
    // Telling these apart matters: "no students yet" for an unapplied migration
    // sends someone hunting for a UI bug.
    const sb = fakeSupabase({
      data: { students: { data: null, error: { code: "PGRST205" } } },
    });
    expect(await loadStudentSummaries(sb, "u1")).toEqual({ students: [], schemaMissing: true });
  });

  it("reports an empty caseload without flagging the schema", async () => {
    const sb = fakeSupabase({ data: { students: { data: [], error: null } } });
    expect(await loadStudentSummaries(sb, "u1")).toEqual({ students: [], schemaMissing: false });
  });

  it("attaches the profile and journey progress to each student", async () => {
    const sb = fakeSupabase({
      data: {
        students: {
          data: [
            { id: "st1", display_name: "Ana", birth_year: 2017 },
            { id: "st2", display_name: "Ben", birth_year: null },
          ],
          error: null,
        },
        learner_profiles: {
          data: [{ student_id: "st1", profile: { primary_label: "surface" } }],
          error: null,
        },
        journeys: { data: [{ id: "j1", student_id: "st1" }], error: null },
        journey_steps: {
          data: [
            { journey_id: "j1", status: "done" },
            { journey_id: "j1", status: "done" },
            { journey_id: "j1", status: "not_started" },
            { journey_id: "j1", status: "in_progress" },
          ],
          error: null,
        },
      },
    });

    const { students } = await loadStudentSummaries(sb, "u1");

    const ana = students.find((s) => s.id === "st1");
    expect(ana.profile.primary_label).toBe("surface");
    expect(ana.hasJourney).toBe(true);
    expect(ana.stepsDone).toBe(2);
    expect(ana.stepsTotal).toBe(4);
    // in_progress is not partial credit — a half-finished step is not progress.
    expect(ana.percent).toBe(50);

    const ben = students.find((s) => s.id === "st2");
    expect(ben.profile).toBeNull();
    expect(ben.hasJourney).toBe(false);
    expect(ben.percent).toBe(0);
  });
});

describe("loadStudent — login columns", () => {
  it("selects auth_user_id and login_email", async () => {
    // Task 8's createStudentLogin decides "already has a login" from
    // auth_user_id. If the select omits the column it is always undefined and
    // a second login would be issued over the top of the first.
    let selected = null;
    const supabase = {
      from: () => ({
        select: (columns) => {
          selected = columns;
          return {
            eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          };
        },
      }),
    };

    await loadStudent(supabase, "t1", "s1");

    expect(selected).toContain("auth_user_id");
    expect(selected).toContain("login_email");
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
