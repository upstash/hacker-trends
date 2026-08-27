/**
 * The shared time grid for every trend chart in the app.
 *
 * Both the big interactive chart (`TrendChart`) and the small gallery charts
 * (`MiniTrend` on /examples) bin the date-histogram into the SAME monthly slots
 * from 2007 through the current month. Keeping these constants in one place is
 * what lets a click on a mini-chart's month produce a `?from=&to=` range that
 * lines up exactly with the bar you'd see (and select) on the main chart.
 *
 * The horizon must roll forward automatically. The original hard-coded June
 * 2026 endpoint produced only 236 slots (ending 2026-04-21 because these are
 * fixed 30-day histogram buckets), silently clipping every newer bucket.
 */

export const MIN_MS = Date.UTC(2007, 0, 1);
export const MONTH_MS = 30 * 24 * 3600 * 1000;

const now = new Date();
const nextUtcMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
export const SLOTS = Math.max(1, Math.ceil((nextUtcMonth - MIN_MS) / MONTH_MS));
/** Exact end of the fixed-slot grid; keeping this aligned avoids partial slots. */
export const MAX_MS = MIN_MS + SLOTS * MONTH_MS;

/** Slot index a bucket key (epoch-ms) falls in. */
export const slotOf = (ms: number) => Math.round((ms - MIN_MS) / MONTH_MS);

/** A single slot's [from, to) window, aligned to the 30d histogram buckets so
 *  a selected range matches the bar it covers exactly. */
export const slotRange = (i: number): { fromMs: number; toMs: number } => ({
  fromMs: MIN_MS + i * MONTH_MS,
  toMs: MIN_MS + (i + 1) * MONTH_MS,
});
