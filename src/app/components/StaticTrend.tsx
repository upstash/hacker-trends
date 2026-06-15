/**
 * A non-interactive, server-rendered trend chart for the SEO landing pages.
 *
 * Unlike <MiniTrend/> (client component, hover + click) this is plain SVG markup
 * with no "use client" - it renders fully on the server so crawlers (and no-JS
 * visitors) see the actual chart. It shares the exact monthly time grid with
 * every other chart in the app (trend-time.ts), so a landing-page line matches
 * the interactive one bar-for-bar. Used at a larger size than the gallery
 * sparkline, with year-axis labels.
 */

import { MIN_MS, MAX_MS, MONTH_MS, SLOTS, slotOf } from "@/lib/trend-time";

type MonthBucket = { key: number; docCount: number };

export type StaticSeries = {
  term: string;
  color: string;
  buckets: MonthBucket[];
};

const VIEW_W = 1000;
const VIEW_H = 240;
const PAD_T = 12;
const PAD_B = 22;

const YEAR_TICKS = [2008, 2011, 2014, 2017, 2020, 2023, 2026];

const xOfMs = (ms: number) => ((ms - MIN_MS) / (MAX_MS - MIN_MS)) * VIEW_W;
const slotCenterX = (i: number) => ((i + 0.5) / SLOTS) * VIEW_W;

function densify(buckets: MonthBucket[]): Float64Array {
  const dense = new Float64Array(SLOTS);
  for (const b of buckets) {
    const slot = slotOf(b.key);
    if (slot >= 0 && slot < SLOTS) dense[slot] += b.docCount;
  }
  return dense;
}

export function StaticTrend({ series }: { series: StaticSeries[] }) {
  const dense = series.map((s) => ({ s, values: densify(s.buckets) }));
  let globalMax = 0;
  for (const d of dense) for (const v of d.values) if (v > globalMax) globalMax = v;
  globalMax = globalMax || 1;

  const yOf = (v: number) =>
    VIEW_H - PAD_B - (v / globalMax) * (VIEW_H - PAD_T - PAD_B);

  const paths = dense.map(({ s, values }) => {
    const pts = Array.from(values, (v, i) => `${slotCenterX(i)},${yOf(v)}`);
    const base = VIEW_H - PAD_B;
    return {
      color: s.color,
      line: `M${pts.join("L")}`,
      area: `M${slotCenterX(0)},${base}L${pts.join("L")}L${slotCenterX(SLOTS - 1)},${base}Z`,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Hacker News mentions over time for ${series.map((s) => s.term).join(", ")}`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {/* year guides + labels */}
      {YEAR_TICKS.map((y) => {
        const x = xOfMs(Date.UTC(y, 0, 1));
        return (
          <g key={y}>
            <line
              x1={x}
              x2={x}
              y1={PAD_T}
              y2={VIEW_H - PAD_B}
              stroke="#e5e5df"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={x}
              y={VIEW_H - 6}
              fontSize={11}
              textAnchor="middle"
              fill="#828282"
            >
              {y}
            </text>
          </g>
        );
      })}

      {paths.map((p, i) => (
        <path key={`a${i}`} d={p.area} fill={p.color} opacity={0.12} />
      ))}
      {paths.map((p, i) => (
        <path
          key={`l${i}`}
          d={p.line}
          fill="none"
          stroke={p.color}
          strokeWidth={1.6}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* baseline */}
      <line
        x1={0}
        x2={VIEW_W}
        y1={VIEW_H - PAD_B}
        y2={VIEW_H - PAD_B}
        stroke="#cfcfcf"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
