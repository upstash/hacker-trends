"use client";

/**
 * The centerpiece: one stacked bar PER CALENDAR MONTH across the whole history.
 *
 * RELATIVE (100% share-of-voice) by default - every non-empty month's bar is
 * full height and each segment is that term's share of the month; the `count`
 * toggle switches the OUTER bar height to raw postings while keeping the same
 * inner proportions. Window presets (all / 10y / 5y / 1y, top-right) reframe the
 * x-axis, anchored to the latest data month. No x-axis labels, no range-drag.
 *
 * GAP-FREE: columns come from `buildColumns`, which walks a contiguous month
 * range and zero-fills holes, and the bar row uses `gap: 0` with full-width
 * adjacent columns - so there are NO white gaps between bars (the artifact the
 * PRD calls out, rooted in 30d-bucket vs calendar-month drift). In SHARE % mode
 * we go one step further and DROP zero-total months entirely (`dropEmpty`): a
 * month with no postings carries no proportion to show, so rather than leave a
 * white sliver the axis simply compacts past it. COUNT mode keeps every month
 * (a genuinely low/zero bar is honest there).
 *
 * BARS ARE STATIC: every column is the same width and (in share mode) the same
 * full height; there is no hover zoom/magnification. Hover affordance is pure
 * CSS (`.jobs-seg:hover`): the row dims and the hovered slice brightens with a
 * soft inset light ring (no black border, no reflow). The clicked slice LATCHES
 * (a steadier ring + soft glow via `data-latched`) so the bucket you drilled
 * into stays obvious after the cursor leaves; hover-OFF fades back via a CSS
 * transition (no per-frame JS). A debounced hover + click streams that segment's
 * postings into the drill-down panel below.
 *
 * The in-progress current month is drawn in the pale tint (its thread is still
 * collecting postings), so a low count reads as "so far" rather than a cliff.
 * Segments are focusable buttons: Tab to one to preview it, Enter/Space pins it.
 *
 * GAP-FREE rendering also covers sub-pixel seams: each segment carries an inline
 * same-color `box-shadow` half-pixel bleed and the row is on its own
 * (`translateZ(0)`) layer, so no thin white hairlines show between adjacent bars
 * at common zoom levels.
 */

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  buildColumns,
  columnShares,
  paleColor,
  type SeriesData,
  type WindowKey,
} from "@/lib/jobs-trends";

const WINDOWS: WindowKey[] = ["all", "10y", "5y", "1y"];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const NARROW = "(max-width: 640px)";
const subscribeNarrow = (cb: () => void) => {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** The chart window: the user's pick, else a default that fits the screen
 *  ("all" draws ~190 ~2px columns on a phone, so narrow screens open on 5y).
 *  The server renders "all"; a phone switches right after hydration. */
export function useChartWindow(): [WindowKey, (w: WindowKey) => void] {
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
  const [picked, setPicked] = useState<WindowKey | null>(null);
  return [picked ?? (narrow ? "5y" : "all"), setPicked];
}

/** What a hovered/clicked segment hands back to the drill-down (T09/T10). */
export type SegmentHit = {
  series: SeriesData;
  seriesIndex: number;
  fromMs: number;
  toMs: number;
  year: number;
  /** 0-based month. */
  month: number;
  /** this term's posting count for this month (the segment's raw value). The
   *  drill-down header shows it next to the term/month label. */
  value: number;
};

/** Identifies the one pinned (clicked) segment so it can keep the latched style
 *  after the cursor leaves. Matched by series index + calendar month. */
export type LatchKey = {
  seriesIndex: number;
  year: number;
  /** 0-based month. */
  month: number;
};

type Props = {
  series: SeriesData[];
  windowKey: WindowKey;
  onWindow: (w: WindowKey) => void;
  normalized: boolean;
  onToggleNormalized: (v: boolean) => void;
  /** Hide the share%/count toggle entirely. Used on a SINGLE-term landing page
   *  where "share of voice" is always a flat 100% band (meaningless with one
   *  series), so the chart shows raw counts only and drops the toggle. */
  hideShareToggle?: boolean;
  /** Render a year-tick x-axis under the bars. Opt-in so only the main
   *  who-is-hiring chart gets it (the small landing/example charts stay bare). */
  showYearAxis?: boolean;
  onHover?: (hit: SegmentHit) => void;
  onSelect?: (hit: SegmentHit) => void;
  /** Optionally drive the latched/pinned segment from the parent (it already
   *  owns the drill-down selection). When omitted, the chart latches the segment
   *  the user last clicked, internally - so the pinned style works with no
   *  caller changes. */
  selected?: LatchKey | null;
  loading?: boolean;
  /** friendly message when some or all series failed to load. */
  error?: string | null;
  onRetry?: () => void;
  /** the "now" that decides which month is in progress. A server-rendered chart
   *  passes its render time so the client hydrates the same pale month. */
  nowMs?: number;
  height?: number;
};

function JobsStackedBarsInner({
  series,
  windowKey,
  onWindow,
  normalized,
  onToggleNormalized,
  hideShareToggle,
  showYearAxis,
  onHover,
  onSelect,
  selected,
  loading,
  error,
  onRetry,
  nowMs,
  height = 380,
}: Props) {
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Internal latch fallback: the segment the user last clicked. The parent may
  // instead drive `selected` (it owns the drill-down selection); when it does we
  // defer to that, otherwise we paint our own clicked segment as pinned.
  const [clicked, setClicked] = useState<LatchKey | null>(null);
  const latched = selected !== undefined ? selected : clicked;

  // Bin once per (series, window, mode) change. In SHARE % mode we drop empty
  // months so the axis compacts past them; COUNT keeps every month.
  const columns = useMemo(
    () => buildColumns(series, windowKey, normalized, nowMs),
    [series, windowKey, normalized, nowMs],
  );
  const maxTotal = useMemo(
    () => Math.max(1, ...columns.map((c) => c.total)),
    [columns],
  );
  const anyData = useMemo(() => columns.some((c) => c.total > 0), [columns]);

  // Year-tick x-axis (opt-in via `showYearAxis`). Mark the FIRST column of each
  // calendar year as a tick, then thin to at most ~12 labels so the longest
  // window ("all", ~15 years) and a narrow phone never crowd. Each kept index
  // gets a left-aligned year label in a row that mirrors the bar columns 1:1.
  const yearTicks = useMemo(() => {
    const starts: number[] = [];
    columns.forEach((c, ci) => {
      if (ci === 0 || columns[ci - 1].year !== c.year) starts.push(ci);
    });
    const stride = Math.max(1, Math.ceil(starts.length / 12));
    const show = new Set<number>();
    starts.forEach((ci, i) => {
      if (i % stride === 0) show.add(ci);
    });
    return show;
  }, [columns]);

  const hitFor = (ci: number, si: number): SegmentHit => {
    const c = columns[ci];
    return {
      series: series[si],
      seriesIndex: si,
      fromMs: c.fromMs,
      toMs: c.toMs,
      year: c.year,
      month: c.month,
      value: c.values[si] ?? 0,
    };
  };

  const select = (hit: SegmentHit) => {
    // Only self-latch when the parent isn't driving it.
    if (selected === undefined) {
      setClicked({ seriesIndex: hit.seriesIndex, year: hit.year, month: hit.month });
    }
    onSelect?.(hit);
  };

  const errorNote = error ? (
    <span className="text-red-600">
      {error}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-1 underline">
          retry
        </button>
      )}
    </span>
  ) : null;

  const scheduleHover = (hit: SegmentHit) => {
    if (!onHover) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => onHover(hit), 500);
  };

  // Cancel a pending debounced hover on unmount so it can't fire into a gone
  // component.
  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  return (
    <div className="border border-[color:var(--hn-subtle)] bg-white">
      {/* toolbar: share%/count toggle + window presets. Wraps on narrow screens
          so nothing overflows the chart frame on a phone. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pt-2 pb-1">
        {hideShareToggle ? (
          // Single-term page: no share%/count toggle. Keep an empty cell so the
          // window presets stay right-aligned under `justify-between`.
          <div />
        ) : (
          <div className="hn-tabs flex items-center gap-1">
            <button
              className={normalized ? "active" : ""}
              title="each month is 100% - segments are each term's share"
              onClick={() => onToggleNormalized(true)}
            >
              share %
            </button>
            <button
              className={!normalized ? "active" : ""}
              title="bar height is the raw number of postings"
              onClick={() => onToggleNormalized(false)}
            >
              count
            </button>
          </div>
        )}
        <div className="flex items-center gap-3">
          {anyData && errorNote && <span className="text-[11px]">{errorNote}</span>}
          <div className="hn-tabs flex items-center gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                className={windowKey === w ? "active" : ""}
                onClick={() => onWindow(w)}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* the bars ---------------------------------------------------- */}
      <div
        className="jobs-bars-box relative px-3 pb-3"
        style={{ ["--jobs-bars-h" as string]: `${height}px` }}
      >
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-[12px] text-[color:var(--hn-subtle)] bg-white/60">
            charting…
          </div>
        )}
        {!anyData && !loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[color:var(--hn-subtle)]">
            {errorNote ?? "no job-post mentions in this window"}
          </div>
        ) : (
          <div className="jobs-bars flex h-full items-end">
            {columns.map((col, ci) => {
              const shares = columnShares(col);
              // Outer column height as a PERCENT of the box, so it tracks the
              // CSS-driven (responsive) box height rather than a fixed pixel
              // value: full in relative mode (else 0 for an empty month - though
              // in share mode those months are already dropped),
              // proportional to the all-time max in count mode.
              const colPct = normalized
                ? col.total > 0
                  ? 100
                  : 0
                : (col.total / maxTotal) * 100;
              const period = `${MONTHS[col.month]} ${col.year}${col.partial ? " so far" : ""}`;
              return (
                <div
                  key={col.idx}
                  className="flex h-full flex-col justify-end"
                  style={{ flexBasis: 0, flexGrow: 1, minWidth: 0 }}
                  title={col.partial ? `${period} (month in progress)` : undefined}
                >
                  {/* Outer wrapper carries the column height; the inner `fill`
                      holds the stacked segments. */}
                  <div
                    className="jobs-bar-grow"
                    style={{ height: `${colPct}%` }}
                  >
                    <div className="jobs-bar-fill flex flex-col-reverse">
                      {series.map((s, si) => {
                        const share = shares[si] ?? 0;
                        if (share <= 0) return null;
                        const hit = hitFor(ci, si);
                        // `|| undefined` keeps the attribute ABSENT on the ~1439
                        // non-latched segments, so the CSS hits exactly one node.
                        const isLatched =
                          latched != null &&
                          latched.seriesIndex === si &&
                          latched.year === col.year &&
                          latched.month === col.month;
                        // The in-progress month is drawn in the pale tint.
                        const base = col.partial ? paleColor(s.color) : s.color;
                        return (
                          <div
                            key={si}
                            className="jobs-seg"
                            role="button"
                            tabIndex={0}
                            aria-label={`${s.label}, ${period}: ${hit.value.toLocaleString()} postings`}
                            aria-pressed={isLatched}
                            data-latched={isLatched || undefined}
                            onMouseEnter={() => scheduleHover(hit)}
                            onFocus={() => scheduleHover(hit)}
                            onClick={() => select(hit)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                select(hit);
                              }
                            }}
                            // The base color + its pale (HSB-lightened) variant
                            // ride as CSS vars so the hover/latch rules in
                            // globals.css can swap to a SOLID washed color (never
                            // opacity, which would let the half-pixel bar overlap
                            // blend into a seam). background + the seam-bleed
                            // box-shadow live in CSS off `var(--seg)`.
                            style={
                              {
                                height: `${share * 100}%`,
                                "--seg": base,
                                "--seg-pale": paleColor(base),
                              } as React.CSSProperties
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* x-axis: year ticks. A row that mirrors the bar columns 1:1 (same px-3 +
          flex-grow-per-column), so each label lands flush-left under the first
          bar of its year. Only the main chart opts in via `showYearAxis`. */}
      {showYearAxis && anyData && !loading && (
        // Fixed height so the flex cells STRETCH to a real height and contain
        // the absolute labels (otherwise the cells collapse to 0 and the text
        // spills past the chart's bottom border); pt gaps it off the bars and
        // pb keeps the labels clear of the border.
        <div
          className="jobs-axis flex select-none px-3 pt-1 pb-2.5 text-[10px] leading-none text-[color:var(--hn-subtle)]"
          style={{ height: 28 }}
          aria-hidden
        >
          {columns.map((col, ci) => (
            <div
              key={col.idx}
              className="relative"
              style={{ flexBasis: 0, flexGrow: 1, minWidth: 0 }}
            >
              {yearTicks.has(ci) && (
                <span className="absolute left-0 top-0 whitespace-nowrap tabular-nums">
                  {col.year}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Memoized: the chart re-renders only when its series/window/normalization,
 * `selected`, or callbacks actually change. The page's callbacks are stable
 * (`useCallback` / `setState` setters), so unrelated parent re-renders (e.g. the
 * drill-down panel updating) no longer rebuild the chart. The hover affordance is
 * pure CSS (`.jobs-seg:hover` brighten + row dim), so it needs no re-render; only
 * a latch change flips one node's `data-latched`. */
export const JobsStackedBars = memo(JobsStackedBarsInner);
