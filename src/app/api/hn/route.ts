/**
 * Live search/aggregate endpoint: a Node serverless function in front of
 * Upstash Redis Search, run through the official `@upstash/redis` search SDK
 * (via hn-index.ts). The Upstash token stays server-side, and this is the one
 * place results are cached and load is shed. It returns the ALREADY-PARSED
 * payload as `{ result }`; every non-200 is `{ error, code: ApiErrorCode }`.
 *
 * A request goes through, cheapest first:
 *  1. kill switch (runtime flag or build const)            -> 503 disabled
 *  2. params parsed into a normalized option object         -> 400 bad_request
 *  3. Redis result cache, keyed by that object only (unknown params and params
 *     the op ignores never reach the key)                   -> 200
 *  4. on a miss, the per-IP limit                           -> 429 rate_limited
 *  5. single-flight: identical misses share one computation, in-process via a
 *     shared promise and across instances via a SET NX lock (losers poll the
 *     cache for the winner's result, bounded)
 *  6. the winner takes a token from the GLOBAL live-search budget (the Search
 *     DB collapses past ~10 q/s, see docs/postmortem-2026-06-25.md), then runs
 *     the query and caches it                               -> 503 busy / 502
 * Cache, limiter and lock errors fail open, like a cache miss.
 */

import {
  cacheRedis,
  hnRedis,
  resolveThreadRoot,
  runAggregate,
  runSearch,
  withThreads,
} from "@/lib/hn-index";
import {
  DEFAULT_INDEX,
  normalizeQuery,
  type Scope,
  type SearchIndex,
  type SortMode,
} from "@/lib/hn-query";
import type { ApiErrorCode } from "@/lib/hn-search";
import { QUERYING_DISABLED_LABEL } from "@/lib/maintenance";
import { globalSearchBudget, rateLimitRequest } from "@/lib/ratelimit";
import { isQueryingDisabled } from "@/lib/runtime-flags";
import type { Redis } from "@upstash/redis";
import { after } from "next/server";

// Node serverless, NOT Edge. Aggregates over the full ~45M-doc index can run far
// longer than Edge's hard ~25s ceiling for high-frequency terms ("ai", "google",
// "apple" each bucket millions of docs in the $dateHistogram), so on Edge those
// requests were killed with FUNCTION_INVOCATION_TIMEOUT. Node lets us raise
// `maxDuration` so the cold query actually finishes; the Redis + CDN caches below
// then make every repeat instant.
export const runtime = "nodejs";
// Headroom for cold high-frequency aggregates (~30s+ observed). 60s is the Hobby
// ceiling and universally safe; bump toward 300 on Pro if any term still times out.
export const maxDuration = 60;
// Answer (503 busy) before the platform kills us with a bare 504. A computation
// that overruns keeps going in `after()` so its result still lands in the cache.
const DEADLINE_MS = 50_000;

// The index changes once a day (ingest cron ~00:30 UTC), so the CDN may hold a
// response for hours (+ a day of SWR). The browser keeps it 5 minutes, so
// re-hovering the same (term, month) bar is an instant browser-cache hit (the
// client must not send `cache: no-store`, see hn-search.ts).
const SEARCH_CACHE =
  "public, max-age=300, s-maxage=14400, stale-while-revalidate=86400";
// A comment's root story never changes.
const THREAD_CACHE = "public, max-age=86400, s-maxage=604800";
// Short, so turning the runtime kill switch back off takes effect quickly.
const DISABLED_CACHE = "public, max-age=0, s-maxage=15";

// Server-side Redis result cache (see cacheRedis(): the optional dedicated
// cache DB, else the main one). Global across regions, so the first viewer
// anywhere warms it for everyone. Search/aggregate keys carry the data day, so
// each day's data is computed once and then served for the whole day; the TTL
// just outlives the day. Errors are never cached.
const CACHE_PREFIX = "hncache:v2:";
const RESULT_TTL_S = 26 * 3600;
const THREAD_TTL_S = 7 * 86400;
// The ingest starts 00:30 UTC and may run late (30 min timeout, GitHub cron
// delays), so the data day rolls over at 03:00 UTC.
const DATA_DAY_OFFSET_MS = 3 * 3600_000;

// Cross-instance single-flight lock. Its TTL matches `maxDuration`, so a lock
// whose holder died frees itself no later than the holder would have finished.
const LOCK_PREFIX = "hnlock:v1:";
const LOCK_TTL_MS = 60_000;
// How long a loser waits for the winner's cached result before answering busy.
// Waiting costs the Search DB nothing; giving up and querying would.
const LOCK_WAIT_MS = 15_000;
const LOCK_WAIT_RETRY_AFTER_S = 5;

// Server-side Upstash credentials for the Search DB (never sent to the browser).
const URL_ENDPOINT = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

/* ---------- params --------------------------------------------------- */

const SORTS: readonly SortMode[] = ["relevance", "score", "recent", "discussed"];
const TYPES = ["story", "comment", "job", "poll", "pollopt"] as const;
const INDEXES: readonly SearchIndex[] = ["hn", "hnjobs"];
const MAX_Q_LEN = 200;
const MAX_LIMIT = 100;
const MAX_OFFSET = 500;
const DEFAULT_LIMIT = 30;
// Date or full datetime with an explicit zone (a zoneless datetime would parse
// in the server's local time).
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;
const USER_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** A validated request. Field order is fixed and optional fields are omitted
 * when unset, so `JSON.stringify` of it is a canonical cache key. */
type Parsed =
  | { op: "thread"; id: number }
  | {
      op: "aggregate";
      q: string;
      from?: string;
      to?: string;
      scope?: Scope;
      index: SearchIndex;
    }
  | {
      op: "search";
      q: string;
      sort: SortMode;
      limit: number;
      offset: number;
      from?: string;
      to?: string;
      by?: string;
      type?: string;
      scope?: Scope;
      index: SearchIndex;
    };

/** Every non-200 we answer on purpose: status, code and a user-safe message. */
class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const bad = (msg: string) => new ApiFailure(400, "bad_request", msg);
const busy = (retryAfter: number) =>
  new ApiFailure(503, "busy", "Search is busy. Try again shortly.", {
    "Retry-After": String(retryAfter),
  });

function parseParams(sp: URLSearchParams): Parsed {
  const get = (k: string) => sp.get(k)?.trim() || undefined;
  const int = (k: string, def: number, min: number, max: number) => {
    const v = get(k);
    if (v === undefined) return def;
    if (!/^-?\d{1,9}$/.test(v)) throw bad(`invalid ${k}`);
    return Math.min(max, Math.max(min, Number(v)));
  };
  const date = (k: string) => {
    const v = get(k);
    if (v === undefined) return undefined;
    const t = ISO_RE.test(v) ? Date.parse(v) : NaN;
    if (Number.isNaN(t)) throw bad(`invalid ${k}`);
    return new Date(t).toISOString();
  };
  const matching = (k: string, re: RegExp) => {
    const v = get(k);
    if (v !== undefined && !re.test(v)) throw bad(`invalid ${k}`);
    return v;
  };
  const oneOf = <T extends string>(k: string, allowed: readonly T[]) => {
    const v = get(k);
    if (v !== undefined && !allowed.includes(v as T)) throw bad(`invalid ${k}`);
    return v as T | undefined;
  };

  const op = get("op") ?? "search";
  if (op === "thread") {
    const v = get("id");
    if (!v || !/^\d{1,10}$/.test(v) || Number(v) < 1) throw bad("invalid id");
    return { op, id: Number(v) };
  }
  if (op !== "search" && op !== "aggregate") throw bad("invalid op");

  const q = normalizeQuery(sp.get("q") ?? "");
  if (q.length > MAX_Q_LEN) throw bad("query too long");
  const from = date("from");
  const to = date("to");
  const index = oneOf("index", INDEXES) ?? DEFAULT_INDEX;
  // `hnjobs` holds only postings, so the jobs scope is a no-op there (the query
  // builders drop it); leave it out of the key too.
  const scopeParam = oneOf("scope", ["jobs"] as const);
  const scope = index === DEFAULT_INDEX ? scopeParam : undefined;

  if (op === "aggregate") {
    // An empty aggregate is a histogram of all ~45M docs; nothing asks for it.
    if (!q) throw bad("missing q");
    return { op, q, from, to, scope, index };
  }
  return {
    op,
    q,
    sort: oneOf("sort", SORTS) ?? "relevance",
    limit: int("limit", DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: int("offset", 0, 0, MAX_OFFSET),
    from,
    to,
    by: matching("by", USER_RE),
    type: oneOf("type", TYPES),
    scope,
    index,
  };
}

function dataDay(): string {
  return new Date(Date.now() - DATA_DAY_OFFSET_MS).toISOString().slice(0, 10);
}

function cacheKeyFor(p: Parsed): string {
  if (p.op === "thread") return `${CACHE_PREFIX}thread:${p.id}`;
  return `${CACHE_PREFIX}${dataDay()}:${JSON.stringify(p)}`;
}

/* ---------- cache + single-flight ------------------------------------ */

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return (await cacheRedis()?.get<T>(key)) ?? null;
  } catch {
    return null; // a degraded cache is just a miss
  }
}

async function cacheSet(key: string, value: unknown, ttlS: number) {
  try {
    await cacheRedis()?.set(key, value, { ex: ttlS });
  } catch {
    // the result is still returned to the caller
  }
}

/** SET NX the lock. `token` is set only when we own a real lock; a Redis error
 * or no cache DB counts as acquired without one (fail open: compute). */
async function tryLock(key: string): Promise<{ acquired: boolean; token?: string }> {
  const redis = cacheRedis();
  if (!redis) return { acquired: true };
  const token = crypto.randomUUID();
  try {
    const ok = await redis.set(key, token, { nx: true, px: LOCK_TTL_MS });
    return ok === "OK" ? { acquired: true, token } : { acquired: false };
  } catch {
    return { acquired: true };
  }
}

const RELEASE_LOCK =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0';

async function releaseLock(key: string, token: string | undefined) {
  if (!token) return;
  try {
    await cacheRedis()?.eval(RELEASE_LOCK, [key], [token]);
  } catch {
    // it expires on its own
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `after()` while a request scope is live, else just let it run. */
function background(p: Promise<unknown>) {
  try {
    after(p);
  } catch {
    p.catch(() => {});
  }
}

/**
 * Fill a cache miss. With `shared`, only the holder of the cross-instance lock
 * computes: everyone else polls the cache (with backoff) and returns the
 * holder's result, retrying the lock so a failed or dead holder is replaced by
 * exactly one successor. Never more than one computation per key at a time, and
 * a loser that waits LOCK_WAIT_MS answers busy instead of querying. The holder
 * then pays the global budget before the real query. The holder caches the
 * result BEFORE releasing, and every new holder re-checks the cache first, so a
 * result is never computed twice.
 */
async function fillMiss<T>(
  key: string,
  ttlS: number,
  compute: () => Promise<T>,
  shared: boolean,
): Promise<T> {
  const lockKey = LOCK_PREFIX + key;
  let token: string | undefined;
  if (shared) {
    const giveUpAt = Date.now() + LOCK_WAIT_MS;
    let lock = await tryLock(lockKey);
    for (let delay = 150; !lock.acquired; delay = Math.min(delay * 2, 1000)) {
      if (Date.now() + delay > giveUpAt) throw busy(LOCK_WAIT_RETRY_AFTER_S);
      await sleep(delay);
      const hit = await cacheGet<T>(key);
      if (hit !== null) return hit;
      lock = await tryLock(lockKey);
    }
    token = lock.token;
  }
  try {
    if (shared) {
      // Re-check (the previous holder may have cached it just before we got
      // the lock) while taking a global token; a rare hit wastes one token.
      const [hit, budget] = await Promise.all([
        cacheGet<T>(key),
        globalSearchBudget(),
      ]);
      if (budget.pending) background(budget.pending);
      if (hit !== null) return hit;
      if (!budget.success) throw busy(budget.retryAfter);
    }
    const result = await compute();
    await cacheSet(key, result, ttlS);
    return result;
  } finally {
    await releaseLock(lockKey, token);
  }
}

// In-process single-flight: concurrent identical misses on one warm instance
// share one promise (and so one lock/poll loop and one query).
const inflight = new Map<string, Promise<unknown>>();

function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(busy(LOCK_WAIT_RETRY_AFTER_S)), Math.max(0, ms));
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- handler -------------------------------------------------- */

function compute(redis: Redis, p: Parsed): Promise<unknown> {
  if (p.op === "thread") return resolveThreadRoot(redis, p.id);
  if (p.op === "aggregate") {
    return runAggregate(redis, {
      q: p.q,
      from: p.from,
      to: p.to,
      scope: p.scope,
      index: p.index,
    });
  }
  // Comment rows show their root story's title; resolve it here, batched and
  // cached with the result, instead of one `op=thread` call per row.
  return runSearch(redis, {
    q: p.q,
    sort: p.sort,
    limit: p.limit,
    offset: p.offset,
    from: p.from,
    to: p.to,
    by: p.by,
    type: p.type,
    scope: p.scope,
    index: p.index,
  }).then((docs) => (p.index === DEFAULT_INDEX ? withThreads(redis, docs) : docs));
}

export async function GET(req: Request) {
  const started = Date.now();
  if (await isQueryingDisabled()) {
    return fail(new ApiFailure(503, "disabled", QUERYING_DISABLED_LABEL), DISABLED_CACHE);
  }

  let p: Parsed;
  try {
    p = parseParams(new URL(req.url).searchParams);
  } catch (e) {
    return fail(e instanceof ApiFailure ? e : bad("invalid request"));
  }
  if (!URL_ENDPOINT || !TOKEN) {
    console.error("[api/hn] missing UPSTASH_REDIS_REST_URL/TOKEN");
    return fail(new ApiFailure(500, "upstream", "Search is not configured."));
  }

  const isThread = p.op === "thread";
  const key = cacheKeyFor(p);
  const cacheControl = isThread ? THREAD_CACHE : SEARCH_CACHE;
  try {
    const hit = await cacheGet<unknown>(key);
    if (hit !== null) return ok(hit, cacheControl, "hit");

    // A miss: charge the per-IP limit (thread lookups have their own, larger
    // bucket). Cache hits never get here, so they are never limited.
    const rl = await rateLimitRequest(req, isThread ? "thread" : "search");
    if (rl.pending) background(rl.pending);
    if (!rl.success) {
      throw new ApiFailure(429, "rate_limited", "Too many requests. Please slow down.", {
        ...rl.headers,
        "Retry-After": String(rl.retryAfter),
      });
    }

    const redis = hnRedis({ url: URL_ENDPOINT, token: TOKEN });
    const work = singleFlight(key, () =>
      fillMiss(key, isThread ? THREAD_TTL_S : RESULT_TTL_S, () => compute(redis, p), !isThread),
    );
    // If we answer busy at the deadline, let the query finish and fill the cache.
    background(work.then(() => {}, () => {}));
    const result = await withDeadline(work, started + DEADLINE_MS - Date.now());
    return ok(result, cacheControl, "miss");
  } catch (e) {
    if (e instanceof ApiFailure) return fail(e);
    // Log the raw Upstash error; never echo it to the client.
    console.error(`[api/hn] op=${p.op} failed:`, e);
    return fail(new ApiFailure(502, "upstream", "Search failed."));
  }
}

function ok(result: unknown, cacheControl: string, cache: "hit" | "miss"): Response {
  return json({ result }, 200, { "cache-control": cacheControl, "x-hn-cache": cache });
}

/** The error envelope. Never cached, except the kill-switch 503. */
function fail(e: ApiFailure, cacheControl = "no-store"): Response {
  return json({ error: e.message, code: e.code }, e.status, {
    "cache-control": cacheControl,
    ...e.headers,
  });
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
