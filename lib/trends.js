// Turns a student's stored error analyses into the series the trend charts draw.
//
// Pure functions over plain rows: no Supabase client, no dates from the clock,
// no formatting. The pages do the querying and the SVG; everything that decides
// what the numbers *mean* lives here, where it can be tested directly.
//
// Two measurement choices drive the whole module, and both exist because raw
// counts lie when samples differ in length:
//
//   * Volume is reported as errors per 100 words, never as an error count. A
//     300-word sample with 15 errors is cleaner writing than a 60-word sample
//     with 10, and the raw counts say the opposite.
//   * Mix is reported as each category's SHARE of that sample's errors, not its
//     count. PS4 asks which kind of error dominates and whether that is
//     shifting; a share answers that at any sample length, and it is what makes
//     two sessions comparable at all.
//
// A falling error rate and a shifting mix are different findings, and a tool
// that merged them into one "score" would hide the useful half.

import { ERROR_CATEGORIES } from "./nlp/taxonomy";

/**
 * The error_analyses columns these functions read, for callers to select.
 *
 * Deliberately excludes `result`, which holds the entire analysis — every
 * error, every suggestion. Fetching a dozen of those to draw a line chart would
 * move megabytes to compute a handful of sums. The lifted columns exist for
 * exactly this query; shared here so the student page and the dashboard cannot
 * drift into selecting different sets.
 */
export const TREND_COLUMNS =
  "id, created_at, word_count, error_count, dominant_profile, profile_label, profile_confidence, category_counts";

/**
 * Below this many samples there is no trend to report — just points.
 *
 * Two samples always produce a line, and that line always slopes somewhere.
 * Naming a direction from it would manufacture a finding out of ordinary
 * between-sample variation, which is the same mistake the analyser already
 * refuses to make with MIN_ERRORS_FOR_PROFILE. The charts still draw; only the
 * claim about direction is withheld.
 */
export const MIN_SAMPLES_FOR_TREND = 3;

/**
 * A share has to move by more than this before the direction is called.
 * Eight points is wide enough to sit outside the wobble you get from one
 * sample having a couple more errors than another.
 */
const SHARE_NOISE_FLOOR = 0.08;

/** Errors per 100 words has to move by more than this to be called. */
const RATE_NOISE_FLOOR = 1.5;

/** Display order for the mix band: the three PS4 names first, then the rest. */
const CATEGORY_ORDER = [
  "phonological",
  "orthographic",
  "morphological",
  "visual",
  "homophone",
  "segmentation",
  "grammatical",
];

function labelFor(key) {
  return ERROR_CATEGORIES[key]?.label ?? key;
}

function shortFor(key) {
  return ERROR_CATEGORIES[key]?.short ?? "";
}

function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Normalises one stored row into a point on the timeline.
 *
 * Everything here is read defensively. These rows come out of a jsonb column
 * written by an older version of the analyser, and a null word_count or a
 * category key this build has never heard of must not take the page down.
 */
function toPoint(row) {
  const counts = {};
  const raw = row?.category_counts;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) counts[key] = n;
    }
  }

  // Summed from the counts rather than trusted from error_count. The two can
  // disagree: error_count includes errors that carry no category, and a share
  // taken against the larger number would never reach 1 even when one category
  // accounts for everything.
  const categorised = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const shares = {};
  for (const [key, n] of Object.entries(counts)) {
    shares[key] = categorised ? n / categorised : 0;
  }

  const words = Number(row?.word_count);
  const errors = Number(row?.error_count);
  const hasWords = Number.isFinite(words) && words > 0;
  const hasErrors = Number.isFinite(errors) && errors >= 0;

  return {
    id: row?.id ?? null,
    at: row?.created_at ?? null,
    words: hasWords ? words : null,
    errors: hasErrors ? errors : categorised,
    // null, not 0, when the sample length is unknown. Zero would draw as
    // "flawless writing" on the rate chart.
    errorsPer100: hasWords && hasErrors ? round((errors / words) * 100) : null,
    counts,
    shares,
    categorised,
    dominant: row?.dominant_profile ?? null,
    profileLabel: row?.profile_label ?? null,
    confidence: Number.isFinite(Number(row?.profile_confidence))
      ? Number(row.profile_confidence)
      : null,
  };
}

/** Ascending by timestamp; rows with no timestamp sort last and keep their order. */
function chronological(rows) {
  return [...rows].sort((a, b) => {
    const at = Date.parse(a?.created_at ?? "");
    const bt = Date.parse(b?.created_at ?? "");
    if (!Number.isFinite(at) && !Number.isFinite(bt)) return 0;
    if (!Number.isFinite(at)) return 1;
    if (!Number.isFinite(bt)) return -1;
    return at - bt;
  });
}

/**
 * "up" / "down" / "flat" / null, where null means not enough samples to say.
 * `floor` is the movement required before a direction is named at all.
 */
function direction(first, last, floor, samples) {
  if (samples < MIN_SAMPLES_FOR_TREND) return null;
  if (first === null || last === null) return null;
  const change = last - first;
  if (Math.abs(change) < floor) return "flat";
  return change > 0 ? "up" : "down";
}

/**
 * The per-student trend.
 *
 * @param rows error_analyses rows for one student, any order.
 * @returns a shape the chart components can render without further arithmetic.
 */
export function summariseStudentTrend(rows) {
  const points = chronological(Array.isArray(rows) ? rows : []).map(toPoint);
  const samples = points.length;

  // Every category that actually appears, in the display order above, with
  // anything unrecognised appended rather than dropped — a category added to
  // the taxonomy later should show up as itself, not vanish from the mix and
  // silently break the shares.
  const seen = new Set();
  for (const point of points) {
    for (const key of Object.keys(point.counts)) seen.add(key);
  }
  const keys = [
    ...CATEGORY_ORDER.filter((k) => seen.has(k)),
    ...[...seen].filter((k) => !CATEGORY_ORDER.includes(k)).sort(),
  ];

  const categories = keys.map((key) => {
    const series = points.map((p) => ({
      at: p.at,
      share: p.shares[key] ?? 0,
      count: p.counts[key] ?? 0,
    }));
    const first = series[0]?.share ?? null;
    const last = series[series.length - 1]?.share ?? null;
    return {
      key,
      label: labelFor(key),
      short: shortFor(key),
      series,
      total: series.reduce((sum, s) => sum + s.count, 0),
      first,
      last,
      change: first === null || last === null ? null : round(last - first, 3),
      direction: direction(first, last, SHARE_NOISE_FLOOR, samples),
    };
  });

  // Ranked by how much of the student's total error load each category carries,
  // so the charts lead with what matters for this learner rather than with a
  // fixed taxonomy order.
  const ranked = [...categories].sort((a, b) => b.total - a.total);

  const rated = points.filter((p) => p.errorsPer100 !== null);
  const rateFirst = rated[0]?.errorsPer100 ?? null;
  const rateLast = rated[rated.length - 1]?.errorsPer100 ?? null;

  const errorRate = {
    series: rated.map((p) => ({ at: p.at, value: p.errorsPer100 })),
    first: rateFirst,
    last: rateLast,
    change: rateFirst === null || rateLast === null ? null : round(rateLast - rateFirst),
    // Judged on the rated points, not on every point: a run of samples with no
    // recorded word count cannot support a claim about rate.
    direction: direction(rateFirst, rateLast, RATE_NOISE_FLOOR, rated.length),
  };

  return {
    samples,
    points,
    categories,
    ranked,
    errorRate,
    totals: {
      words: points.reduce((sum, p) => sum + (p.words ?? 0), 0),
      errors: points.reduce((sum, p) => sum + p.errors, 0),
    },
    span: {
      from: points[0]?.at ?? null,
      to: points[points.length - 1]?.at ?? null,
    },
    // The single sentence the student page leads with. Kept here rather than in
    // the component so the wording is testable.
    headline: buildHeadline({ samples, errorRate, ranked }),
    hasTrend: samples >= MIN_SAMPLES_FOR_TREND,
  };
}

/**
 * One plain-language sentence about what changed, or an honest statement that
 * nothing can be said yet.
 *
 * Deliberately describes the writing, never the writer, and never uses the
 * language of improvement or deterioration as a judgement — "fewer errors per
 * 100 words" is an observation about samples; "getting better" is a claim about
 * a child that one page of text cannot support.
 */
function buildHeadline({ samples, errorRate, ranked }) {
  if (samples === 0) return "No writing samples analysed yet.";
  if (samples < MIN_SAMPLES_FOR_TREND) {
    const noun = samples === 1 ? "sample" : "samples";
    return `${samples} ${noun} so far — ${MIN_SAMPLES_FOR_TREND} are needed before a direction can be read.`;
  }

  const parts = [];

  if (errorRate.direction === "down") {
    parts.push(
      `Error density fell from ${errorRate.first} to ${errorRate.last} per 100 words.`,
    );
  } else if (errorRate.direction === "up") {
    parts.push(
      `Error density rose from ${errorRate.first} to ${errorRate.last} per 100 words.`,
    );
  } else if (errorRate.direction === "flat") {
    parts.push(`Error density held near ${errorRate.last} per 100 words.`);
  }

  // The mix moving matters even when the volume does not: the same number of
  // errors made of different stuff means the teaching target has changed.
  const moved = ranked.find((c) => c.direction === "up" || c.direction === "down");
  if (moved) {
    const verb = moved.direction === "up" ? "grew to" : "fell to";
    parts.push(
      `${moved.label} errors ${verb} ${Math.round(moved.last * 100)}% of the total (from ${Math.round(moved.first * 100)}%).`,
    );
  } else if (ranked[0]?.total) {
    parts.push(`The mix stayed led by ${ranked[0].label.toLowerCase()} errors.`);
  }

  return parts.join(" ") || "No clear movement across these samples.";
}

/**
 * The caseload roll-up for /dashboard.
 *
 * @param entries [{ student, rows }] — one per student on the caseload.
 * @returns rows ready to render, plus the counts the summary line quotes.
 */
export function summariseCaseload(entries) {
  const students = (Array.isArray(entries) ? entries : []).map(({ student, rows }) => {
    const trend = summariseStudentTrend(rows);
    return {
      id: student?.id ?? null,
      name: student?.display_name ?? "Unnamed student",
      samples: trend.samples,
      hasTrend: trend.hasTrend,
      errorRate: trend.errorRate,
      leading: trend.ranked[0] ?? null,
      sparkline: trend.errorRate.series.map((s) => s.value),
      lastSampleAt: trend.span.to,
    };
  });

  // Rising error density first, then everyone else by how much data they have.
  // The point of a caseload view is to surface who to look at next, and "no
  // samples yet" is a different kind of attention from "errors are climbing".
  const rank = (s) => (s.errorRate.direction === "up" ? 0 : s.hasTrend ? 1 : 2);
  const ordered = [...students].sort(
    (a, b) => rank(a) - rank(b) || b.samples - a.samples || a.name.localeCompare(b.name),
  );

  return {
    students: ordered,
    withSamples: students.filter((s) => s.samples > 0).length,
    withTrend: students.filter((s) => s.hasTrend).length,
    rising: students.filter((s) => s.errorRate.direction === "up").length,
    totalSamples: students.reduce((sum, s) => sum + s.samples, 0),
  };
}
