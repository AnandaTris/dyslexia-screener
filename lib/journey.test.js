import { describe, it, expect } from "vitest";
import { loadActiveJourney, loadJourneyForStudent, progressFor } from "./journey.js";
import { fakeSupabase } from "../tests/support/queryBuilder.js";

describe("progressFor", () => {
  it("is all zeroes for no steps", () => {
    expect(progressFor([])).toEqual({ done: 0, total: 0, percent: 0 });
    expect(progressFor(undefined)).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("counts only done steps", () => {
    const steps = [
      { status: "done" },
      { status: "in_progress" },
      { status: "not_started" },
      { status: "done" },
    ];
    expect(progressFor(steps)).toEqual({ done: 2, total: 4, percent: 50 });
  });

  it("rounds the percentage to a whole number", () => {
    expect(progressFor([{ status: "done" }, {}, {}]).percent).toBe(33);
  });

  it("reaches 100 when every step is done", () => {
    expect(progressFor([{ status: "done" }, { status: "done" }]).percent).toBe(100);
  });
});

describe("loadActiveJourney", () => {
  it("is null when the student has no active journey", async () => {
    const supabase = fakeSupabase({ data: { journeys: { data: null, error: null } } });
    expect(await loadActiveJourney(supabase, "u1", "st1")).toBeNull();
  });

  it("is null without a student rather than returning another student's journey", async () => {
    // The fixture would happily hand back a journey; the guard must stop it
    // before the query runs at all.
    const supabase = fakeSupabase({
      data: { journeys: { data: { id: "j1" }, error: null } },
    });
    expect(await loadActiveJourney(supabase, "u1", null)).toBeNull();
  });

  it("filters by student_id as well as user_id", async () => {
    let seen = null;
    const supabase = fakeSupabase({
      data: {
        journeys: (state) => {
          seen = state.filters;
          return { data: { id: "j1" }, error: null };
        },
        journey_steps: { data: [], error: null },
      },
    });

    await loadActiveJourney(supabase, "u1", "st1");

    expect(seen).toContainEqual(["user_id", "u1"]);
    expect(seen).toContainEqual(["student_id", "st1"]);
    expect(seen).toContainEqual(["status", "active"]);
  });

  it("returns the journey with its steps, and filters to the caller", async () => {
    const supabase = fakeSupabase({
      data: {
        journeys: { data: { id: "j1", created_at: "2026-07-31" }, error: null },
        journey_steps: {
          data: [
            { id: "s1", step_index: 0, status: "done" },
            { id: "s2", step_index: 1, status: "not_started" },
          ],
          error: null,
        },
      },
    });

    const journey = await loadActiveJourney(supabase, "u1", "st1");

    expect(journey.id).toBe("j1");
    expect(journey.steps.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("yields an empty step list rather than null when the journey has none", async () => {
    const supabase = fakeSupabase({
      data: {
        journeys: { data: { id: "j1" }, error: null },
        journey_steps: { data: null, error: null },
      },
    });

    // progressFor is the immediate consumer and it must not be handed null.
    const journey = await loadActiveJourney(supabase, "u1", "st1");
    expect(journey.steps).toEqual([]);
    expect(progressFor(journey.steps).percent).toBe(0);
  });
});

describe("loadJourneyForStudent", () => {
  const journeyRow = { id: "j1", created_at: "2026-08-07", profile_snapshot: {} };

  it("filters by student only — RLS is what scopes it to this student", async () => {
    // A student's uid is not the journey's user_id (that column holds the
    // therapist), so filtering on it here would return null for every student.
    const sb = fakeSupabase({
      data: {
        journeys: { data: journeyRow, error: null },
        journey_steps: { data: [{ id: "st1", step_index: 0, status: "not_started" }], error: null },
      },
    });

    const journey = await loadJourneyForStudent(sb, "student-1");

    expect(journey.id).toBe("j1");
    expect(journey.steps).toHaveLength(1);
  });

  it("returns null without a student id", async () => {
    const sb = fakeSupabase({ data: {} });
    expect(await loadJourneyForStudent(sb, null)).toBeNull();
  });

  it("returns null when the student has no active journey", async () => {
    const sb = fakeSupabase({ data: { journeys: { data: null, error: null } } });
    expect(await loadJourneyForStudent(sb, "student-1")).toBeNull();
  });

  it("still returns an empty step list rather than null steps", async () => {
    const sb = fakeSupabase({
      data: {
        journeys: { data: journeyRow, error: null },
        journey_steps: { data: null, error: null },
      },
    });

    expect((await loadJourneyForStudent(sb, "student-1")).steps).toEqual([]);
  });
});

describe("loadActiveJourney keeps filtering by therapist", () => {
  it("still sends a user_id filter", async () => {
    // The therapist path must not silently widen to "any journey for this
    // student" when the shared read is extracted.
    const seen = [];
    const sb = fakeSupabase({
      data: {
        journeys: (state) => {
          seen.push(...state.filters.map(([column]) => column));
          return { data: null, error: null };
        },
      },
    });

    await loadActiveJourney(sb, "therapist-1", "student-1");

    expect(seen).toContain("user_id");
    expect(seen).toContain("student_id");
  });
});
