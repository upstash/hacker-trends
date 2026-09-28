/**
 * Pure data utilities for the "Who is hiring?" job-trends page.
 *
 * Everything here is a pure function (no React, no fetch, no env) so it can be
 * unit-tested directly (scripts/test-jobs-trends.ts) and reused by both the big
 * chart and the gallery mini charts. The page talks to the live index via the
 * existing `aggregate`/`searchPosts` browser client (scope=jobs); this module
 * only TRANSFORMS the bucket/doc shapes those return.
 *
 * The two things worth understanding here:
 *
 *  1. Month binning. On the dedicated `hnjobs` index the aggregate is a `$range`
 *     over `time` with one range per CALENDAR month (see `buildAggregateOptions`
 *     in hn-query.ts), so each bucket key is already a 1st-of-month UTC epoch and
 *     `binMonths` maps it 1:1. The legacy `hn` scope=jobs fallback still returns
 *     30d `$dateHistogram` buckets, which `binMonths` folds by start date (lossy:
 *     a bucket that starts late in a month carries the NEXT month's thread). We
 *     then walk a CONTIGUOUS month-index range (`monthRange`/`buildColumns`),
 *     defaulting every absent month to a real zero, so the chart is gap-free.
 *
 *  2. OR-groups. A series string may contain `|` (e.g. `backend|sre|devops`).
 *     Each part is aggregated separately (scope=jobs) and the per-month counts
 *     are summed bucket-for-bucket into one series (`sumByMonth`). Postings that
 *     mention two parts are double-counted; acceptable for the trend shape.
 */

export const FIRST_YEAR = 2011;

/* ---------- chart config (shared by chart + chips + galleries) ------- */

/** 10 distinct band colors so a relative stack can show many bands at once. A
 *  series is colored by its index modulo this palette. Balanced for "vibrant but
 *  pleasant on white": clearly more saturated/lively than the earlier muted set
 *  (which read as washed-out) yet pulled back from neon, so the bands separate
 *  crisply without buzzing. Ten well-spaced hues walking the wheel (orange ->
 *  blue -> green -> red -> violet -> gold -> teal -> pink -> lime -> slate) so
 *  even eight stacked bands stay individually readable. Index 0 anchors the HN
 *  orange family so the chart reads "on brand". */
export const PALETTE = [
  "#e8742a", "#3f7fd0", "#3a9d5d", "#d8453f", "#8a5cd0",
  "#d99a1f", "#1ba39c", "#d65a9c", "#7cb342", "#6b7a90",
] as const;

/** The most series the compare chips allow at once (locked in the PRD). */
export const MAX_SERIES = 8;

/** Default comparison the hub opens on: the "Top 8 languages" set. Eight bands
 *  read as a rich relative stack (the share-of-voice view people like), and it
 *  mirrors the `/who-is-hiring/top/top-8-languages` gallery card 1:1. Capped at
 *  MAX_SERIES (8). */
export const DEFAULT_TERMS = [
  "python", "javascript", "ruby", "typescript", "java", "php", "scala", "golang",
];

/** The color for the series at index `i` (wraps the palette). */
export const colorAt = (i: number): string => PALETTE[i % PALETTE.length];

/* ---------- color math (HSB) for the hover spotlight ----------------- */
// The chart dims the non-hovered columns to make the hovered one pop. Doing
// that with opacity makes the bars TRANSLUCENT, and because adjacent bars
// overlap a half pixel (the seam fix), the overlap then blends and a hairline
// reappears. So instead of going transparent we compute a lighter, less
// saturated SOLID color in HSB space: raise Brightness toward white and cut
// Saturation. The bar stays fully opaque, the overlap paints cleanly, and the
// washed tint still reads as "receded" behind the full-color hovered column.

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3 ? h.split("").map((c) => c + c).join("") : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** A lighter, less-saturated SOLID variant of a palette color (HSB: raise
 *  Brightness toward 1, cut Saturation by ~55%) used to recede the non-hovered
 *  columns without any transparency. `amount` 0..1 controls how far it washes.
 *  Kept gentle (0.4) so the spotlight reads as a soft recede, not a strong fade. */
export function paleColor(hex: string, amount = 0.4): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, v] = rgbToHsv(r, g, b);
  const s2 = s * (1 - 0.55 * amount);
  const v2 = v + (1 - v) * amount;
  return rgbToHex(...hsvToRgb(h, s2, v2));
}

/* ---------- series strings + OR-groups ------------------------------- */

/** Split a series string on `|` into its OR-group parts: trim each, drop empty.
 *  `"backend | sre |"` -> `["backend", "sre"]`; `""` -> `[]`. */
export function parseParts(text: string): string[] {
  return text
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Canonical form of a series string: lowercased parts joined by `|` (the
 *  search is case-insensitive, so `Python` and `python` are the same series). */
export function normalizeSeries(text: string): string {
  return parseParts(text.toLowerCase()).join("|");
}

/**
 * The series the chart actually draws for a chip row: each chip normalized,
 * empties and duplicates dropped, capped at MAX_SERIES. `slotOf[i]` is chip
 * i's index into `series` (null for an empty/duplicate chip), so a chip's color
 * is always `colorAt(slotOf[i])`, the same color as its band.
 */
export function seriesSlots(chips: string[]): {
  series: string[];
  slotOf: (number | null)[];
} {
  const series: string[] = [];
  const slotOf = chips.map((c) => {
    const n = normalizeSeries(c);
    if (!n || series.includes(n) || series.length >= MAX_SERIES) return null;
    series.push(n);
    return series.length - 1;
  });
  return { series, slotOf };
}

/* ---------- calendar-month keys ------------------------------------- */

/** Stable map key for a (year, 0-based monthIndex) cell: `"2021-3"` = Apr 2021.
 *  Deliberately NOT zero-padded - it's an internal join key, never displayed. */
export const monthKey = (year: number, month: number): string => `${year}-${month}`;

/** A contiguous global month index: `year*12 + monthIndex`. Lets us walk months
 *  with plain integer arithmetic so no calendar month can be skipped. */
export const monthIndex = (year: number, month: number): number => year * 12 + month;

/** Inverse of `monthIndex`. */
export function fromMonthIndex(idx: number): { year: number; month: number } {
  return { year: Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 };
}

/* ---------- bucket -> calendar-month binning ------------------------ */

/** A raw aggregate bucket: `key` is epoch-ms, `docCount` the count. */
export type RawBucket = { key: number; docCount: number };

/** The current calendar month as a global month index (UTC). */
export function currentMonthIndex(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  return monthIndex(d.getUTCFullYear(), d.getUTCMonth());
}

/**
 * Fold raw buckets into calendar months keyed by `monthKey`. A bucket is
 * attributed to the calendar month its start timestamp (UTC) falls in, and
 * same-month buckets are summed. `hnjobs` buckets are calendar months already
 * (exact); legacy 30d buckets are approximated. The result is SPARSE (only
 * months that received a bucket appear) - call `buildColumns` to expand it into
 * a gap-free contiguous range.
 */
export function binMonths(buckets: RawBucket[]): Map<string, number> {
  const byMonth = new Map<string, number>();
  for (const b of buckets) {
    const d = new Date(b.key);
    const k = monthKey(d.getUTCFullYear(), d.getUTCMonth());
    byMonth.set(k, (byMonth.get(k) ?? 0) + b.docCount);
  }
  return byMonth;
}

/** Sum the total over a binned month map (= a series' all-time mention count). */
export function monthTotal(byMonth: Map<string, number>): number {
  let total = 0;
  for (const v of byMonth.values()) total += v;
  return total;
}

/**
 * Sum several binned month maps bucket-for-bucket into one (OR-group summation).
 * `sumByMonth([{2021-3:5}, {2021-3:2, 2021-4:1}])` -> `{2021-3:7, 2021-4:1}`.
 */
export function sumByMonth(maps: Map<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of maps)
    for (const [k, v] of m) out.set(k, (out.get(k) ?? 0) + v);
  return out;
}

/* ---------- one binned series + contiguous columns ------------------ */

export type SeriesData = {
  /** the raw series string the user typed (may contain `|`). */
  label: string;
  /** OR-group parts of `label`. */
  parts: string[];
  /** the series' assigned color. */
  color: string;
  /** count keyed by `monthKey(year, monthIndex)`. */
  byMonth: Map<string, number>;
  /** all-time total mention count (shown on the chip). */
  total: number;
};

/** A window preset reframes the x-axis, anchored to the latest data month. */
export type WindowKey = "all" | "10y" | "5y" | "1y";
export const WINDOW_YEARS: Record<WindowKey, number | null> = {
  all: null,
  "10y": 10,
  "5y": 5,
  "1y": 1,
};

/** One stacked bar's worth of data: the per-series values for a calendar month,
 *  plus the month's [from, to) ms window (for the drill-down date range). */
export type Column = {
  /** global month index (`monthIndex`). */
  idx: number;
  year: number;
  /** 0-based month. */
  month: number;
  /** per-series value, index-aligned to the `series` array. */
  values: number[];
  /** column total across all series (the OR-group double-count is included). */
  total: number;
  fromMs: number;
  toMs: number;
  /** the in-progress current month: its thread is still collecting postings. */
  partial: boolean;
};

/** The latest month-index that ANY series has data in (the window anchor). Falls
 *  back to the current calendar month when every series is empty. */
export function latestMonthIndex(
  series: SeriesData[],
  fallback = currentMonthIndex(),
): number {
  let max = -1;
  for (const s of series)
    for (const k of s.byMonth.keys()) {
      const [y, m] = k.split("-").map(Number);
      const idx = monthIndex(y, m);
      if (idx > max) max = idx;
    }
  return max >= 0 ? max : fallback;
}

/**
 * The contiguous, GAP-FREE list of month-indexes to draw, given a window. Starts
 * no earlier than `FIRST_YEAR` and ends at the latest data month; every month in
 * between is present exactly once and in order (the property the test asserts).
 */
export function monthRange(endIdx: number, windowKey: WindowKey): number[] {
  const years = WINDOW_YEARS[windowKey];
  const floor = monthIndex(FIRST_YEAR, 0);
  const start = years == null ? floor : Math.max(floor, endIdx - years * 12 + 1);
  const out: number[] = [];
  for (let idx = start; idx <= endIdx; idx++) out.push(idx);
  return out;
}

/**
 * Expand the (sparse) binned series into one gap-free `Column` per calendar
 * month in the window. Absent months become real zero-valued columns (no holes,
 * no skipped x positions) - this is the fix for the white-gap artifact.
 *
 * `dropEmpty` is the SHARE-% mode behavior: a calendar month with zero total
 * postings across every series (e.g. a month with no hiring thread) carries no
 * proportion to show, so in normalized mode it would render
 * as a white gap. With `dropEmpty` true those zero-total months are removed from
 * the column set entirely - they are not drawn, not hoverable, and the x-axis
 * simply compacts so the gap vanishes. In COUNT mode pass `dropEmpty` false (the
 * default): a genuinely low/zero bar is honest there, so every month is kept.
 */
export function buildColumns(
  series: SeriesData[],
  windowKey: WindowKey,
  dropEmpty = false,
  nowMs = Date.now(),
): Column[] {
  const endIdx = latestMonthIndex(series, currentMonthIndex(nowMs));
  const nowIdx = currentMonthIndex(nowMs);
  const cols = monthRange(endIdx, windowKey).map((idx) => {
    const { year, month } = fromMonthIndex(idx);
    const k = monthKey(year, month);
    const values = series.map((s) => s.byMonth.get(k) ?? 0);
    return {
      idx,
      year,
      month,
      values,
      total: values.reduce((a, b) => a + b, 0),
      fromMs: Date.UTC(year, month, 1),
      toMs: Date.UTC(year, month + 1, 1),
      partial: idx === nowIdx,
    };
  });
  return dropEmpty ? cols.filter((c) => c.total > 0) : cols;
}

/* ---------- relative (100%) normalization --------------------------- */

/**
 * Each segment's share of its column, as a fraction in [0, 1]. In a non-empty
 * month the shares sum to 1 (= 100%); an empty month (total 0) stays all-zero
 * (it must render as no bar, not a divide-by-zero). This is the per-column inner
 * proportion used in BOTH relative and absolute modes - only the column's outer
 * height differs between modes.
 */
export function columnShares(col: Column): number[] {
  if (col.total <= 0) return col.values.map(() => 0);
  return col.values.map((v) => v / col.total);
}

/** As `columnShares` but in percent (sums to ~100 in non-empty months); the
 *  shape the binning test asserts against. */
export function columnPercents(col: Column): number[] {
  return columnShares(col).map((f) => f * 100);
}

/* ---------- raised-cosine falloff (legacy; kept for tests) ---------- */

/**
 * Raised-cosine falloff factor for a column `d` columns from a focus point.
 * `factor(0)` is the maximum (`1 + boost`); it falls smoothly to exactly 1 at
 * `d === radius` and stays 1 beyond, and is monotonic non-increasing in `|d|` on
 * [0, radius].
 *
 * NOTE: this powered the old macOS-dock chart magnification, which has been
 * removed (bars are now static width + height). The helper is retained as a
 * tested pure utility - it is no longer wired into the chart.
 */
export function factor(d: number, boost: number, radius: number): number {
  const ad = Math.abs(d);
  if (radius <= 0 || ad >= radius) return 1;
  return 1 + boost * 0.5 * (1 + Math.cos((Math.PI * ad) / radius));
}

/* ---------- drill-down ranking -------------------------------------- */

/**
 * The drill-down ranking formula: `relevance + log(1 + replyCount)`, so a
 * heavily discussed posting outranks a quiet one of equal relevance. The
 * `hnjobs` search applies it server-side (a `scoreFunc` over the precomputed
 * `replies` field, see `buildSearchOptions`), so the returned `_score` already
 * includes it and the client keeps the server order. Kept as the documented,
 * tested statement of the formula.
 */
export function rankKey(relevance: number, replyCount: number): number {
  return relevance + Math.log1p(Math.max(0, replyCount));
}

/* ---------- default drill-down (prefetch on load) ------------------- */

/** A segment to drill into, identified purely (no React, no `SeriesData`
 *  reference): which series index, which calendar month, and that month's
 *  [from, to) ms window for the date-ranged search. */
export type DrillSegment = {
  seriesIndex: number;
  year: number;
  /** 0-based month. */
  month: number;
  fromMs: number;
  toMs: number;
};

/**
 * Pick the segment to PREFETCH on load so the drill-down panel is populated
 * before the user touches the chart (T10). Strategy: take the LATEST calendar
 * month any series has data in (the freshest, right-most bar - what the eye
 * lands on), then within that month the series with the largest value (the
 * dominant band, the most interesting evidence). Returns null when every series
 * is empty (nothing to drill into).
 *
 * Pure + deterministic so it can be unit-tested at the seam rather than poked
 * through the component.
 */
export function defaultDrillSegment(series: SeriesData[]): DrillSegment | null {
  if (series.length === 0) return null;
  // Latest month-index any series has data in. -1 if all empty.
  let endIdx = -1;
  for (const s of series)
    for (const k of s.byMonth.keys()) {
      const [y, m] = k.split("-").map(Number);
      const idx = monthIndex(y, m);
      if (idx > endIdx) endIdx = idx;
    }
  if (endIdx < 0) return null;

  const { year, month } = fromMonthIndex(endIdx);
  const k = monthKey(year, month);
  // Within that month, the series with the largest value wins the prefetch.
  let bestIdx = -1;
  let bestVal = -1;
  for (let i = 0; i < series.length; i++) {
    const v = series[i].byMonth.get(k) ?? 0;
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestVal <= 0) return null;

  return {
    seriesIndex: bestIdx,
    year,
    month,
    fromMs: Date.UTC(year, month, 1),
    toMs: Date.UTC(year, month + 1, 1),
  };
}

/* ---------- posting text: whole-word match + centered snippet -------- */

/** Letters/digits that make up a word; a match must not be flanked by them, so
 *  "java" never lights up inside "javascript" and "rust" not inside "trust". */
const WORD = "[\\p{L}\\p{N}]";

/** A case-insensitive whole-word regex for the query's tokens (whitespace and
 *  `|` separated). null when there is nothing to match. */
export function termRegex(q: string, flags = "giu"): RegExp | null {
  const toks = q
    .split(/[\s|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (toks.length === 0) return null;
  return new RegExp(`(?<!${WORD})(${toks.join("|")})(?!${WORD})`, flags);
}

/** A `max`-char window of `text` around the first whole-word match of `q`
 *  (about a quarter of the window before it), cut on word boundaries with
 *  ellipses. Falls back to the head of the text when nothing matches. */
export function centeredSnippet(text: string, q: string, max: number): string {
  if (text.length <= max) return text;
  const re = termRegex(q, "iu");
  const m = re ? re.exec(text) : null;
  let start = m ? Math.max(0, m.index - Math.floor(max / 4)) : 0;
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp >= 0 && sp < (m?.index ?? start)) start = sp + 1;
  }
  let end = Math.min(text.length, start + max);
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > start + max * 0.6) end = sp;
  }
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
