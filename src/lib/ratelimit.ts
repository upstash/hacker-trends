/**
 * Load shedding for `/api/hn`, via `@upstash/ratelimit`. Two layers, both
 * charged only when a request is about to do real work (a result-cache miss):
 *
 *  - per-IP (`rateLimitRequest`): stops one client hammering the uncached path.
 *    Searches and the cheap `op=thread` lookups use separate buckets.
 *  - GLOBAL (`globalSearchBudget`): a shared budget of live Upstash Search calls
 *    across all IPs and instances. The Search DB collapses past ~10 q/s (see
 *    docs/postmortem-2026-06-25.md: pushed harder it completes FEWER queries),
 *    so over budget we fail fast with 503 `busy` instead of queueing.
 *
 * Env (read at cold start):
 *   RATELIMIT_REQUESTS / RATELIMIT_WINDOW                per-IP searches (30 / "10 s")
 *   RATELIMIT_THREAD_REQUESTS                            per-IP thread lookups (120 / same window)
 *   RATELIMIT_GLOBAL_REQUESTS / RATELIMIT_GLOBAL_WINDOW  global live searches (6 / "1 s")
 *   RATELIMIT_ANALYTICS=1                                populate the Upstash dashboard
 *
 * Keep the global budget well under the Search DB's measured ceiling; raise it
 * only after the DB is scaled. Counters live on `cacheRedis()` (the optional
 * CACHE_REDIS_REST_* DB, else the main one) under `ratelimit*` prefixes, so the
 * token must be writable. Every check fails OPEN: an unconfigured or erroring
 * Redis means "allow", never "the API is down".
 */

import { Ratelimit } from "@upstash/ratelimit";
import { cacheRedis } from "./hn-index";

type Duration = Parameters<typeof Ratelimit.slidingWindow>[1];

const WINDOW = (process.env.RATELIMIT_WINDOW ?? "10 s") as Duration;
const LIMIT = Number(process.env.RATELIMIT_REQUESTS ?? 30);
const THREAD_LIMIT = Number(process.env.RATELIMIT_THREAD_REQUESTS ?? 120);
const GLOBAL_LIMIT = Number(process.env.RATELIMIT_GLOBAL_REQUESTS ?? 6);
const GLOBAL_WINDOW = (process.env.RATELIMIT_GLOBAL_WINDOW ?? "1 s") as Duration;

export type LimitKind = "search" | "thread";

// Built once per warm instance, lazily. `null` means "limiting disabled".
let limiters:
  | { search: Ratelimit; thread: Ratelimit; global: Ratelimit }
  | null
  | undefined;

function getLimiters() {
  if (limiters !== undefined) return limiters;
  const redis = cacheRedis();
  if (!redis) {
    // Logged once per cold start so it's visible without spamming every request.
    console.warn("[ratelimit] no Redis credentials - rate limiting disabled");
    limiters = null;
    return limiters;
  }
  // Each ephemeral cache MUST be module-level so it survives across requests on
  // a warm instance: once an IP (or the global budget) is blocked, the limiter
  // rejects from this Map until the window resets, without a Redis round-trip.
  const make = (limit: number, window: Duration, prefix: string) =>
    new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      ephemeralCache: new Map<string, number>(),
      prefix,
      // Analytics writes extra keys per request; off by default.
      analytics: process.env.RATELIMIT_ANALYTICS === "1",
    });
  limiters = {
    search: make(LIMIT, WINDOW, "ratelimit"),
    thread: make(THREAD_LIMIT, WINDOW, "ratelimit:thread"),
    global: make(GLOBAL_LIMIT, GLOBAL_WINDOW, "ratelimit:global"),
  };
  return limiters;
}

/**
 * Best-effort client IP from the proxy headers Vercel sets. `x-forwarded-for` is
 * a comma-separated list "client, proxy1, proxy2..."; the FIRST entry is the
 * real client. `x-real-ip` is Vercel's single-value convenience header. We fall
 * back to a constant so a request with no discernible IP shares one bucket
 * rather than bypassing the limit entirely.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export type RateLimitResult = {
  /** Whether the request is allowed through. True when limiting is disabled. */
  success: boolean;
  /** Standard rate-limit headers. Attach them to the 429 only: a cached 200
   * carrying one client's counters would be replayed to everyone by the CDN. */
  headers: Record<string, string>;
  /** Seconds until the window resets (for `Retry-After`). */
  retryAfter: number;
  /** Resolves background work (analytics/sync); pass to `after()`. */
  pending?: Promise<unknown>;
};

const ALLOW: RateLimitResult = { success: true, headers: {}, retryAfter: 0 };

function secondsUntil(resetMs: number): number {
  return Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
}

/** Check the per-IP limit for `kind`. Fails open on any error. */
export async function rateLimitRequest(
  req: Request,
  kind: LimitKind = "search",
): Promise<RateLimitResult> {
  const l = getLimiters();
  if (!l) return ALLOW;
  try {
    const { success, limit, remaining, reset, pending } = await l[kind].limit(
      getClientIp(req),
    );
    const retryAfter = secondsUntil(reset);
    return {
      success,
      pending,
      retryAfter,
      headers: {
        "RateLimit-Limit": String(limit),
        "RateLimit-Remaining": String(Math.max(0, remaining)),
        "RateLimit-Reset": String(retryAfter),
      },
    };
  } catch (e) {
    console.error("[ratelimit] check failed, allowing request:", e);
    return ALLOW;
  }
}

/**
 * Take one token from the global live-search budget. Call it right before a
 * real Upstash Search query (never for cache hits). Fails open on any error.
 */
export async function globalSearchBudget(): Promise<RateLimitResult> {
  const l = getLimiters();
  if (!l) return ALLOW;
  try {
    const { success, reset, pending } = await l.global.limit("global");
    return { success, pending, retryAfter: secondsUntil(reset), headers: {} };
  } catch (e) {
    console.error("[ratelimit] global check failed, allowing request:", e);
    return ALLOW;
  }
}
