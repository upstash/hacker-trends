/**
 * Server-side data layer for the "Who is hiring?" gallery mini charts.
 *
 * Each gallery card (CATEGORY_CARDS / COMPARISONS in jobs-gallery.ts) is a
 * relative stacked-bar mini chart over LIVE jobs-scoped aggregates. Computing
 * those in the browser means every visible card fans out one aggregate call per
 * term - dozens of cold `/api/hn` round trips before anything paints. The main
 * page solves the identical problem with `/examples.json`; this mirrors that
 * pattern for the jobs gallery.
 *
 * Strategy (same as examples-data.ts):
 *   1. Collect every DISTINCT part across all cards (an OR-group `a|b` is split
 *      into `a` and `b`; the same part used by several cards is fetched once).
 *   2. Aggregate each part ONCE, scope=jobs, into its 30d `$dateHistogram`.
 *   3. Cache the whole map under a SINGLE Redis key (`jobs-gallery:<version>`),
 *      so steady-state every request is a single GET instead of ~120 aggregates.
 *
 * Writing the cache needs a writable token; the deployed app uses a READ-ONLY
 * token, so the SET is best-effort (it silently no-ops in prod). The route that
 * serves this (`/who-is-hiring/examples.json`) is CDN-cached on top, so prod
 * mostly serves the edge copy and rarely touches Redis at all. If the key is
 * missing we still compute + return live, so the gallery never breaks.
 *
 * Server-only: it reads the Upstash token. Import from route handlers / server
 * components, never from a "use client" file. The browser consumes the compact
 * wire form (jobs-gallery-wire.ts) via the JSON route.
 */

import { hnRedis, runAggregate } from "@/lib/hn-index";
import { drillIndex } from "@/lib/jobs-index";
import { GALLERY } from "@/lib/jobs-gallery";
import { parseParts } from "@/lib/jobs-trends";

/** Lean monthly point - the only thing the mini charts plot. */
export type MonthCount = { key: number; docCount: number };

/** Bump when the gallery selection or the index changes so a stale cache value
 *  is ignored. Tied to the gallery card count so re-running discovery (which
 *  rewrites jobs-gallery.ts) naturally invalidates the cache, AND to the index
 *  the histograms are computed against - flipping NEXT_PUBLIC_JOBS_INDEX_READY
 *  recomputes against `hnjobs` instead of reusing the `hn`+scope values. */
export const JOBS_GALLERY_VERSION = `v2-${GALLERY.length}-${drillIndex().index}`;

const HAS_CREDS = !!(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

const CACHE_KEY = `jobs-gallery:${JOBS_GALLERY_VERSION}`;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const BUILD_CONCURRENCY = 8;

export type JobsGalleryData = {
  version: string;
  generatedAt: string;
  /** one entry per DISTINCT part (OR-groups already split); the term string is
   *  exactly what `parseParts` yields, so the client can reassemble any card. */
  terms: Record<string, MonthCount[]>;
};

/** Every distinct OR-group part across all gallery cards, deduped + stable. The
 *  card stores series strings like `ai|machine learning`; the mini chart sums
 *  the parts, so we cache per part, not per series string. */
export function allGalleryParts(): string[] {
  const seen = new Set<string>();
  for (const card of GALLERY)
    for (const series of card.terms)
      for (const part of parseParts(series)) seen.add(part);
  return [...seen];
}

/** The SDK client (env-driven). All Upstash access - the per-part jobs
 *  aggregates AND the single cache key GET/SET - goes through it; everything is
 *  best-effort (a missing-creds or read-only-token failure degrades to live
 *  compute, never a crash), so callers treat the cache as strictly an
 *  optimization. */
const redis = HAS_CREDS ? hnRedis() : null;

/** One part's monthly histogram, via the exact same SDK aggregate the page runs
 *  in the browser: the dedicated `hnjobs` index when ready (no scope arm), else
 *  the shared `hn` index scope=jobs, stripped to the lean {key, docCount}
 *  points. */
async function fetchBuckets(part: string): Promise<MonthCount[]> {
  if (!redis) return [];
  const { index, scope } = drillIndex();
  // Retry transient failures: a single flaky aggregate here used to return `[]`,
  // which `compute` would then cache as a permanent zero for the part's 30-day
  // TTL - exactly the bug that left "javascript vs typescript" rendering as one
  // solid bar (js cached empty). Every gallery part is curated to have data, so
  // an empty result is always a failure signal, never a real zero.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const agg = await runAggregate(redis, { q: part, scope, index });
      return agg.buckets.map((b) => ({ key: b.key, docCount: b.docCount }));
    } catch {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  return []; // exhausted retries -> caller treats this part as missing, not zero
}

async function mapLimit<T, R>(
  items: T[],
  n: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function compute(): Promise<{ data: JobsGalleryData; complete: boolean }> {
  const parts = allGalleryParts();
  const buckets = await mapLimit(parts, BUILD_CONCURRENCY, fetchBuckets);
  const map: Record<string, MonthCount[]> = {};
  let complete = true;
  parts.forEach((p, i) => {
    // OMIT a part that came back empty rather than storing `[]`: the client's
    // `lookupPart` then returns undefined, so the card falls back to a live
    // per-card aggregate (which renders correctly) instead of drawing a false
    // zero. `complete` stays false so this partial build is NOT cached.
    if (buckets[i].length > 0) map[p] = buckets[i];
    else complete = false;
  });
  return {
    data: {
      version: JOBS_GALLERY_VERSION,
      generatedAt: new Date().toISOString(),
      terms: map,
    },
    complete,
  };
}

/**
 * The gallery's per-part histograms. Reads the single cache key; on a miss (or
 * `fresh`) recomputes all histograms and best-effort-writes the cache. Always
 * returns data - the cache is an optimization, never a hard dependency.
 */
export async function getJobsGalleryData(opts?: {
  fresh?: boolean;
}): Promise<JobsGalleryData> {
  if (!opts?.fresh && redis) {
    try {
      // The SDK auto-deserializes JSON values; handle both the parsed object and
      // a raw string (in case it was stored stringified).
      const cached = await redis.get<JobsGalleryData | string>(CACHE_KEY);
      const d =
        typeof cached === "string"
          ? (JSON.parse(cached) as JobsGalleryData)
          : cached;
      if (d?.version === JOBS_GALLERY_VERSION && d.terms) return d;
    } catch {
      // fall through to recompute on a missing/corrupt/legacy value
    }
  }
  const { data, complete } = await compute();
  // Only persist a COMPLETE build. Caching a partial one (some part still empty
  // after retries) would freeze that gap for the 30-day TTL; skipping the write
  // lets the next request recompute and self-heal, while this response still
  // serves every part that did resolve (the rest fall back to live per card).
  if (redis && complete) {
    try {
      await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL_SECONDS });
    } catch {
      // ignore: cache is an optimization, never a hard dependency
    }
  }
  return data;
}
