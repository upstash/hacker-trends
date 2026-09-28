/**
 * Server-side data layer for the /examples gallery.
 *
 * The gallery shows a date-histogram for every catalog term (308 of them).
 * Running that many Upstash aggregate queries on every page view would be
 * absurd, so instead CI runs them ONCE and caches the whole lot under a SINGLE
 * Redis key (`examples:<version>`). Every request after that is a single GET of
 * that key: fast, and one round trip instead of hundreds.
 *
 * Only `scripts/refresh-cache.ts` (the daily ingest Action) builds and writes
 * the key, via `buildExamplesCache()`. The deployed app only ever reads it
 * (`readExamplesCache()`), so a cold key can never trigger a fan-out on Vercel.
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

/** The SDK client (env-driven), or null without creds. All Upstash access - the
 *  per-term aggregates AND the single cache key GET/SET - goes through it. */
const redis = HAS_CREDS ? hnRedis() : null;

/** One term's monthly histogram, via the exact same SDK aggregate the app runs,
 *  stripped to the lean {key, docCount} points the gallery plots. Retries
 *  transient failures; returns null once they are exhausted. Every catalog term
 *  was probe-vetted to have data, so an empty result counts as a failure too
 *  (caching it would freeze a false zero for the 30-day TTL). */
async function fetchBuckets(term: string): Promise<MonthCount[] | null> {
  if (!redis) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const agg = await runAggregate(redis, { q: term });
      if (agg.buckets.length > 0) {
        return agg.buckets.map((b) => ({ key: b.key, docCount: b.docCount }));
      }
    } catch {
      // fall through to backoff + retry
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return null;
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

/** Aggregate every catalog term. Terms that still failed after retries are
 *  omitted from `terms` and listed in `missing`. */
async function compute(): Promise<{ data: ExamplesData; missing: string[] }> {
  const terms = allExampleTerms();
  const buckets = await mapLimit(terms, BUILD_CONCURRENCY, fetchBuckets);
  const map: Record<string, MonthCount[]> = {};
  const missing: string[] = [];
  terms.forEach((t, i) => {
    const b = buckets[i];
    if (b) map[t] = b;
    else missing.push(t);
  });
  return {
    data: {
      version: CATALOG_VERSION,
      generatedAt: new Date().toISOString(),
      terms: map,
    },
    missing,
  };
}

/**
 * Read-only cache lookup: returns the cached gallery data, or `null` on a miss
 * (missing / corrupt / legacy-version key, or no creds). NEVER computes.
 *
 * This is the only access the deployed app should make. `/examples.json` serves
 * the baked snapshot on a miss instead of fanning out ~300 aggregates. The cache
 * is kept warm out-of-band by the daily ingest Action (`refresh-cache.ts`),
 * never by Vercel request traffic.
 */
export async function readExamplesCache(): Promise<ExamplesData | null> {
  if (!redis) return null;
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
    // fall through to null on a missing/corrupt/legacy value
  }
  return null;
}

/**
 * Read-only: the cached gallery data, throwing on a miss so callers fall back
 * to their own per-term path. Never computes. Prefer `readExamplesCache()`.
 */
export async function getExamplesData(): Promise<ExamplesData> {
  const cached = await readExamplesCache();
  if (!cached) throw new Error(`examples cache miss (${CACHE_KEY})`);
  return cached;
}

/**
 * CI-ONLY builder: recompute every catalog histogram and write the cache key,
 * but only when the build is COMPLETE (every term resolved). A partial build is
 * returned for reporting and never persisted, so a transient gap can't freeze
 * for the 30-day TTL and the previous complete value keeps serving. Needs a
 * writable token; run from `scripts/refresh-cache.ts`, never from the app.
 */
export async function buildExamplesCache(): Promise<{
  data: ExamplesData;
  missing: string[];
  cached: boolean;
}> {
  if (!redis) throw new Error("buildExamplesCache: no Upstash credentials");
  const { data, missing } = await compute();
  if (missing.length > 0) return { data, missing, cached: false };
  await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL_SECONDS });
  return { data, missing, cached: true };
}
