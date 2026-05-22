"use client";

import { useMemo, useRef, useState } from "react";
import type { Bucket } from "@/lib/hn-search";
import { MIN_MS, MAX_MS, MONTH_MS, SLOTS, slotRange } from "@/lib/trend-time";

const VIEW_W = 1000;
const VIEW_H = 200;
const PAD_T = 14;
const PAD_B = 24;

export type Series = {
  id: string;
  text: string;
  color: string;
  buckets: Bucket[];
};

export type Range = { fromMs: number; toMs: number };

type Props = {
  series: Series[];
  range: Range | null;
  onSelectRange: (r: Range | null) => void;
  /** Histograms are in flight — show a loading state rather than the prompt. */
  loading?: boolean;
};

/** ms → x in viewBox units. */
function xOf(ms: number): number {
  return ((ms - MIN_MS) / (MAX_MS - MIN_MS)) * VIEW_W;
}

/**
 * Bin a series' sparse buckets into one dense value-per-slot array so each line
 * spans the full 18-year timeline, sitting at 0 where the term had no posts.
 * Without this, a term like "clubhouse" (only ~2020-21) would draw a line that
 * floats in mid-chart instead of rising from and returning to the baseline.
 */
function densify(buckets: Bucket[]): Float64Array {
  const dense = new Float64Array(SLOTS);
  for (const b of buckets) {
    const slot = Math.round((b.key - MIN_MS) / MONTH_MS);
    if (slot >= 0 && slot < SLOTS) dense[slot] += b.docCount;
  }
  return dense;
}

const slotCenterX = (i: number) => ((i + 0.5) / SLOTS) * VIEW_W;
const slotLeftX = (i: number) => (i / SLOTS) * VIEW_W;
const SLOT_W = VIEW_W / SLOTS;

/** x (viewBox units) → the slot index it falls in. */
const slotAt = (x: number) =>
  Math.max(0, Math.min(SLOTS - 1, Math.floor((x / VIEW_W) * SLOTS)));

/** How many slots a committed range spans (1 == a single clicked month). */
const rangeSlotSpan = (r: Range) => Math.round((r.toMs - r.fromMs) / MONTH_MS);

export function TrendChart({ series, range, onSelectRange, loading }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // While the pointer is held down we track a raw [x0,x1] band in viewBox
  // units; on release it either becomes a selected range or (if it was really
  // just a click) clears the existing one.
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const { dense, globalMax } = useMemo(() => {
    const dense = series.map((s) => ({ s, values: densify(s.buckets) }));
    let globalMax = 0;
    for (const d of dense)
      for (const v of d.values) if (v > globalMax) globalMax = v;
    return { dense, globalMax: globalMax || 1 };
  }, [series]);

  const yOf = (v: number) =>
    VIEW_H - PAD_B - (v / globalMax) * (VIEW_H - PAD_T - PAD_B);

  // Build the area + line path strings once per data change.
  const paths = useMemo(
    () =>
      dense.map(({ s, values }) => {
        const pts = Array.from(values, (v, i) => `${slotCenterX(i)},${yOf(v)}`);
        const line = `M${pts.join("L")}`;
        const base = VIEW_H - PAD_B;
        const area = `M${slotCenterX(0)},${base}L${pts.join("L")}L${slotCenterX(
          SLOTS - 1,
        )},${base}Z`;
        return { id: s.id, color: s.color, line, area };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dense, globalMax],
  );

  // Highest point of each series, for the inline colored peak labels. When a
  // range is selected we scan only the slots inside it, so the marker reports
  // the peak *within the filtered window* rather than the all-time high.
  const peaks = useMemo(() => {
    const lo = range
      ? Math.max(0, Math.round((range.fromMs - MIN_MS) / MONTH_MS))
      : 0;
    const hi = range
      ? Math.min(SLOTS, Math.round((range.toMs - MIN_MS) / MONTH_MS))
      : SLOTS;
    return dense
      .map(({ s, values }) => {
        let mi = lo;
        let mv = 0;
        for (let i = lo; i < hi; i++)
          if (values[i] > mv) {
            mv = values[i];
            mi = i;
          }
        return { id: s.id, color: s.color, value: mv, x: slotCenterX(mi), y: yOf(mv) };
      })
      .filter((p) => p.value > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dense, globalMax, range]);

  const hasData = dense.some((d) => d.values.some((v) => v > 0));

  /* ---- pointer geometry -------------------------------------------- */
  const clientToView = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(VIEW_W, ((clientX - rect.left) / rect.width) * VIEW_W));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const x = clientToView(e.clientX);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ x0: x, x1: x });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const x = clientToView(e.clientX);
    setHoverX(x);
    setDrag((d) => (d ? { ...d, x1: x } : d));
  };
  const onPointerUp = () => {
    if (drag) {
      const lo = Math.min(drag.x0, drag.x1);
      const hi = Math.max(drag.x0, drag.x1);
      if (hi - lo > SLOT_W) {
        // A real drag → snap the band out to whole-month boundaries so the
        // filtered window lines up with the bars it covers. A drag always
        // (re)selects, replacing any existing range.
        const loSlot = slotAt(lo);
        const hiSlot = slotAt(hi);
        onSelectRange({ ...slotRange(loSlot), toMs: slotRange(hiSlot).toMs });
      } else if (range) {
        // A plain click while a range is active just clears it — wherever you
        // clicked. (The next click, with no range set, will select a month.)
        onSelectRange(null);
      } else {
        // A plain click with nothing selected → filter to the month under the
        // pointer.
        onSelectRange(slotRange(slotAt(drag.x1)));
      }
    }
    setDrag(null);
  };

  /* ---- hover tooltip data ------------------------------------------ */
  const hoverSlot = hoverX == null ? null : slotAt(hoverX);
  const tooltip =
    hoverSlot == null
      ? null
      : {
          xPct: (slotCenterX(hoverSlot) / VIEW_W) * 100,
          label: new Date(MIN_MS + hoverSlot * MONTH_MS).toISOString().slice(0, 7),
          rows: dense.map(({ s, values }) => ({
            color: s.color,
            text: s.text,
            count: values[hoverSlot] ?? 0,
          })),
        };

  // Live selection band: prefer the in-progress drag, fall back to committed.
  const band = drag
    ? { lo: Math.min(drag.x0, drag.x1), hi: Math.max(drag.x0, drag.x1) }
    : range
      ? { lo: xOf(range.fromMs), hi: xOf(range.toMs) }
      : null;

  return (
    <div className="trend-chart relative border border-[color:var(--hn-subtle)] bg-white">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="w-full block select-none"
        style={{ height: 220, touchAction: "none", cursor: hasData ? "pointer" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHoverX(null);
        }}
      >
        {/* horizontal gridlines at 0/50/100% of peak */}
        {[0, 0.5, 1].map((f) => {
          const y = VIEW_H - PAD_B - f * (VIEW_H - PAD_T - PAD_B);
          return (
            <line
              key={f}
              x1={0}
              x2={VIEW_W}
              y1={y}
              y2={y}
              stroke="#ececec"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {/* selection band */}
        {band && band.hi - band.lo > 0.5 && (
          <>
            <rect
              x={band.lo}
              y={PAD_T}
              width={band.hi - band.lo}
              height={VIEW_H - PAD_T - PAD_B}
              fill="rgba(255,102,0,0.10)"
            />
            {[band.lo, band.hi].map((bx, i) => (
              <line
                key={i}
                x1={bx}
                x2={bx}
                y1={PAD_T}
                y2={VIEW_H - PAD_B}
                stroke="var(--hn-orange)"
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </>
        )}

        {/* area fills (under), then lines (over) */}
        {paths.map((p) => (
          <path key={`a-${p.id}`} d={p.area} fill={p.color} opacity={0.12} />
        ))}
        {paths.map((p) => (
          <path
            key={`l-${p.id}`}
            d={p.line}
            fill="none"
            stroke={p.color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* per-series peak markers (colored, sitting on each line's apex) */}
        {hasData &&
          !drag &&
          peaks.map((p) => {
            const tx = Math.max(60, Math.min(VIEW_W - 60, p.x));
            const labelY = p.y - 7 < 12 ? p.y + 14 : p.y - 7;
            return (
              <g key={`pk-${p.id}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={2.6}
                  fill={p.color}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={tx}
                  y={labelY}
                  fontSize="10"
                  fontWeight="700"
                  fill={p.color}
                  textAnchor="middle"
                  fontFamily="Verdana, Geneva, sans-serif"
                  style={{ paintOrder: "stroke" }}
                  stroke="#fff"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                >
                  {p.value.toLocaleString()} posts
                </text>
              </g>
            );
          })}

        {/* hover crosshair + per-series dots. The shaded column marks the exact
            month a click will filter to — so a click feels as granular as a bar.
            It's hidden while a range is selected, since a click then clears the
            range rather than picking that month (so the highlight would lie). */}
        {hoverSlot != null && hasData && !drag && (
          <>
            {!range && (
              <rect
                x={slotLeftX(hoverSlot)}
                y={PAD_T}
                width={SLOT_W}
                height={VIEW_H - PAD_T - PAD_B}
                fill="rgba(255,102,0,0.14)"
              />
            )}
            <line
              x1={slotCenterX(hoverSlot)}
              x2={slotCenterX(hoverSlot)}
              y1={PAD_T}
              y2={VIEW_H - PAD_B}
              stroke="#bbb"
              vectorEffect="non-scaling-stroke"
            />
            {dense.map(({ s, values }) => (
              <circle
                key={`dot-${s.id}`}
                cx={slotCenterX(hoverSlot)}
                cy={yOf(values[hoverSlot] ?? 0)}
                r={3}
                fill={s.color}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </>
        )}

        {/* baseline + year ticks */}
        <line
          x1={0}
          x2={VIEW_W}
          y1={VIEW_H - PAD_B}
          y2={VIEW_H - PAD_B}
          stroke="#828282"
          vectorEffect="non-scaling-stroke"
        />
        {Array.from({ length: 21 }).map((_, i) => {
          const year = 2007 + i;
          const ms = Date.UTC(year, 0, 1);
          if (ms > MAX_MS || year % 2 !== 0) return null;
          const x = xOf(ms);
          return (
            <g key={year}>
              <line
                x1={x}
                x2={x}
                y1={VIEW_H - PAD_B}
                y2={VIEW_H - PAD_B + 4}
                stroke="#828282"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={x}
                y={VIEW_H - 6}
                fontSize="9"
                fill="#828282"
                textAnchor="middle"
                fontFamily="Verdana, Geneva, sans-serif"
              >
                {year}
              </text>
            </g>
          );
        })}
      </svg>

      {/* footer row — always present so the chart never resizes: shows the
          drag hint, or (once a range is picked) the active range + clear. */}
      <div className="px-2 pb-1 text-[10px] text-[color:var(--hn-subtle)] text-right">
        {range ? (
          <span>
            filtered to{" "}
            <strong className="text-black">
              {rangeSlotSpan(range) <= 1
                ? new Date(range.fromMs).toISOString().slice(0, 7)
                : `${new Date(range.fromMs).toISOString().slice(0, 7)} → ${new Date(
                    range.toMs - 1,
                  )
                    .toISOString()
                    .slice(0, 7)}`}
            </strong>{" "}
            ·{" "}
            <button className="underline" onClick={() => onSelectRange(null)}>
              clear
            </button>
          </span>
        ) : (
          "click a month to filter, or drag across to pick a range"
        )}
      </div>

      {!hasData && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[color:var(--hn-subtle)] text-sm">
          {loading
            ? "loading…"
            : "type a term above to chart its traction on Hacker News"}
        </div>
      )}

      {tooltip && hasData && !drag && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 bg-black text-white text-[10px] leading-tight px-2 py-1 whitespace-nowrap z-10"
          style={{
            left: `${Math.min(88, Math.max(12, tooltip.xPct))}%`,
            bottom: 30,
            fontFamily: "Verdana, Geneva, sans-serif",
          }}
        >
          <div className="opacity-70 mb-0.5">{tooltip.label}</div>
          {tooltip.rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span
                className="inline-block"
                style={{ width: 7, height: 7, background: r.color }}
              />
              <span className="truncate max-w-[140px]">{r.text || "—"}</span>
              <span className="ml-auto tabular-nums">
                {r.count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
