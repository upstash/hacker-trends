"use client";

/**
 * A compact RELATIVE (100%) stacked-bar mini chart for the gallery cards,
 * matching the big chart's look. One thin column per calendar month; each
 * column is normalized so its segments are that month's shares of voice. SVG
 * rects keep it cheap across many cards.
 *
 * GAP-FREE: it draws from the SAME pure transforms as the big chart -
 * `buildColumns(..., dropEmpty=true)` walks a contiguous month range, zero-fills
 * holes AND then drops any zero-total month (share-% style). The rects also
 * OVERLAP a hair (a full unit to the right, an epsilon down) and use
 * `shapeRendering="crispEdges"`, so no thin white sub-pixel seam shows between
 * stretched bars (the 30d-bucket vs calendar-month drift the PRD calls out, plus
 * the device-pixel rounding hairline). Because empty months are removed from the
 * column set, the viewBox simply compacts past them rather than leaving a sliver
 * of white.
 *
 * HOVERABLE: pointer-move over the chart resolves the hovered column and reports
 * term / year / month / count for the dominant band there, which the card paints
 * in its top-right readout. Clicking loads the card's terms into the big chart.
 */

import { memo, useMemo, useState } from "react";
import {
  buildColumns,
  columnShares,
  fromMonthIndex,
  type SeriesData,
} from "@/lib/jobs-trends";

const VIEW_H = 100;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** What the parent card paints in its top-right corner for the hovered column. */
export type MiniHover = {
  /** the dominant band's series label at the hovered month. */
  term: string;
  color: string;
  year: number;
  /** 0-based month. */
  month: number;
  /** that band's raw posting count for the month. */
  count: number;
};

type Props = {
  series: SeriesData[];
  /** report the hovered column (or null on leave) so the card can show a readout. */
  onHover?: (h: MiniHover | null) => void;
  /** report height so the card can reserve it; defaults to a compact 48px. */
  height?: number;
};

export const JobsMiniStacked = memo(function JobsMiniStacked({
  series,
  onHover,
  height = 48,
}: Props) {
  // Always draw the full history (window "all"); the card is a thumbnail. These
  // mini charts are share-% style, so `dropEmpty=true` removes zero-total months
  // entirely (the axis compacts past them, no white gap).
  const columns = useMemo(() => buildColumns(series, "all", true), [series]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // viewBox width = number of columns; each column occupies exactly 1 user unit
  // on the x-grid but is drawn with a full-unit overlap to the right (see the
  // rect width below) so adjacent bars share no sub-pixel seam after the
  // `preserveAspectRatio="none"` horizontal stretch - no faint white gaps.
  const W = Math.max(1, columns.length);

  // A small vertical bleed (user units; VIEW_H = 100) so each segment extends
  // down into the one stacked below it, covering the horizontal sub-pixel seam.
  const EPS_Y = 0.6;

  const rects = useMemo(() => {
    const out: { x: number; y: number; h: number; color: string }[] = [];
    columns.forEach((col, ci) => {
      if (col.total <= 0) return;
      const shares = columnShares(col);
      let acc = 0;
      for (let si = 0; si < series.length; si++) {
        const share = shares[si] ?? 0;
        if (share <= 0) continue;
        const h = share * VIEW_H;
        out.push({
          x: ci,
          y: VIEW_H - acc - h,
          // bleed down to cover the seam to the segment below (except the
          // bottom-most, which would poke past the baseline).
          h: acc > 0 ? h + EPS_Y : h,
          color: series[si].color,
        });
        acc += h;
      }
    });
    return out;
  }, [columns, series]);

  const hasData = rects.length > 0;

  /** Resolve the hovered column from the pointer's x within the SVG box. */
  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onHover || columns.length === 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - box.left) / box.width;
    const ci = Math.max(0, Math.min(columns.length - 1, Math.floor(frac * columns.length)));
    setHoverIdx(ci);
    const col = columns[ci];
    if (!col || col.total <= 0) {
      onHover(null);
      return;
    }
    // The dominant band at this month is the most-informative readout.
    let bestSi = 0;
    let bestVal = -1;
    for (let si = 0; si < series.length; si++) {
      if (col.values[si] > bestVal) {
        bestVal = col.values[si];
        bestSi = si;
      }
    }
    const { year, month } = fromMonthIndex(col.idx);
    onHover({
      term: series[bestSi].label,
      color: series[bestSi].color,
      year,
      month,
      count: col.values[bestSi],
    });
  };

  const handleLeave = () => {
    setHoverIdx(null);
    onHover?.(null);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="mini-trend-svg"
      style={{ height }}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      {hasData ? (
        <>
          {rects.map((r, i) => (
            // Each column is 1 unit wide but drawn 2 units (a full unit of
            // overlap to the RIGHT) so it physically covers the vertical seam to
            // its neighbour; the next column paints over the overlap, so no color
            // distortion (the last column clamps to 1 to stay in the box). With
            // `preserveAspectRatio="none"` the x-axis is the stretched one, so a
            // full-unit overlap is what reliably hides the seam. `crispEdges`
            // kills anti-aliased fuzz on these axis-aligned bars.
            <rect
              key={i}
              x={r.x}
              y={r.y}
              width={r.x < W - 1 ? 2 : 1}
              height={r.h}
              fill={r.color}
              shapeRendering="crispEdges"
            />
          ))}
          {hoverIdx != null && (
            // The hover outline stays exactly one column wide and anti-aliased
            // (non-scaling stroke), unlike the crisp-edged bars beneath it.
            <rect
              x={hoverIdx}
              y={0}
              width={1}
              height={VIEW_H}
              fill="none"
              stroke="#000"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </>
      ) : (
        <line
          x1={0}
          x2={W}
          y1={VIEW_H - 0.5}
          y2={VIEW_H - 0.5}
          stroke="#cfcfcf"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
});

/** Format a hover readout as `term · Mon YYYY · N` for the card corner. */
export function formatMiniHover(h: MiniHover): string {
  return `${h.term} · ${MONTHS[h.month]} ${h.year} · ${h.count.toLocaleString()}`;
}
