// Hand-rolled SVG for the learner error-trend charts.
//
// No charting library. Three shapes are needed — a stacked share band, a line,
// and a sparkline — over at most a dozen points, and the arithmetic for that is
// shorter than the configuration object a library would need. It also keeps
// these as server components: the charts arrive in the HTML, so a page of them
// costs no client JavaScript and shows up before hydration.
//
// Colour comes from the --cat-* tokens, which are the same values the report's
// category chips use. Nothing here invents a colour.
//
// X AXIS: samples are spaced evenly by their order, not by their date. Writing
// samples arrive whenever a session happens — three in a week, then nothing for
// a month — and a true time axis spends most of its width on the gaps and
// crushes the samples into an unreadable cluster. The question these charts
// answer is "what changed from one sample to the next", which is ordinal. Dates
// are printed under the first and last points so the real span stays visible.

const MIX = { w: 720, h: 200, left: 40, right: 12, top: 10, bottom: 28 };
const RATE = { w: 720, h: 168, left: 42, right: 12, top: 12, bottom: 28 };

/** Evenly spaced x for point i of n, centred when there is only one. */
function xFor(i, n, box) {
  const plot = box.w - box.left - box.right;
  if (n <= 1) return box.left + plot / 2;
  return box.left + (i / (n - 1)) * plot;
}

function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The category mix over time, as a stacked band summing to 100% per sample.
 *
 * Stacked rather than a set of overlaid lines because the quantity IS a
 * composition — the shares of one sample necessarily total one — and a stack
 * shows that constraint where seven crossing lines would just look like noise.
 */
export function MixBand({ trend }) {
  const { points, categories } = trend;
  const n = points.length;
  if (!n || !categories.length) return null;

  const plotH = MIX.h - MIX.top - MIX.bottom;
  const y = (value) => MIX.top + (1 - value) * plotH;

  // Running cumulative per point, so each band starts where the last one ended.
  const bottoms = new Array(n).fill(0);

  const bands = categories.map((category) => {
    const tops = category.series.map((s, i) => bottoms[i] + s.share);
    const top = tops.map((v, i) => `${xFor(i, n, MIX)},${y(v)}`);
    const base = bottoms.map((v, i) => `${xFor(i, n, MIX)},${y(v)}`).reverse();

    // A single sample has no width to fill, so it is drawn as a short bar
    // rather than a degenerate zero-width polygon.
    const shape =
      n === 1
        ? `${xFor(0, n, MIX) - 40},${y(tops[0])} ${xFor(0, n, MIX) + 40},${y(tops[0])} ${xFor(0, n, MIX) + 40},${y(bottoms[0])} ${xFor(0, n, MIX) - 40},${y(bottoms[0])}`
        : [...top, ...base].join(" ");

    for (let i = 0; i < n; i += 1) bottoms[i] = tops[i];
    return { key: category.key, label: category.label, shape };
  });

  return (
    <figure className="chart">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${MIX.w} ${MIX.h}`}
        role="img"
        aria-label={`Share of each error category across ${n} ${n === 1 ? "sample" : "samples"}, oldest on the left. ${categories
          .map((c) => `${c.label} ${Math.round((c.last ?? 0) * 100)}% in the latest sample`)
          .join(", ")}.`}
      >
        {/* Quarter lines. Drawn under the bands and kept faint: they are there
            to let someone read "about half" off the chart, not to be looked at. */}
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line
              x1={MIX.left}
              x2={MIX.w - MIX.right}
              y1={y(tick)}
              y2={y(tick)}
              className="chart-grid"
            />
            <text x={MIX.left - 8} y={y(tick) + 4} className="chart-axis" textAnchor="end">
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}

        {bands.map((band) => (
          <polygon
            key={band.key}
            points={band.shape}
            style={{ fill: `var(--cat-${band.key}, var(--flag-weak))` }}
            className="chart-band"
          >
            <title>{band.label}</title>
          </polygon>
        ))}

        {/* Sample markers, so it reads as five measurements rather than a
            continuous recording of something. */}
        {points.map((point, i) => (
          <line
            key={point.id ?? i}
            x1={xFor(i, n, MIX)}
            x2={xFor(i, n, MIX)}
            y1={MIX.top}
            y2={MIX.top + plotH}
            className="chart-tick"
          />
        ))}

        <text x={MIX.left} y={MIX.h - 8} className="chart-axis">
          {shortDate(points[0]?.at)}
        </text>
        {n > 1 && (
          <text x={MIX.w - MIX.right} y={MIX.h - 8} className="chart-axis" textAnchor="end">
            {shortDate(points[n - 1]?.at)}
          </text>
        )}
      </svg>

      {/* The legend carries the current percentages, which makes it the
          non-visual route to the same finding rather than a colour key. */}
      <ul className="chart-legend">
        {categories.map((category) => (
          <li key={category.key}>
            <span
              className="chart-swatch"
              style={{ background: `var(--cat-${category.key}, var(--flag-weak))` }}
              aria-hidden="true"
            />
            <span className="chart-legend-label">{category.label}</span>
            <span className="chart-legend-value">
              {Math.round((category.last ?? 0) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * Errors per 100 words, sample by sample.
 *
 * The y axis starts at zero deliberately. Cropping it would make a drift of
 * one error per 100 words look like a collapse, and this chart gets shown to
 * parents.
 */
export function RateLine({ series }) {
  const n = series.length;
  if (!n) return null;

  const plotH = RATE.h - RATE.top - RATE.bottom;
  const peak = Math.max(...series.map((s) => s.value), 0);
  // Never let the top of the scale be zero, and leave headroom so the highest
  // point does not sit on the frame.
  const max = peak > 0 ? peak * 1.15 : 5;
  const y = (value) => RATE.top + (1 - value / max) * plotH;

  const path = series.map((s, i) => `${xFor(i, n, RATE)},${y(s.value)}`).join(" ");
  const lastX = xFor(n - 1, n, RATE);
  const lastY = y(series[n - 1].value);

  return (
    <figure className="chart">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${RATE.w} ${RATE.h}`}
        role="img"
        aria-label={`Errors per 100 words across ${n} ${
          n === 1 ? "sample" : "samples"
        }, oldest first: ${series.map((s) => s.value).join(", ")}.`}
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={RATE.left}
              x2={RATE.w - RATE.right}
              y1={RATE.top + (1 - fraction) * plotH}
              y2={RATE.top + (1 - fraction) * plotH}
              className="chart-grid"
            />
            <text
              x={RATE.left - 8}
              y={RATE.top + (1 - fraction) * plotH + 4}
              className="chart-axis"
              textAnchor="end"
            >
              {Math.round(max * fraction)}
            </text>
          </g>
        ))}

        {n > 1 && <polyline points={path} className="chart-line" />}

        {series.map((s, i) => (
          <circle
            key={s.at ?? i}
            cx={xFor(i, n, RATE)}
            cy={y(s.value)}
            r={i === n - 1 ? 5 : 3.5}
            className={i === n - 1 ? "chart-dot chart-dot-last" : "chart-dot"}
          >
            <title>{`${s.value} per 100 words · ${shortDate(s.at)}`}</title>
          </circle>
        ))}

        {/* The latest reading is the one people came for, so it is the only
            value written on the plot. */}
        <text
          x={lastX - 8}
          y={lastY - 12}
          className="chart-value"
          textAnchor={n > 1 ? "end" : "middle"}
        >
          {series[n - 1].value}
        </text>

        <text x={RATE.left} y={RATE.h - 8} className="chart-axis">
          {shortDate(series[0]?.at)}
        </text>
        {n > 1 && (
          <text x={RATE.w - RATE.right} y={RATE.h - 8} className="chart-axis" textAnchor="end">
            {shortDate(series[n - 1]?.at)}
          </text>
        )}
      </svg>
    </figure>
  );
}

/**
 * A caseload-row sparkline: shape only, no axis.
 *
 * Scaled to its own series, so it says "this learner's direction" and nothing
 * about how they compare to the next row. The number beside it in the table is
 * what carries the magnitude.
 */
export function Sparkline({ values, label }) {
  if (!values?.length) return null;
  const w = 88;
  const h = 24;
  const pad = 3;

  const peak = Math.max(...values);
  const floor = Math.min(...values);
  const range = peak - floor || 1;
  const x = (i) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - pad * 2) + pad);
  const y = (v) => pad + (1 - (v - floor) / range) * (h - pad * 2);

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label ?? `Trend: ${values.join(", ")}`}
    >
      {values.length > 1 && (
        <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} className="chart-line" />
      )}
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" className="chart-dot-last" />
    </svg>
  );
}
