/**
 * The shared time grid for every trend chart in the app.
 *
 * Both the big interactive chart (`TrendChart`) and the small gallery charts
 * (`MiniTrend` on /examples) bin the date-histogram into the SAME monthly slots
 * over the SAME 2007→2026 span. Keeping these constants in one place is what
 * lets a click on a mini-chart's month produce a `?from=&to=` range that lines
 * up exactly with the bar you'd see (and select) on the main chart.
 */

export const MIN_MS = Date.UTC(2007, 0, 1);
export const MAX_MS = Date.UTC(2026, 5, 1);
export const MONTH_MS = 30 * 24 * 3600 * 1000;
export const SLOTS = Math.max(1, Math.round((MAX_MS - MIN_MS) / MONTH_MS));

/** Slot index a bucket key (epoch-ms) falls in. */
export const slotOf = (ms: number) => Math.round((ms - MIN_MS) / MONTH_MS);

/** A single slot's [from, to) window, aligned to the 30d histogram buckets so
 *  a selected range matches the bar it covers exactly. */
export const slotRange = (i: number): { fromMs: number; toMs: number } => ({
  fromMs: MIN_MS + i * MONTH_MS,
  toMs: MIN_MS + (i + 1) * MONTH_MS,
});
