"use client";

/**
 * Data hook for the big chart: turn the user's compare strings into binned
 * per-month `SeriesData`, scoped to job postings (scope=jobs).
 *
 * This is the thin IO layer over the pure transforms in `src/lib/jobs-trends.ts`
 * (which carry all the testable logic). Per series:
 *   1. split on `|` into OR-group parts (`parseParts`)
 *   2. aggregate each part live (scope=jobs) -> raw 30d `$dateHistogram` buckets
 *   3. fold each part's buckets into calendar months (`binMonths`) and sum the
 *      parts bucket-for-bucket (`sumByMonth`) into one month map
 *   4. carry the all-time total (shown on the compare chip)
 *
 * Requests are aborted when the comparison changes so a fast retype never lets a
 * stale response overwrite a newer one.
 */

import { useEffect, useMemo, useState } from "react";
import { aggregate } from "@/lib/hn-search";
import { drillIndex } from "@/lib/jobs-index";
import { QUERYING_DISABLED } from "@/lib/maintenance";
import { useJobsGallery } from "./useJobsGallery";
import {
  parseParts,
  binMonths,
  sumByMonth,
  monthTotal,
  colorAt,
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
 *  calendar-month map keyed by `monthKey`. */
async function aggregateSeries(
  label: string,
  signal: AbortSignal,
): Promise<Map<string, number>> {
  const parts = parseParts(label);
  if (parts.length === 0) return new Map();
  // Same gate the drill-down uses: aggregate against the dedicated `hnjobs`
  // postings index when it's ready (no scope arm needed, ~3x faster), else the
  // shared `hn` index narrowed by `scope=jobs`. Flipping NEXT_PUBLIC_JOBS_INDEX_READY
  // moves the chart + gallery + drill-down together with no further code change.
  const { index, scope } = drillIndex();
  const perPart = await Promise.all(
    parts.map(async (p) => {
      const { buckets } = await aggregate({ q: p, scope, index, signal });
      // `Bucket` already carries {key, docCount}; reuse it as a RawBucket.
      return binMonths(buckets as RawBucket[]);
    }),
  );
  return sumByMonth(perPart);
}

export function useJobSeries(terms: string[]): {
  series: SeriesData[];
  loading: boolean;
  error: string | null;
} {
  // Join the trimmed, non-empty terms into a stable effect key.
  const cleaned = useMemo(
    () => terms.map((t) => t.trim()).filter(Boolean),
    [terms],
  );
  const key = cleaned.join("§");

  // `loaded` holds the result for the CURRENT key (null while a fetch is in
  // flight or before the first one resolves). Keying the result by `key` lets us
  // DERIVE `loading`/`error`/`series` instead of synchronously calling setState
  // inside the effect (which React's purity rules forbid). The empty-terms case
  // needs no fetch at all, so it never touches the effect.
  const [loaded, setLoaded] = useState<{ key: string; series: SeriesData[]; error: string | null } | null>(null);

  // The CDN-cached gallery dataset (per-part month histograms). While live
  // querying is disabled, the chart is assembled from THIS instead of a live
  // aggregate, so a gallery-card click still draws its bars. (Cheap, module-
  // cached; the hook must be called unconditionally.)
  const dataset = useJobsGallery();

  useEffect(() => {
    if (QUERYING_DISABLED) return; // no live aggregate while the DB is down
    if (cleaned.length === 0) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const out = await Promise.all(
          cleaned.map(async (label, i) => {
            const byMonth = await aggregateSeries(label, ctrl.signal);
            return {
              label,
              parts: parseParts(label),
              color: colorAt(i),
              byMonth,
              total: monthTotal(byMonth),
            } satisfies SeriesData;
          }),
        );
        if (ctrl.signal.aborted) return;
        setLoaded({ key, series: out, error: null });
      } catch (e) {
        if (ctrl.signal.aborted || (e as Error).name === "AbortError") return;
        setLoaded({ key, series: [], error: (e as Error).message });
      }
    })();
    return () => ctrl.abort();
    // cleaned is derived from key; key alone is the stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Disabled path: build each series from the cached gallery dataset. A series
  // string is split on `|`; each part's cached month-map is summed (a missing
  // part just contributes nothing - there's no live fallback while down).
  const cachedSeries = useMemo(() => {
    if (!QUERYING_DISABLED || !dataset.ready) return null;
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
  }, [dataset, key]);

  // The loaded result is only valid if it's for the current key (a stale result
  // from a previous comparison is ignored until the new fetch resolves).
  const current = loaded && loaded.key === key ? loaded : null;
  const error = QUERYING_DISABLED ? null : current?.error ?? null;
  // Loading whenever there are terms but no data for this key yet. While disabled
  // that means "until the cached gallery dataset has settled".
  const loading = QUERYING_DISABLED
    ? cleaned.length > 0 && !dataset.ready
    : cleaned.length > 0 && current === null;

  // While the first real response is loading, render zero-height placeholder
  // series so the chart frame + colors are stable (no layout shift, no flash).
  const safe = useMemo(() => {
    const loadedSeries = QUERYING_DISABLED ? cachedSeries ?? [] : current?.series ?? [];
    return loadedSeries.length ? loadedSeries : cleaned.map((t, i) => emptySeries(t, i));
  }, [current, cleaned, cachedSeries]);

  return { series: safe, loading, error };
}
