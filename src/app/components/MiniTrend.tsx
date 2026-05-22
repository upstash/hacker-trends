"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MIN_MS, MAX_MS, MONTH_MS, SLOTS, slotOf, slotRange } from "@/lib/trend-time";

const VIEW_W = 320;
const VIEW_H = 70;
const PAD_T = 5;
const PAD_B = 6;

/** The lean monthly point the gallery plots (see examples-data MonthCount). */
type MonthBucket = { key: number; docCount: number };

export type MiniSeries = { term: string; color: string; buckets: MonthBucket[] };

type Props = {
  /** one series (single term) or several (a comparison). The title is built
   *  from these, painting each term in its own line color. */
  series: MiniSeries[];
  /** optional one-liner under the chart (the comparison story) */
  story?: string;
};

const xOf = (ms: number) => ((ms - MIN_MS) / (MAX_MS - MIN_MS)) * VIEW_W;
const slotCenterX = (i: number) => ((i + 0.5) / SLOTS) * VIEW_W;
const SLOT_W = VIEW_W / SLOTS;
const slotAtX = (x: number) =>
  Math.max(0, Math.min(SLOTS - 1, Math.floor((x / VIEW_W) * SLOTS)));

function densify(buckets: MonthBucket[]): Float64Array {
  const dense = new Float64Array(SLOTS);
  for (const b of buckets) {
    const slot = slotOf(b.key);
    if (slot >= 0 && slot < SLOTS) dense[slot] += b.docCount;
  }
  return dense;
}

/** `/?q=…(&q=…)` for these terms, with an optional selected month range. */
function viewHref(terms: string[], range?: { fromMs: number; toMs: number }): string {
  const sp = new URLSearchParams();
  for (const t of terms) sp.append("q", t);
  if (range) {
    sp.set("from", String(range.fromMs));
    sp.set("to", String(range.toMs));
  }
  return `/?${sp.toString()}`;
}

/**
 * A compact, clickable trend sparkline for the /examples gallery. Shares the
 * exact monthly time grid with the big chart (see trend-time.ts), so clicking a
 * month here lands on the main page with that same month pre-selected.
 *
 *   - click the title   → main page comparing these term(s), full history
 *   - click a month     → main page with that month's range selected
 */
export function MiniTrend({ series, story }: Props) {
  const router = useRouter();
  const terms = series.map((s) => s.term);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);

  const { dense, globalMax } = useMemo(() => {
    const dense = series.map((s) => ({ s, values: densify(s.buckets) }));
    let globalMax = 0;
    for (const d of dense) for (const v of d.values) if (v > globalMax) globalMax = v;
    return { dense, globalMax: globalMax || 1 };
  }, [series]);

  const yOf = (v: number) =>
    VIEW_H - PAD_B - (v / globalMax) * (VIEW_H - PAD_T - PAD_B);

  const paths = useMemo(
    () =>
      dense.map(({ s, values }) => {
        const pts = Array.from(values, (v, i) => `${slotCenterX(i)},${yOf(v)}`);
        const base = VIEW_H - PAD_B;
        return {
          color: s.color,
          line: `M${pts.join("L")}`,
          area: `M${slotCenterX(0)},${base}L${pts.join("L")}L${slotCenterX(SLOTS - 1)},${base}Z`,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dense, globalMax],
  );

  const hasData = dense.some((d) => d.values.some((v) => v > 0));

  const clientToView = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(VIEW_W, ((clientX - rect.left) / rect.width) * VIEW_W));
  };

  const goToMonth = (clientX: number) => {
    const slot = slotAtX(clientToView(clientX));
    router.push(viewHref(terms, slotRange(slot)));
  };

  const hoverMonth =
    hoverSlot == null ? null : new Date(MIN_MS + hoverSlot * MONTH_MS).toISOString().slice(0, 7);

  return (
    <div className="mini-trend">
      <div className="flex items-baseline justify-between gap-1.5 mb-0.5">
        <a href={viewHref(terms)} className="mini-trend-title truncate min-w-0">
          {series.length === 1 ? (
            series[0].term
          ) : (
            series.map((s, i) => (
              <span key={s.term}>
                {i > 0 && <span className="mini-trend-vs"> vs </span>}
                <span style={{ color: s.color }}>{s.term}</span>
              </span>
            ))
          )}
        </a>
        {hoverMonth && (
          <span className="mini-trend-hover tabular-nums flex-none">
            {hoverMonth}
            {dense.map(({ s, values }) => (
              <span key={s.term} style={{ color: s.color }}>
                {" "}
                {(values[hoverSlot!] ?? 0).toLocaleString()}
              </span>
            ))}
          </span>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="mini-trend-svg"
        style={{ cursor: hasData ? "crosshair" : "default" }}
        onMouseMove={(e) => setHoverSlot(slotAtX(clientToView(e.clientX)))}
        onMouseLeave={() => setHoverSlot(null)}
        onClick={(e) => hasData && goToMonth(e.clientX)}
      >
        {/* faint year guides at 2010 / 2015 / 2020 / 2025 */}
        {[2010, 2015, 2020, 2025].map((y) => {
          const x = xOf(Date.UTC(y, 0, 1));
          return (
            <line key={y} x1={x} x2={x} y1={PAD_T} y2={VIEW_H - PAD_B} stroke="#eee" vectorEffect="non-scaling-stroke" />
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
            strokeWidth={1.4}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* hover column + crosshair */}
        {hoverSlot != null && hasData && (
          <>
            <rect
              x={(hoverSlot / SLOTS) * VIEW_W}
              y={PAD_T}
              width={SLOT_W}
              height={VIEW_H - PAD_T - PAD_B}
              fill="rgba(255,102,0,0.16)"
            />
            {dense.map(({ s, values }) => (
              <circle
                key={s.term}
                cx={slotCenterX(hoverSlot)}
                cy={yOf(values[hoverSlot] ?? 0)}
                r={2.2}
                fill={s.color}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </>
        )}

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
      {story && <p className="mini-trend-story">{story}</p>}
    </div>
  );
}
