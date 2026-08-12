// The per-student error trend: one sentence of finding, then the two charts
// that support it.
//
// PS4 asks for a dashboard that visualises learner error trends, and the risk
// with any such view is that it reads as a progress score for a child. It is
// not one. Everything here describes what a set of writing samples contained,
// hedges when there is too little data to hedge less, and never puts a single
// number on the learner.

import Link from "next/link";
import { MIN_SAMPLES_FOR_TREND } from "../../lib/trends";
import { MixBand, RateLine } from "./TrendCharts";

/** The direction pill shown on a student row and beside the rate chart. */
export function TrendPill({ direction, hasTrend }) {
  if (!hasTrend || !direction) {
    return <span className="trend-pill t-none">Too few samples</span>;
  }
  // Down is green because fewer errors per 100 words is the direction teaching
  // aims at — but the wording stays about the writing, not the writer.
  const copy = {
    down: "Fewer errors",
    up: "More errors",
    flat: "Holding steady",
  };
  return <span className={`trend-pill t-${direction}`}>{copy[direction]}</span>;
}

export default function ErrorTrend({ trend, studentName }) {
  if (trend.samples === 0) {
    return (
      <section className="trend-panel" aria-label="Error trends">
        <h2>Error trends</h2>
        <p className="trend-headline">No writing samples analysed yet.</p>
        <p className="trend-caveat">
          Run {studentName ? `${studentName}'s` : "a"} writing through the{" "}
          <Link href="/analysis">error pattern analyser</Link>. Each sample adds a
          point here, and {MIN_SAMPLES_FOR_TREND} are needed before a direction
          can be read.
        </p>
      </section>
    );
  }

  const rate = trend.errorRate;

  return (
    <section className="trend-panel" aria-label="Error trends">
      <h2>Error trends</h2>
      <p className="trend-headline">{trend.headline}</p>

      {!trend.hasTrend && (
        <p className="trend-caveat">
          Drawn from {trend.samples}{" "}
          {trend.samples === 1 ? "sample" : "samples"}. The charts show what has
          been collected so far, but the difference between two samples is as
          likely to be the writing task as the writer, so no direction is
          claimed until there are {MIN_SAMPLES_FOR_TREND}.
        </p>
      )}

      <div className="trend-charts">
        <div>
          <p className="trend-chart-title">What the errors are made of</p>
          <p className="trend-chart-note">
            Each sample&apos;s errors as a share of that sample, so samples of
            different lengths can be compared. A band widening means that kind
            of error is taking up more of the total — which can happen even as
            the total falls.
          </p>
          <MixBand trend={trend} />
        </div>

        <div>
          <p className="trend-chart-title">
            How many errors <span aria-hidden="true">·</span>{" "}
            <TrendPill direction={rate.direction} hasTrend={trend.hasTrend} />
          </p>
          <p className="trend-chart-note">
            Errors per 100 words. Counted per 100 words rather than per sample
            because a longer piece of writing contains more of everything.
          </p>
          {rate.series.length ? (
            <RateLine series={rate.series} />
          ) : (
            <p className="trend-caveat">
              No sample has a recorded word count, so a rate cannot be worked
              out for these.
            </p>
          )}
        </div>
      </div>

      <p className="trend-caveat" style={{ marginTop: 16 }}>
        These are error patterns in submitted writing, not a measure of the
        student. A sample can look worse because the task was harder, the topic
        unfamiliar, or the day a bad one.
      </p>
    </section>
  );
}
