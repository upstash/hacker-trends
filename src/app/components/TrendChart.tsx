"use client";

import { useMemo, useRef, useState } from "react";
import type { Bucket } from "@/lib/hn-search";
import { MIN_MS, MAX_MS, MONTH_MS, SLOTS, slotRange } from "@/lib/trend-time";

const VIEW_W = 1000;
const VIEW_H = 200;
const PAD_T = 14;
const PAD_B = 24;
const YEAR_MS = 365.25 * 24 * 3600 * 1000;

// Preset view windows. `years` is how far back from the latest data the X-axis
// starts; `null` is the full 2007→2026 span. This only reframes the *rendered*
// axis — the underlying 30-day slot grid (trend-time.ts) is untouched, so a
// click still maps to the same `?from=&to=` bucket regardless of zoom.
const WINDOWS: { label: string; years: number | null }[] = [
  { label: "All", years: null },
  { label: "10y", years: 10 },
  { label: "5y", years: 5 },
  { label: "2y", years: 2 },
  { label: "1y", years: 1 },
];

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
  /** Histograms are in flight, so show a loading state rather than the prompt. */
  loading?: boolean;
};

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

/**
 * Axis ticks that adapt to the visible span: even years when zoomed out, every
 * year mid-zoom, and YYYY-MM months once the window is a few years or less (so
 * a 1y view doesn't show a single lonely "2025" tick).
 */
function buildTicks(minMs: number, maxMs: number): { ms: number; label: string }[] {
  const years = (maxMs - minMs) / YEAR_MS;
  const ticks: { ms: number; label: string }[] = [];
  if (years > 11) {
    for (let y = 2007; ; y++) {
      const ms = Date.UTC(y, 0, 1);
      if (ms > maxMs) break;
      if (ms >= minMs && y % 2 === 0) ticks.push({ ms, label: String(y) });
    }
  } else if (years > 3.5) {
    for (let y = 2007; ; y++) {
      const ms = Date.UTC(y, 0, 1);
      if (ms > maxMs) break;
      if (ms >= minMs) ticks.push({ ms, label: String(y) });
    }
  } else {
    const months = Math.max(1, Math.round((maxMs - minMs) / MONTH_MS));
    const stride = months <= 8 ? 1 : months <= 18 ? 2 : 3;
    const d0 = new Date(minMs);
    let y = d0.getUTCFullYear();
    let m = d0.getUTCMonth() + (d0.getUTCDate() > 1 ? 1 : 0);
    while (m > 11) { m -= 12; y++; }
    for (;;) {
      const ms = Date.UTC(y, m, 1);
      if (ms > maxMs) break;
      ticks.push({ ms, label: `${y}-${String(m + 1).padStart(2, "0")}` });
      m += stride;
      while (m > 11) { m -= 12; y++; }
    }
  }
  return ticks;
}

export function TrendChart({ series, range, onSelectRange, loading }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // While the pointer is held down we track a raw [x0,x1] band in viewBox
  // units; on release it either becomes a selected range or (if it was really
  // just a click) clears the existing one.
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  // Which preset window is active (index into WINDOWS). View-only state, local
  // to the chart — it reframes the axis without changing the queried data.
  const [winIdx, setWinIdx] = useState(0);

  // The visible slot window [slotLo, SLOTS): always anchored to the latest data
  // on the right, extending `years` back on the left. Boundaries are snapped to
  // the slot grid so the x-scale and the bucket binning stay in lockstep.
  const slotLo = useMemo(() => {
    const years = WINDOWS[winIdx].years;
    if (years == null) return 0;
    const target = MAX_MS - years * YEAR_MS;
    return Math.min(SLOTS - 1, Math.max(0, Math.round((target - MIN_MS) / MONTH_MS)));
  }, [winIdx]);
  const visSlots = SLOTS - slotLo;
  const viewMinMs = MIN_MS + slotLo * MONTH_MS;
  const viewMaxMs = MIN_MS + SLOTS * MONTH_MS;

  /* ---- view-space mappings (all keyed to the current window) -------- */
  const xOf = (ms: number) => ((ms - viewMinMs) / (viewMaxMs - viewMinMs)) * VIEW_W;
  const slotCenterX = (i: number) => ((i - slotLo + 0.5) / visSlots) * VIEW_W;
  const slotLeftX = (i: number) => ((i - slotLo) / visSlots) * VIEW_W;
  const SLOT_W = VIEW_W / visSlots;
  const slotAt = (x: number) =>
    Math.max(slotLo, Math.min(SLOTS - 1, slotLo + Math.floor((x / VIEW_W) * visSlots)));

  const dense = useMemo(
    () => series.map((s) => ({ s, values: densify(s.buckets) })),
    [series],
  );

  // Peak (for Y-scaling) is taken over the *visible* slots only, so zooming into
  // a window rescales the lines to fill the height instead of staying flattened
  // against an all-time max that may sit off-screen.
  const globalMax = useMemo(() => {
    let m = 0;
    for (const d of dense)
      for (let i = slotLo; i < SLOTS; i++) if (d.values[i] > m) m = d.values[i];
    return m || 1;
  }, [dense, slotLo]);

  const yOf = (v: number) =>
    VIEW_H - PAD_B - (v / globalMax) * (VIEW_H - PAD_T - PAD_B);

  // Build the area + line path strings once per data/window change.
  const paths = useMemo(
    () =>
      dense.map(({ s, values }) => {
        const pts: string[] = [];
        for (let i = slotLo; i < SLOTS; i++) pts.push(`${slotCenterX(i)},${yOf(values[i])}`);
        const line = `M${pts.join("L")}`;
        const base = VIEW_H - PAD_B;
        const area = `M${slotCenterX(slotLo)},${base}L${pts.join("L")}L${slotCenterX(
          SLOTS - 1,
        )},${base}Z`;
        return { id: s.id, color: s.color, line, area };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dense, globalMax, slotLo],
  );

  // Highest point of each series, for the inline colored peak labels. The scan
  // is clamped to the visible window (and, if set, the selected range), so the
  // marker reports the peak you can actually see.
  const peaks = useMemo(() => {
    const lo = Math.max(
      slotLo,
      range ? Math.round((range.fromMs - MIN_MS) / MONTH_MS) : slotLo,
    );
    const hi = Math.min(
      SLOTS,
      range ? Math.round((range.toMs - MIN_MS) / MONTH_MS) : SLOTS,
    );
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
  }, [dense, globalMax, range, slotLo]);

  const hasData = dense.some((d) => d.values.some((v) => v > 0));
  const ticks = buildTicks(viewMinMs, viewMaxMs);

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
        // A plain click while a range is active just clears it, wherever you
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
      {/* Window presets: reframe the X-axis without refetching. Hidden until
          there's something to look at. */}
      {hasData && (
        <div className="win-bar">
          <span className="win-label">window</span>
          {WINDOWS.map((w, i) => (
            <button
              key={w.label}
              className="win-tab"
              data-active={winIdx === i}
              title={
                w.years == null
                  ? "show the full 2007→2026 span"
                  : `zoom to the last ${w.label}`
              }
              onClick={() => setWinIdx(i)}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="w-full block select-none trend-svg"
        style={{ touchAction: "none", cursor: hasData ? "pointer" : "default" }}
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
            month a click will filter to, so a click feels as granular as a bar.
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

        {/* baseline + adaptive ticks */}
        <line
          x1={0}
          x2={VIEW_W}
          y1={VIEW_H - PAD_B}
          y2={VIEW_H - PAD_B}
          stroke="#828282"
          vectorEffect="non-scaling-stroke"
        />
        {ticks.map((t) => {
          const x = xOf(t.ms);
          return (
            <g key={t.label}>
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
                {t.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* footer row, always present so the chart never resizes: shows the
          drag hint, or (once a range is picked) the active range + clear. */}
      <div className="px-2 pb-1 text-[10px] text-[color:var(--hn-subtle)] text-right">
        {range ? (
          <span>
            filtered to{" "}
            <strong className="text-black">
              {Math.round((range.toMs - range.fromMs) / MONTH_MS) <= 1
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
              <span className="truncate max-w-[140px]">{r.text || "-"}</span>
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
