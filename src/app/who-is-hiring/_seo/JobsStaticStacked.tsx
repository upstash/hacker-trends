/**
 * A non-interactive, server-rendered RELATIVE (100%) stacked-bar chart for the
 * "Who is hiring?" SEO landing routes.
 *
 * The crawlable counterpart to the client `JobsMiniStacked` / `JobsStackedBars`:
 * plain SVG markup with NO "use client", so Google and no-JS visitors see the
 * actual chart in the initial HTML (the whole point of the SEO reframe). It
 * draws from the EXACT same pure transforms as the interactive chart -
 * `buildColumns` walks a contiguous, gap-free calendar-month range and zero-fills
 * holes, and `columnShares` gives each month's per-series share of voice - so a
 * landing-page chart matches the live one column-for-column.
 *
 * One thin column per calendar month, segments stacked to 100% (share mode is
 * what reads as a "story" in a static image; the live chart adds the raw-count
 * toggle). Single-series pages degrade to a clean filled area under the same
 * machinery (one band that is always 100% of its column). Year ticks anchor the
 * x-axis. Rects sit edge-to-edge (no gutter) so there are no white-gap artifacts.
 */

import {
  buildColumns,
  columnShares,
  fromMonthIndex,
  type SeriesData,
} from "@/lib/jobs-trends";

const VIEW_H = 120;
const PAD_B = 16; // room for the year labels under the baseline

export function JobsStaticStacked({
  series,
  height = 220,
}: {
  series: SeriesData[];
  height?: number;
}) {
  // Always draw the full history (window "all") - the landing chart is the
  // whole story, not a windowed view.
  const columns = buildColumns(series, "all");
  const W = Math.max(1, columns.length);

  // For a single-series page show the absolute monthly volume (a filled area is
  // more honest than a flat 100% band); for a multi-series comparison show the
  // relative 100% stack (the "who leads" story). Detect by series count.
  const relative = series.length > 1;

  // Absolute-mode scaling: the tallest month's total sets the top of the plot.
  let globalMax = 1;
  if (!relative) {
    for (const col of columns) if (col.total > globalMax) globalMax = col.total;
  }

  const plotH = VIEW_H - PAD_B;

  const rects: { x: number; y: number; h: number; color: string }[] = [];
  columns.forEach((col, ci) => {
    if (col.total <= 0) return;
    if (relative) {
      const shares = columnShares(col);
      let acc = 0;
      for (let si = 0; si < series.length; si++) {
        const share = shares[si] ?? 0;
        if (share <= 0) continue;
        const h = share * plotH;
        rects.push({ x: ci, y: plotH - acc - h, h, color: series[si].color });
        acc += h;
      }
    } else {
      const h = (col.total / globalMax) * plotH;
      rects.push({ x: ci, y: plotH - h, h, color: series[0].color });
    }
  });

  // Year ticks: the first column of each January in range, labelled with the
  // year. Derived from the contiguous column list so they always line up.
  const yearTicks: { x: number; year: number }[] = [];
  columns.forEach((col, ci) => {
    const { year, month } = fromMonthIndex(col.idx);
    if (month === 0) yearTicks.push({ x: ci, year });
  });
  // Thin the labels so they don't collide on a narrow column (every 2-3 years).
  const step = yearTicks.length > 9 ? 3 : yearTicks.length > 6 ? 2 : 1;

  const hasData = rects.length > 0;
  const label = relative
    ? `Relative share of Hacker News "Who is hiring?" postings: ${series
        .map((s) => s.label)
        .join(" vs ")}`
    : `Monthly Hacker News "Who is hiring?" postings mentioning ${series[0]?.label}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${VIEW_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      style={{ width: "100%", height, display: "block" }}
    >
      {/* year guides + labels */}
      {yearTicks.map((t, i) =>
        i % step === 0 ? (
          <g key={t.year}>
            <line
              x1={t.x}
              x2={t.x}
              y1={0}
              y2={plotH}
              stroke="#e5e5df"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={t.x}
              y={VIEW_H - 4}
              fontSize={8}
              textAnchor="middle"
              fill="#828282"
              vectorEffect="non-scaling-stroke"
            >
              {t.year}
            </text>
          </g>
        ) : null,
      )}

      {hasData ? (
        rects.map((r, i) => (
          // width 1 (one column unit) + a hair of overlap kills the sub-pixel
          // seams that show as faint white gaps when the SVG is stretched.
          <rect key={i} x={r.x} y={r.y} width={1.02} height={r.h} fill={r.color} />
        ))
      ) : (
        <line
          x1={0}
          x2={W}
          y1={plotH - 0.5}
          y2={plotH - 0.5}
          stroke="#cfcfcf"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* baseline */}
      <line
        x1={0}
        x2={W}
        y1={plotH}
        y2={plotH}
        stroke="#cfcfcf"
        strokeWidth={0.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
