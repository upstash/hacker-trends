/**
 * IP-based rate limiting for the public edge API, via `@upstash/ratelimit`.
 *
 * CREDENTIAL: this runs against the SAME Upstash database as the search index,
 * using the app's main `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
 * The limiter namespaces its keys under the `ratelimit:` prefix so they never
 * collide with the search index. NOTE: rate limiting WRITES counter keys, so the
 * deployed `UPSTASH_REDIS_REST_TOKEN` must have write access to that DB. If the
 * token is read-only the limit check throws and we fail open (see below) - i.e.
 * a read-only token degrades to "no rate limiting", never to "the API is down".
 *
 * Runtime: `@upstash/ratelimit` + `@upstash/redis` are fetch-based and
 * edge-compatible, so this module is safe to import from the Vercel Edge route.
 * The sliding-window algorithm is one Redis round-trip per request; the
 * module-level ephemeral cache lets an already-blocked IP be rejected in-memory
 * (within a single warm edge instance) without even that round-trip.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Allow this many requests per IP per window before returning 429. The public
// app is read-mostly and CDN-cached, so a human browsing never comes close;
// this is a guard against a single IP hammering the (uncached) edge->Upstash
// path. Tune via env without a redeploy.
const LIMIT = Number(process.env.RATELIMIT_REQUESTS ?? 30);
const WINDOW = (process.env.RATELIMIT_WINDOW ?? "10 s") as Parameters<
  typeof Ratelimit.slidingWindow
>[1];

// The ephemeral cache MUST be module-level (i.e. outside the request handler)
// so it survives across requests on a warm edge instance. Once an IP is blocked
// the limiter can short-circuit it from this Map without hitting Redis.
const ephemeralCache = new Map<string, number>();

// Built once per warm instance, lazily, and only if the dedicated writable
// credentials are present. `null` means "rate limiting disabled" -> allow all.
let limiter: Ratelimit | null | undefined;

function getLimiter(): Ratelimit | null {
  if (limiter !== undefined) return limiter;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // No Upstash credential available: disable (fail-open). Logged once per cold
    // start so it's visible in deploy logs without spamming every request.
    console.warn(
      "[ratelimit] UPSTASH_REDIS_REST_URL/TOKEN not set - rate limiting disabled",
    );
    limiter = null;
    return limiter;
  }

  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(LIMIT, WINDOW),
    ephemeralCache,
    prefix: "ratelimit",
    // Analytics writes extra keys per request; off by default to keep the limiter
    // to a single round-trip. Flip RATELIMIT_ANALYTICS=1 to populate the Upstash
    // Ratelimit dashboard.
    analytics: process.env.RATELIMIT_ANALYTICS === "1",
  });
  return limiter;
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
  /** Standard rate-limit headers to attach to the response (set even on allow). */
  headers: Record<string, string>;
  /** Resolves background work (analytics/sync); pass to waitUntil if available. */
  pending?: Promise<unknown>;
};

/**
 * Check the per-IP rate limit for an incoming edge request. Fail-open on any
 * error or when no writable credential is configured - the public API staying up
 * matters more than enforcing the limit during an Upstash blip.
 */
export async function rateLimitRequest(req: Request): Promise<RateLimitResult> {
  const rl = getLimiter();
  if (!rl) return { success: true, headers: {} };

  const ip = getClientIp(req);
  try {
    const { success, limit, remaining, reset, pending } = await rl.limit(ip);
    return {
      success,
      pending,
      headers: {
        "RateLimit-Limit": String(limit),
        "RateLimit-Remaining": String(Math.max(0, remaining)),
        // Reset is a Unix ms timestamp; expose seconds-until-reset, which is what
        // a `Retry-After`-style consumer expects.
        "RateLimit-Reset": String(Math.max(0, Math.ceil((reset - Date.now()) / 1000))),
      },
    };
  } catch (e) {
    // Redis unreachable / write rejected / any other fault: let the request
    // through rather than failing the whole API closed.
    console.error("[ratelimit] check failed, allowing request:", e);
    return { success: true, headers: {} };
  }
}
