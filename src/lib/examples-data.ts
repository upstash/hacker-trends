/**
 * Server-side data layer for the /examples gallery.
 *
 * The gallery shows a date-histogram for ~150 terms. Running ~150 Upstash
 * aggregate queries on every page view would be absurd, so instead we run them
 * ONCE and cache the whole lot under a SINGLE Redis key (`examples:<version>`).
 * Every request after that is a single GET of that key — fast, and one round
 * trip instead of a hundred.
 *
 * Writing the cache needs a writable token; the deployed app uses a READ-ONLY
 * Upstash token, so the SET is best-effort (it silently no-ops in prod). The key
 * is primed once from a writable environment — locally via
 * `GET /api/examples?fresh=1`, or any env whose token can write — and prod then
 * just reads it. If the key is ever missing, we still compute + return live so
 * the page never breaks; it just won't be cached until a writable env primes it.
 *
 * This module is server-only (it reads the Upstash token); import it from route
 * handlers / server components, never from a "use client" file.
 */

import { buildAggregateArgs, parseAggregations } from "@/lib/hn-query";
import { CATALOG_VERSION, allExampleTerms } from "@/lib/examples";

/** Lean monthly point — just what the gallery sparklines plot. We drop the
 *  histogram's `keyAsString` (an ISO string the mini-charts derive from `key`
 *  anyway) since it was ~55% of the cached blob's bytes. */
export type MonthCount = { key: number; docCount: number };

const URL_ENDPOINT = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const CACHE_KEY = `examples:${CATALOG_VERSION}`;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const BUILD_CONCURRENCY = 8;

export type ExamplesData = {
  version: string;
  generatedAt: string;
  /** term -> its monthly date-histogram (lean points) */
  terms: Record<string, MonthCount[]>;
};

/** Run one Redis command via the Upstash REST command-array endpoint. Returns
 *  null on any failure (missing creds, write denied on a read-only token, …) so
 *  callers can treat the cache as strictly best-effort. */
async function redisCommand<T>(cmd: (string | number)[]): Promise<T | null> {
  if (!URL_ENDPOINT || !TOKEN) return null;
  try {
    const r = await fetch(URL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(cmd),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: T; error?: string };
    if (j.error) return null;
    return (j.result ?? null) as T | null;
  } catch {
    return null;
  }
}

/** One term's monthly histogram, via the exact same aggregate the app runs,
 *  stripped to the lean {key, docCount} points the gallery plots. */
async function fetchBuckets(term: string): Promise<MonthCount[]> {
  const raw = await redisCommand<unknown>(buildAggregateArgs({ q: term }));
  return parseAggregations(raw).buckets.map((b) => ({
    key: b.key,
    docCount: b.docCount,
  }));
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
 * data — the cache is an optimization, never a hard dependency.
 */
export async function getExamplesData(opts?: {
  fresh?: boolean;
}): Promise<ExamplesData> {
  if (!opts?.fresh) {
    const cached = await redisCommand<string>(["GET", CACHE_KEY]);
    if (cached) {
      try {
        const d = JSON.parse(cached) as ExamplesData;
        if (d?.version === CATALOG_VERSION && d.terms) return d;
      } catch {
        // fall through to recompute on a corrupt/legacy value
      }
    }
  }
  const data = await compute();
  await redisCommand([
    "SET",
    CACHE_KEY,
    JSON.stringify(data),
    "EX",
    CACHE_TTL_SECONDS,
  ]);
  return data;
}
