import { describe, it, expect } from "vitest";
import { loadActiveJourney, progressFor } from "./journey.js";
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
  it("is null when the learner has no active journey", async () => {
    const supabase = fakeSupabase({ data: { journeys: { data: null, error: null } } });
    expect(await loadActiveJourney(supabase, "u1")).toBeNull();
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

    const journey = await loadActiveJourney(supabase, "u1");

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
    const journey = await loadActiveJourney(supabase, "u1");
    expect(journey.steps).toEqual([]);
    expect(progressFor(journey.steps).percent).toBe(0);
  });
});
