/**
 * Server-side data layer for the "Who is hiring?" gallery mini charts.
 *
 * Each gallery card (CATEGORY_CARDS / COMPARISONS in jobs-gallery.ts) is a
 * relative stacked-bar mini chart over jobs-scoped monthly counts. Computing
 * those per request would fan out one aggregate per distinct part (~105), so
 * the whole set is precomputed OUT OF BAND and stored under a single Redis key:
 *
 *   1. Collect every DISTINCT part across all cards (an OR-group `a|b` is split
 *      into `a` and `b`; the same part used by several cards is fetched once).
 *   2. Aggregate each part ONCE into its calendar-month histogram.
 *   3. Encode the compact wire form and SET it under `jobs-gallery-wire:<version>`.
 *
 * Steps 1-3 run ONLY in CI (`scripts/prime-jobs-gallery.ts`, daily Action). The
 * deployed app never computes the gallery: it only GETs the primed key
 * (`readJobsGalleryWire`, memoized per instance) and, on a miss, callers degrade
 * (the examples.json route serves its snapshot, landing pages read just their
 * own parts). Note the app's Upstash token IS writable; "read-only" here is a
 * rule of this module, not a property of the token.
 *
 * Server-only: it reads the Upstash token. Import from route handlers / server
 * components, never from a "use client" file. The browser consumes the compact
 * wire form (jobs-gallery-wire.ts) via the JSON route.
 */

import { hnRedis, runAggregate } from "@/lib/hn-index";
import { drillIndex } from "@/lib/jobs-index";
import { GALLERY } from "@/lib/jobs-gallery";
import { parseParts } from "@/lib/jobs-trends";
import {
  decodeJobsGalleryWire,
  encodeJobsGalleryWire,
  type JobsGalleryWire,
} from "@/lib/jobs-gallery-wire";

/** Lean monthly point - the only thing the mini charts plot. */
export type MonthCount = { key: number; docCount: number };

/** Bump when the gallery selection, the index or the bucketing changes so a
 *  stale cache value is ignored. Tied to the gallery card count so re-running
 *  discovery (which rewrites jobs-gallery.ts) naturally invalidates the cache,
 *  AND to the index the histograms are computed against. v3: `hnjobs` counts are
 *  exact calendar months (`$range`), not 30d buckets. A new version must be
 *  primed by CI (`bun scripts/prime-jobs-gallery.ts`) before the gallery fills. */
export const JOBS_GALLERY_VERSION = `v3-${GALLERY.length}-${drillIndex().index}`;

const HAS_CREDS = !!(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

// The already-encoded WIRE form (the exact bytes the /who-is-hiring/examples.json
// route serves). CI (`buildJobsGalleryWire`) writes it; the deployed app only
// reads it (one Redis GET, no aggregates, no encode).
const WIRE_CACHE_KEY = `jobs-gallery-wire:${JOBS_GALLERY_VERSION}`;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const BUILD_CONCURRENCY = 8;

// Per-instance memo of the wire read, so a landing page render (several parts,
// plus the remote-share stat) and the JSON route share one GET. A miss is kept
// briefly so a cold key can't turn every render into a Redis round trip.
const WIRE_HIT_TTL_MS = 10 * 60_000;
const WIRE_MISS_TTL_MS = 60_000;

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

const redis = HAS_CREDS ? hnRedis() : null;

/* ---------- app path: read-only ------------------------------------- */

let wireMemo: { at: number; ttl: number; value: Promise<JobsGalleryWire | null> } | null = null;

async function fetchWire(): Promise<JobsGalleryWire | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get<JobsGalleryWire | string>(WIRE_CACHE_KEY);
    const w =
      typeof cached === "string"
        ? (JSON.parse(cached) as JobsGalleryWire)
        : cached;
    if (w?.version === JOBS_GALLERY_VERSION && w.terms) return w;
  } catch {
    // missing / corrupt / legacy value -> caller degrades
  }
  return null;
}

/**
 * READ-ONLY fetch of the gallery wire payload from Redis - the ONLY gallery
 * access the deployed app does. A single KV GET of `jobs-gallery-wire:<version>`,
 * memoized per instance; it NEVER computes histograms. Returns `null` on a miss,
 * a stale-version value, or any error. The KV read does not touch the search
 * index, so it stays healthy even when live querying is disabled.
 */
export function readJobsGalleryWire(): Promise<JobsGalleryWire | null> {
  const now = Date.now();
  if (wireMemo && now - wireMemo.at < wireMemo.ttl) return wireMemo.value;
  const memo = { at: now, ttl: WIRE_HIT_TTL_MS, value: fetchWire() };
  memo.value.then((w) => {
    if (!w) memo.ttl = WIRE_MISS_TTL_MS;
  });
  wireMemo = memo;
  return memo.value;
}

/** The decoded per-part histograms from the primed wire key, or null on a miss.
 *  Points are keyed at the 1st of each calendar month (exact round trip). */
export async function readJobsGalleryParts(): Promise<Record<string, MonthCount[]> | null> {
  const wire = await readJobsGalleryWire();
  return wire ? decodeJobsGalleryWire(wire) : null;
}

/* ---------- CI path: compute + write --------------------------------- */

/** One part's monthly histogram, via the exact same SDK aggregate the page runs
 *  in the browser (the `hnjobs` calendar-month ranges when ready, else the
 *  shared `hn` index scope=jobs), stripped to lean {key, docCount} points. */
async function fetchBuckets(part: string): Promise<MonthCount[]> {
  if (!redis) return [];
  const { index, scope } = drillIndex();
  // Retry transient failures: every gallery part is curated to have data, so an
  // empty result is a failure signal, never a real zero.
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

/**
 * CI/scripts ONLY: aggregate every gallery part live (~105 aggregates). Never
 * call from the app. A part that came back empty is OMITTED (not stored as
 * `[]`), and `complete` is false so the caller skips caching the partial build.
 */
export async function computeJobsGalleryData(): Promise<{
  data: JobsGalleryData;
  complete: boolean;
}> {
  const parts = allGalleryParts();
  const buckets = await mapLimit(parts, BUILD_CONCURRENCY, fetchBuckets);
  const map: Record<string, MonthCount[]> = {};
  let complete = true;
  parts.forEach((p, i) => {
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
 * CI-ONLY builder: recompute the gallery histograms from the live index and
 * write the encoded wire key, only when the build is COMPLETE (every curated
 * part resolved) so a transient gap never freezes for the 30-day TTL. Invoked
 * from the GitHub Action via scripts/prime-jobs-gallery.ts, never from the app.
 */
export async function buildJobsGalleryWire(): Promise<{
  wire: JobsGalleryWire;
  cached: boolean;
}> {
  if (!redis) throw new Error("buildJobsGalleryWire: no Upstash credentials");
  const { data, complete } = await computeJobsGalleryData();
  const wire = encodeJobsGalleryWire(data);
  if (complete) {
    await redis.set(WIRE_CACHE_KEY, JSON.stringify(wire), {
      ex: CACHE_TTL_SECONDS,
    });
  }
  return { wire, cached: complete };
}
