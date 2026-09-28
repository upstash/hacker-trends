/**
 * The shared time grid for every trend chart in the app.
 *
 * Every chart (`TrendChart`, `MiniTrend`, `StaticTrend`, the OG cards) bins the
 * date-histogram into the SAME 30-day slots. Keeping these constants in one
 * place is what lets a click on any chart's bar produce a `?from=&to=` range
 * that lines up exactly with the bucket that was counted.
 *
 * Upstash's `$dateHistogram` with `fixedInterval: "30d"` aligns buckets to the
 * Unix epoch (keys like 2007-09-14, 2007-10-14), not to calendar months. So the
 * grid starts at the epoch-aligned bucket at or before 2007-01-01 (2006-12-18,
 * 450 x 30d after the epoch): slot i IS bucket i, and `slotRange(i)` is exactly
 * the window that bucket covers.
 *
 * The horizon rolls forward automatically: the last slot is the one containing
 * "now", i.e. the bucket that is still filling up.
 */

export const MONTH_MS = 30 * 24 * 3600 * 1000;
export const MIN_MS = Math.floor(Date.UTC(2007, 0, 1) / MONTH_MS) * MONTH_MS;

/** Slot index containing an epoch-ms. Bucket keys land exactly on a slot start;
 *  older cached keys that were shifted into the slot still floor to it. */
export const slotOf = (ms: number) => Math.floor((ms - MIN_MS) / MONTH_MS);

/** Slots through the in-progress one (the bucket containing "now"). */
export const SLOTS = Math.max(1, slotOf(Date.now()) + 1);
/** Exact end of the fixed-slot grid. */
export const MAX_MS = MIN_MS + SLOTS * MONTH_MS;

/** A single slot's [from, to) window: exactly the 30d bucket it plots. */
export const slotRange = (i: number): { fromMs: number; toMs: number } => ({
  fromMs: MIN_MS + i * MONTH_MS,
  toMs: MIN_MS + (i + 1) * MONTH_MS,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

/** "Sep 4 - Oct 3 2026" (or "Dec 13 2025 - Jan 11 2026") for a [from, to) window. */
export function rangeLabel(fromMs: number, toMs: number): string {
  const a = new Date(fromMs);
  const b = new Date(toMs - 1);
  return a.getUTCFullYear() === b.getUTCFullYear()
    ? `${md(a)} - ${md(b)} ${b.getUTCFullYear()}`
    : `${md(a)} ${a.getUTCFullYear()} - ${md(b)} ${b.getUTCFullYear()}`;
}

export const slotLabel = (i: number) => {
  const r = slotRange(i);
  return rangeLabel(r.fromMs, r.toMs);
};

/** The newest slot any series in a cached dataset reaches: the bucket that was
 *  still in progress when the cache was built. Charts end that data there
 *  instead of dropping to 0 for slots the cache never saw. */
export function lastSlotOf(data: Record<string, { key: number }[]>): number {
  let last = -1;
  for (const pts of Object.values(data))
    if (pts.length) last = Math.max(last, slotOf(pts[pts.length - 1].key));
  return last < 0 ? SLOTS - 1 : Math.min(last, SLOTS - 1);
}

/**
 * SVG paths for one series over slots [lo, end], where `end` is its in-progress
 * slot. `line` runs through the complete slots; `partial` is the last segment
 * into the in-progress slot (render it dashed), so a half-filled bucket reads as
 * "so far" instead of a cliff. `area` fills under `line` only.
 */
export function trendPaths(
  values: ArrayLike<number>,
  o: {
    lo: number;
    end: number;
    x: (i: number) => number;
    y: (v: number) => number;
    base: number;
  },
): { line: string; partial: string; area: string } {
  const { lo, end, x, y, base } = o;
  const pt = (i: number) => `${x(i).toFixed(1)},${y(values[i] ?? 0).toFixed(1)}`;
  const pts: string[] = [];
  for (let i = lo; i < end; i++) pts.push(pt(i));
  const line = pts.length > 1 ? `M${pts.join("L")}` : "";
  const partial = end > lo ? `M${pt(end - 1)}L${pt(end)}` : "";
  const area = line
    ? `M${x(lo).toFixed(1)},${base}L${pts.join("L")}L${x(end - 1).toFixed(1)},${base}Z`
    : "";
  return { line, partial, area };
}
