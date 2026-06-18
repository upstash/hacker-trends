/**
 * Server-side data layer for the /examples gallery.
 *
 * The gallery shows a date-histogram for ~150 terms. Running ~150 Upstash
 * aggregate queries on every page view would be absurd, so instead we run them
 * ONCE and cache the whole lot under a SINGLE Redis key (`examples:<version>`).
 * Every request after that is a single GET of that key: fast, and one round
 * trip instead of a hundred.
 *
 * Writing the cache needs a writable token; the deployed app uses a READ-ONLY
 * Upstash token, so the SET is best-effort (it silently no-ops in prod). The key
 * is primed once from a writable environment: locally via
 * `GET /api/examples?fresh=1`, or any env whose token can write, and prod then
 * just reads it. If the key is ever missing, we still compute + return live so
 * the page never breaks; it just won't be cached until a writable env primes it.
 *
 * This module is server-only (it reads the Upstash token); import it from route
 * handlers / server components, never from a "use client" file.
 */

import { hnRedis, runAggregate } from "@/lib/hn-index";
import { CATALOG_VERSION, allExampleTerms } from "@/lib/examples";

/** Lean monthly point: just what the gallery sparklines plot. We drop the
 *  histogram's `keyAsString` (an ISO string the mini-charts derive from `key`
 *  anyway) since it was ~55% of the cached blob's bytes. */
export type MonthCount = { key: number; docCount: number };

const HAS_CREDS = !!(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

const CACHE_KEY = `examples:${CATALOG_VERSION}`;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const BUILD_CONCURRENCY = 8;

export type ExamplesData = {
  version: string;
  generatedAt: string;
  /** term -> its monthly date-histogram (lean points) */
  terms: Record<string, MonthCount[]>;
};

/** The SDK client (env-driven). All Upstash access - the per-term aggregates AND
 *  the single cache key GET/SET - goes through it; everything is best-effort, so
 *  a missing-creds or read-only-token failure degrades to live compute, never a
 *  crash (callers treat the cache as strictly an optimization). */
const redis = HAS_CREDS ? hnRedis() : null;

/** One term's monthly histogram, via the exact same SDK aggregate the app runs,
 *  stripped to the lean {key, docCount} points the gallery plots. */
async function fetchBuckets(term: string): Promise<MonthCount[]> {
  if (!redis) return [];
  try {
    const agg = await runAggregate(redis, { q: term });
    return agg.buckets.map((b) => ({ key: b.key, docCount: b.docCount }));
  } catch {
    return [];
  }
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

async function compute(): Promise<ExamplesData> {
  const terms = allExampleTerms();
  const buckets = await mapLimit(terms, BUILD_CONCURRENCY, fetchBuckets);
  const map: Record<string, MonthCount[]> = {};
  terms.forEach((t, i) => (map[t] = buckets[i]));
  return {
    version: CATALOG_VERSION,
    generatedAt: new Date().toISOString(),
    terms: map,
  };
}

/**
 * The gallery's data. Reads the single cache key; on a miss (or `fresh`)
 * recomputes all histograms and best-effort-writes the cache. Always returns
 * data; the cache is an optimization, never a hard dependency.
 */
export async function getExamplesData(opts?: {
  fresh?: boolean;
}): Promise<ExamplesData> {
  if (!opts?.fresh && redis) {
    try {
      // The SDK auto-deserializes JSON values, so the cached blob comes back as
      // the parsed object (or a string if it was stored raw) - handle both.
      const cached = await redis.get<ExamplesData | string>(CACHE_KEY);
      const d =
        typeof cached === "string"
          ? (JSON.parse(cached) as ExamplesData)
          : cached;
      if (d?.version === CATALOG_VERSION && d.terms) return d;
    } catch {
      // fall through to recompute on a missing/corrupt/legacy value
    }
  }
  const data = await compute();
  if (redis) {
    // Best-effort: a read-only token (prod) just rejects the write, which is
    // fine - the key is primed once from a writable env and read everywhere.
    try {
      await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL_SECONDS });
    } catch {
      // ignore: cache is an optimization, never a hard dependency
    }
  }
  return data;
}
