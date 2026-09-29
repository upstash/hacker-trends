"use client";

/**
 * Data hook for the big chart: turn the committed compare strings into binned
 * per-month `SeriesData`, scoped to job postings.
 *
 * This is the thin IO layer over the pure transforms in `src/lib/jobs-trends.ts`
 * (which carry all the testable logic). Per series:
 *   1. normalize + dedupe the chips (`seriesSlots`: case-folded, empties and
 *      duplicates dropped), so colors match the chips and keys are unique
 *   2. aggregate each OR-group part (calendar-month buckets on `hnjobs`) and sum
 *      the parts month-for-month (`binMonths` + `sumByMonth`)
 *   3. carry the all-time total (shown on the compare chip)
 *
 * Series settle INDEPENDENTLY: one failed term leaves its band empty and
 * surfaces a friendly error with a retry, instead of blanking the comparison.
 * While a new comparison loads, bands already known from the previous result
 * stay on screen. Server-built `initial` series (landing pages) are used as-is,
 * so the first paint needs no client fetch. Requests are aborted when the
 * comparison changes so a stale response never overwrites a newer one.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { aggregate, ApiError, friendlyError } from "@/lib/hn-search";
import { trackError } from "@/lib/analytics";
import { drillIndex } from "@/lib/jobs-index";
import { QUERYING_DISABLED } from "@/lib/maintenance";
import { galleryPart, useJobsGallery } from "./useJobsGallery";
import {
  parseParts,
  binMonths,
  sumByMonth,
  monthTotal,
  colorAt,
  seriesSlots,
  type RawBucket,
  type SeriesData,
} from "@/lib/jobs-trends";

/** An all-zero placeholder series so the chart keeps its colors/labels (and the
 *  chip its total of 0) while the first aggregate is still in flight. */
function emptySeries(label: string, i: number): SeriesData {
  return {
    label,
    parts: parseParts(label),
    color: colorAt(i),
    byMonth: new Map(),
    total: 0,
  };
}

/** Aggregate one series string (summing its `|` OR-group parts) into a single
 *  calendar-month map keyed by `monthKey`. Any failed part fails the series (a
 *  partial sum would be a silently wrong band). */
async function aggregateSeries(
  label: string,
  signal: AbortSignal,
): Promise<Map<string, number>> {
  const parts = parseParts(label);
  if (parts.length === 0) return new Map();
  // Same gate the drill-down uses: the dedicated `hnjobs` postings index when
  // it's ready (no scope arm), else the shared `hn` index narrowed by scope=jobs.
  const { index, scope } = drillIndex();
  const perPart = await Promise.all(
    parts.map(async (p) => {
      const primed = await galleryPart(p);
      if (primed) return binMonths(primed as RawBucket[]);
      const { buckets } = await aggregate({ q: p, scope, index, signal });
      return binMonths(buckets as RawBucket[]);
    }),
  );
  return sumByMonth(perPart);
}

/** Months per series label from successful aggregates this session, so adding
 *  or editing one chip only queries that chip (and a failure elsewhere can't
 *  blank bands that already loaded). Failures are never cached. */
const seriesCache = new Map<string, Map<string, number>>();
const SERIES_CACHE_MAX = 64;

async function cachedSeries(label: string, signal: AbortSignal): Promise<Map<string, number>> {
  const hit = seriesCache.get(label);
  if (hit) return hit;
  const byMonth = await aggregateSeries(label, signal);
  if (seriesCache.size >= SERIES_CACHE_MAX) seriesCache.clear();
  seriesCache.set(label, byMonth);
  return byMonth;
}

type Loaded = {
  key: string;
  /** the retry attempt it answers (a retry invalidates the failed result). */
  attempt: number;
  series: SeriesData[];
  error: string | null;
  /** every series failed because live querying is switched off. */
  disabled: boolean;
};

const keyOf = (labels: string[]) => labels.join("§");

export type JobSeriesResult = {
  series: SeriesData[];
  loading: boolean;
  /** friendly message when at least one series failed (its band is empty). */
  error: string | null;
  retry: () => void;
};

export function useJobSeries(terms: string[], initial?: SeriesData[]): JobSeriesResult {
  const cleaned = useMemo(() => seriesSlots(terms).series, [terms]);
  const key = keyOf(cleaned);

  // Server-built series (landing pages): used verbatim for their own key, so
  // the page's first paint needs no fetch. Ignored when they carry no data (a
  // degraded server render) so the client fetches instead.
  const [seed] = useState<Loaded | null>(() =>
    initial && initial.some((s) => s.total > 0)
      ? {
          key: keyOf(initial.map((s) => s.label)),
          attempt: 0,
          series: initial,
          error: null,
          disabled: false,
        }
      : null,
  );

  // `loaded` holds the latest fetched result. Keying it by `key` lets us DERIVE
  // `loading`/`error`/`series` instead of calling setState inside the effect.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (QUERYING_DISABLED) return; // no live aggregate while the DB is down
    if (cleaned.length === 0) return;
    if (attempt === 0 && seed?.key === key) return;
    // The server-built bands count as loaded: editing one chip on a landing
    // page shouldn't re-query the page's own terms.
    for (const s of seed?.series ?? []) if (!seriesCache.has(s.label)) seriesCache.set(s.label, s.byMonth);
    const ctrl = new AbortController();
    // Start on the next tick: the hub's first (hydration) render may be
    // replaced at once by its URL-seeded terms, and this cleanup then cancels
    // the default comparison before any request goes out.
    const t = setTimeout(async () => {
      const settled = await Promise.allSettled(
        cleaned.map((label) => cachedSeries(label, ctrl.signal)),
      );
      if (ctrl.signal.aborted) return;
      const reasons = settled
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason);
      if (reasons.length) trackError("jobs_chart", reasons[0]);
      const series = cleaned.map((label, i) => {
        const r = settled[i];
        const byMonth = r.status === "fulfilled" ? r.value : new Map<string, number>();
        return {
          label,
          parts: parseParts(label),
          color: colorAt(i),
          byMonth,
          total: monthTotal(byMonth),
        } satisfies SeriesData;
      });
      setLoaded({
        key,
        attempt,
        series,
        error: reasons.length ? friendlyError(reasons[0]) : null,
        disabled:
          reasons.length === cleaned.length &&
          reasons.every((e) => e instanceof ApiError && e.code === "disabled"),
      });
    }, 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // cleaned is derived from key; key alone is the stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const current =
    loaded?.key === key && loaded.attempt === attempt
      ? loaded
      : attempt === 0 && seed?.key === key
        ? seed
        : null;

  // Kill switch (build-time, or the API answering "disabled"): assemble the
  // series from the CDN-cached gallery dataset instead. Only then is the
  // dataset fetched at all.
  const offline = QUERYING_DISABLED || !!current?.disabled;
  const dataset = useJobsGallery(offline);
  const gallerySeries = useMemo(() => {
    if (!offline || !dataset.ready) return null;
    return cleaned.map((label, i) => {
      const parts = parseParts(label);
      const maps = parts.map((p) => {
        const pts = dataset.lookupPart(p);
        return pts ? binMonths(pts as RawBucket[]) : new Map<string, number>();
      });
      const byMonth = sumByMonth(maps);
      return {
        label,
        parts,
        color: colorAt(i),
        byMonth,
        total: monthTotal(byMonth),
      } satisfies SeriesData;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline, dataset, key]);

  const loading = offline
    ? cleaned.length > 0 && !dataset.ready
    : cleaned.length > 0 && current === null;
  const error = offline ? null : current?.error ?? null;

  // While a new comparison loads, keep every band we already know (from the
  // previous result) and zero-fill the new ones, so the chart doesn't blank.
  const safe = useMemo(() => {
    if (offline) return gallerySeries ?? cleaned.map((t, i) => emptySeries(t, i));
    if (current) return current.series;
    const prev = [...(loaded?.series ?? []), ...(seed?.series ?? [])];
    return cleaned.map((label, i) => {
      const hit = prev.find((s) => s.label === label);
      return hit ? { ...hit, color: colorAt(i) } : emptySeries(label, i);
    });
  }, [offline, gallerySeries, current, loaded, seed, cleaned]);

  return { series: safe, loading, error, retry };
}
