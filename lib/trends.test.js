/**
 * Unit tests for the error-trend aggregation.
 *
 * These functions decide what the dashboard CLAIMS, not just what it draws, so
 * the cases below are weighted towards the claims: when a direction may be
 * named, when it may not, and which denominator each ratio is taken against.
 * Getting those wrong would not crash anything — it would quietly show a
 * therapist a trend that is not there.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLES_FOR_TREND,
  summariseCaseload,
  summariseStudentTrend,
} from "./trends.js";

/** One error_analyses row, trimmed to the columns the aggregator reads. */
function row({ at, words = 100, errors = 0, counts = {} }) {
  return {
    id: `analysis-${at}`,
    created_at: at,
    word_count: words,
    error_count: errors,
    category_counts: counts,
    dominant_profile: null,
    profile_label: null,
    profile_confidence: null,
  };
}

describe("summariseStudentTrend", () => {
  it("no rows: reports nothing rather than an empty trend", () => {
    const trend = summariseStudentTrend([]);

    expect(trend.samples).toBe(0);
    expect(trend.hasTrend).toBe(false);
    expect(trend.headline).toBe("No writing samples analysed yet.");
    expect(trend.categories).toEqual([]);
    expect(trend.errorRate.series).toEqual([]);
  });

  it("survives the shapes a jsonb column can actually hold", () => {
    // Rows written by older builds, or by a bug. None of these should take the
    // student page down, because the page is how you would find out.
    const rows = [
      { id: "a", created_at: "2026-01-01T00:00:00Z", category_counts: null },
      { id: "b", created_at: "2026-01-02T00:00:00Z", category_counts: ["not", "an", "object"] },
      { id: "c", created_at: "2026-01-03T00:00:00Z", category_counts: { visual: "3" } },
      { id: "d", created_at: "2026-01-04T00:00:00Z", category_counts: { visual: 0, homophone: -2 } },
      {},
    ];

    const trend = summariseStudentTrend(rows);

    expect(trend.samples).toBe(5);
    // "3" as a string still counts; zero and negative counts are dropped rather
    // than drawn as bands with no height.
    expect(trend.categories.map((c) => c.key)).toEqual(["visual"]);
    expect(trend.categories[0].total).toBe(3);
  });

  it("orders by timestamp regardless of the order rows arrive in", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-03-01T00:00:00Z", errors: 5 }),
      row({ at: "2026-01-01T00:00:00Z", errors: 20 }),
      row({ at: "2026-02-01T00:00:00Z", errors: 12 }),
    ]);

    expect(trend.points.map((p) => p.errors)).toEqual([20, 12, 5]);
    expect(trend.span.from).toBe("2026-01-01T00:00:00Z");
    expect(trend.span.to).toBe("2026-03-01T00:00:00Z");
  });

  it("measures volume per 100 words, so a longer sample is not penalised", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", words: 60, errors: 10 }),
      row({ at: "2026-02-01T00:00:00Z", words: 300, errors: 15 }),
    ]);

    // The second sample has MORE errors and a LOWER rate. Reporting raw counts
    // would invert the finding, which is the reason this metric exists.
    expect(trend.points[0].errorsPer100).toBeCloseTo(16.7, 1);
    expect(trend.points[1].errorsPer100).toBe(5);
  });

  it("cannot compute a rate without a word count, and says null rather than zero", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", words: null, errors: 8 }),
      row({ at: "2026-02-01T00:00:00Z", words: 100, errors: 4 }),
    ]);

    // Zero would draw as flawless writing on the rate chart.
    expect(trend.points[0].errorsPer100).toBeNull();
    expect(trend.errorRate.series).toHaveLength(1);
    expect(trend.errorRate.series[0].value).toBe(4);
  });

  it("drops a corrupt rate that overflows instead of poisoning the chart scale", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", words: Number.MIN_VALUE, errors: 1 }),
    ]);

    expect(trend.points[0].errorsPer100).toBeNull();
    expect(trend.errorRate.series).toEqual([]);
  });

  it("takes category shares against the categorised errors, not the total", () => {
    const trend = summariseStudentTrend([
      row({
        at: "2026-01-01T00:00:00Z",
        errors: 10, // includes 6 errors that carry no category
        counts: { orthographic: 3, phonological: 1 },
      }),
    ]);

    const shares = trend.points[0].shares;
    // 3 of the 4 CATEGORISED errors. Against error_count it would be 0.3, and
    // the stacked band would never reach 100% even when one category accounts
    // for everything that was classified.
    expect(shares.orthographic).toBeCloseTo(0.75, 5);
    expect(shares.phonological).toBeCloseTo(0.25, 5);
    expect(shares.orthographic + shares.phonological).toBeCloseTo(1, 5);
  });

  it(`withholds a direction below ${MIN_SAMPLES_FOR_TREND} samples`, () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", errors: 20, counts: { visual: 8 } }),
      row({ at: "2026-02-01T00:00:00Z", errors: 2, counts: { orthographic: 2 } }),
    ]);

    // A dramatic drop, and still no claim: two points always make a line, and
    // that line always slopes somewhere.
    expect(trend.hasTrend).toBe(false);
    expect(trend.errorRate.direction).toBeNull();
    expect(trend.categories.every((c) => c.direction === null)).toBe(true);
    expect(trend.headline).toContain("2 samples so far");
  });

  it("names a falling rate once there are enough samples", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", words: 100, errors: 12 }),
      row({ at: "2026-02-01T00:00:00Z", words: 100, errors: 9 }),
      row({ at: "2026-03-01T00:00:00Z", words: 100, errors: 4 }),
    ]);

    expect(trend.hasTrend).toBe(true);
    expect(trend.errorRate.direction).toBe("down");
    expect(trend.errorRate.change).toBe(-8);
    expect(trend.headline).toContain("fell from 12 to 4 per 100 words");
  });

  it("calls a small movement flat rather than a direction", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", words: 200, errors: 20 }), // 10.0
      row({ at: "2026-02-01T00:00:00Z", words: 200, errors: 21 }), // 10.5
      row({ at: "2026-03-01T00:00:00Z", words: 200, errors: 22 }), // 11.0
    ]);

    // One extra error per 100 words is within the wobble between two pieces of
    // writing. Calling that "getting worse" to a parent would be wrong.
    expect(trend.errorRate.direction).toBe("flat");
    expect(trend.headline).toContain("held near 11");
  });

  it("reports a shifting mix even when the volume does not move", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", words: 100, errors: 8, counts: { phonological: 6, orthographic: 2 } }),
      row({ at: "2026-02-01T00:00:00Z", words: 100, errors: 8, counts: { phonological: 4, orthographic: 4 } }),
      row({ at: "2026-03-01T00:00:00Z", words: 100, errors: 8, counts: { phonological: 1, orthographic: 7 } }),
    ]);

    expect(trend.errorRate.direction).toBe("flat");

    const orthographic = trend.categories.find((c) => c.key === "orthographic");
    const phonological = trend.categories.find((c) => c.key === "phonological");
    expect(orthographic.direction).toBe("up");
    expect(phonological.direction).toBe("down");

    // The teaching target changed even though the error count did not, so the
    // headline has to carry it.
    expect(trend.headline).toMatch(/Orthographic errors grew to 88%/);
  });

  it("keeps a category the taxonomy has not heard of instead of dropping it", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", errors: 2, counts: { punctuation: 2 } }),
    ]);

    // Silently dropping it would break the shares as well as hiding the data.
    const category = trend.categories.find((c) => c.key === "punctuation");
    expect(category).toBeDefined();
    expect(category.label).toBe("punctuation");
    expect(trend.points[0].shares.punctuation).toBe(1);
  });

  it("treats category names matching object prototype keys as data", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", counts: { toString: Number.MIN_VALUE } }),
      row({ at: "2026-02-01T00:00:00Z", counts: {} }),
    ]);

    const category = trend.categories.find((item) => item.key === "toString");
    expect(category.total).toBe(Number.MIN_VALUE);
    expect(category.series.map((point) => point.count)).toEqual([Number.MIN_VALUE, 0]);
    expect(category.series.map((point) => point.share)).toEqual([1, 0]);
  });

  it("ranks categories by how much of the error load they carry", () => {
    const trend = summariseStudentTrend([
      row({ at: "2026-01-01T00:00:00Z", errors: 9, counts: { visual: 1, orthographic: 6, phonological: 2 } }),
    ]);

    expect(trend.ranked.map((c) => c.key)).toEqual(["orthographic", "phonological", "visual"]);
  });
});

describe("summariseCaseload", () => {
  const falling = [
    row({ at: "2026-01-01T00:00:00Z", words: 100, errors: 14, counts: { orthographic: 10 } }),
    row({ at: "2026-02-01T00:00:00Z", words: 100, errors: 9, counts: { orthographic: 7 } }),
    row({ at: "2026-03-01T00:00:00Z", words: 100, errors: 3, counts: { orthographic: 3 } }),
  ];
  const rising = [
    row({ at: "2026-01-01T00:00:00Z", words: 100, errors: 3, counts: { phonological: 3 } }),
    row({ at: "2026-02-01T00:00:00Z", words: 100, errors: 8, counts: { phonological: 6 } }),
    row({ at: "2026-03-01T00:00:00Z", words: 100, errors: 15, counts: { phonological: 12 } }),
  ];

  it("puts rising error rates first, then whoever has the most data", () => {
    const summary = summariseCaseload([
      { student: { id: "s1", display_name: "Amara" }, rows: falling },
      { student: { id: "s2", display_name: "Ben" }, rows: [] },
      { student: { id: "s3", display_name: "Chen" }, rows: rising },
    ]);

    // The point of a caseload view is who to look at next.
    expect(summary.students.map((s) => s.name)).toEqual(["Chen", "Amara", "Ben"]);
    expect(summary.students[0].errorRate.direction).toBe("up");
  });

  it("counts what the summary line quotes", () => {
    const summary = summariseCaseload([
      { student: { id: "s1", display_name: "Amara" }, rows: falling },
      { student: { id: "s2", display_name: "Ben" }, rows: [] },
      { student: { id: "s3", display_name: "Chen" }, rows: rising },
      { student: { id: "s4", display_name: "Dev" }, rows: [row({ at: "2026-01-01T00:00:00Z", errors: 1 })] },
    ]);

    expect(summary.withSamples).toBe(3);
    expect(summary.withTrend).toBe(2); // Dev has one sample, which is not a trend
    expect(summary.rising).toBe(1);
    expect(summary.totalSamples).toBe(7);
  });

  it("gives each row the sparkline and leading category its cell needs", () => {
    const summary = summariseCaseload([
      { student: { id: "s1", display_name: "Amara" }, rows: falling },
    ]);

    const [amara] = summary.students;
    expect(amara.sparkline).toEqual([14, 9, 3]);
    expect(amara.leading.key).toBe("orthographic");
    expect(amara.errorRate.last).toBe(3);
    expect(amara.lastSampleAt).toBe("2026-03-01T00:00:00Z");
  });

  it("handles a student with no name and no rows without inventing data", () => {
    const summary = summariseCaseload([{ student: {}, rows: [] }]);

    expect(summary.students[0].name).toBe("Unnamed student");
    expect(summary.students[0].samples).toBe(0);
    expect(summary.students[0].leading).toBeNull();
    expect(summary.students[0].sparkline).toEqual([]);
  });

  it("returns an empty roll-up for an empty caseload", () => {
    expect(summariseCaseload([]).students).toEqual([]);
    expect(summariseCaseload(undefined).totalSamples).toBe(0);
  });
});
