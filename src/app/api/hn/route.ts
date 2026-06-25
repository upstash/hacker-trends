/**
 * Live search/aggregate endpoint for the app: a thin Vercel Edge function in
 * front of Upstash Redis Search, driven by the official `@upstash/redis` search
 * SDK (`redis.search.index({ name }).query(...)` / `.aggregate(...)`).
 *
 * The ~600ms Upstash query dominates total latency, so a browser-direct call
 * and an edge hop are a latency wash; we run on the Edge because it ties
 * browser-direct while keeping the Upstash credential server-side and giving
 * us one place to cache. `@upstash/redis` is fetch-based and edge-compatible,
 * so the SDK runs here unchanged.
 *
 * It runs the byte-equivalent query the browser asks for (built from the shared
 * `hn-query.ts` option builders), maps the SDK's parsed result onto the app's
 * `HnDoc[]` / `Aggregations` types, and returns the ALREADY-PARSED payload in
 * the same `{ result } | { error }` envelope the client already expects - so
 * the browser just reads `result` (no more raw REST parsing client-side).
 */

import {
  runAggregate,
  runSearch,
  resolveThreadRoot,
  hnRedis,
} from "@/lib/hn-index";
import {
  DEFAULT_INDEX,
  type Scope,
  type SearchIndex,
  type SortMode,
} from "@/lib/hn-query";
import { QUERYING_DISABLED, QUERYING_DISABLED_LABEL } from "@/lib/maintenance";

export const runtime = "edge";
// NOTE: intentionally NOT pinning preferredRegion. This is a global app, so the
// edge function should run nearest each viewer (Vercel's default) to keep the
// browser→edge hop short worldwide. The edge→Upstash hop does cost an extra RTT
// for viewers far from the Frankfurt read region, but caching (below) makes that
// a one-time-per-query cost rather than something every visitor pays.

// How long the edge/CDN may serve a cached query response before refetching, and
// how long it may serve a stale one while revalidating in the background. The HN
// index is rebuilt by a periodic ingest (not live), and these are trend queries
// over 18 years of data, so an hour of staleness is invisible - but it turns the
// ~600ms Upstash query into a ~50ms CDN hit for every repeat of a given query
// (and the popular gallery terms are shared across all visitors). This is the
// single biggest latency win; the query itself dominates and caching skips it.
//
// `max-age=300` ALSO lets each viewer's OWN browser cache hold the response, so
// re-hovering / re-clicking the SAME (term, month) bar in the drill-down is an
// instant browser-cache hit (0ms, no network) rather than a fresh ~200ms Upstash
// round-trip. The deterministic per-(term,month) URL is the cache key; a short
// browser TTL keeps a single session snappy while the CDN's longer `s-maxage`
// (+ SWR) still absorbs the cross-visitor repeats. The client must NOT send
// `cache: no-store` for this to bite (see hn-search.ts).
const SEARCH_CACHE =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

// Server-side read-only Upstash credentials. These live only on the server and
// never reach the browser; the client talks exclusively to this edge route,
// never to Upstash directly. Set UPSTASH_REDIS_REST_TOKEN to a read-only ACL
// token in the deployment environment.
const URL_ENDPOINT = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

export async function GET(req: Request) {
  // Live querying is disabled while the index is down: the whole app runs off the
  // CDN-cached gallery data, so this route never touches Upstash. Return the
  // neutral "disabled" message (the client guards against calling here at all, so
  // this is just defense-in-depth for any stale page that still tries).
  if (QUERYING_DISABLED) {
    return json({ error: QUERYING_DISABLED_LABEL }, 503);
  }

  if (!URL_ENDPOINT || !TOKEN) {
    return json({ error: "Missing Upstash credentials on the server" }, 500);
  }

  const params = new URL(req.url).searchParams;
  const redis = hnRedis({ url: URL_ENDPOINT, token: TOKEN });

  try {
    // `op=thread`: resolve the root story a comment hangs under, so the result
    // list can label it `on thread "<title>"`. Our index stores only each
    // item's immediate `parent`, so the helper HMGETs up the parent chain to
    // the story - a few hops at most - all against the same Upstash index.
    if (params.get("op") === "thread") {
      const id = params.get("id");
      if (!id) return json({ error: "missing id" }, 400);
      const root = await resolveThreadRoot(redis, id);
      return json({ result: root }, 200, SEARCH_CACHE);
    }

    const op = (params.get("op") as "search" | "aggregate") ?? "search";
    const q = params.get("q") ?? "";
    const from = params.get("from") ?? undefined;
    const to = params.get("to") ?? undefined;
    // Only `jobs` is a valid scope today; anything else is treated as no scope.
    const scope: Scope = params.get("scope") === "jobs" ? "jobs" : undefined;
    // Only `hnjobs` is a valid alternate index today; anything else is the
    // default shared `hn` index. The chart/gallery aggregates AND the drill-down
    // send `index=hnjobs` once that index is populated, falling back to `hn`
    // (scope=jobs) otherwise.
    const index: SearchIndex =
      params.get("index") === "hnjobs" ? "hnjobs" : DEFAULT_INDEX;

    // Run the SDK query/aggregate and return the ALREADY-PARSED payload. A given
    // (op,q,sort,range,…) URL is deterministic, so let the CDN cache the OK
    // responses (see SEARCH_CACHE); the catch below never caches an error, so a
    // transient Upstash blip can't stick for the whole TTL.
    if (op === "aggregate") {
      const result = await runAggregate(redis, { q, from, to, scope, index });
      return json({ result }, 200, SEARCH_CACHE);
    }

    const result = await runSearch(redis, {
      q,
      sort: (params.get("sort") as SortMode) ?? "relevance",
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      from,
      to,
      by: params.get("by") ?? undefined,
      type: params.get("type") ?? undefined,
      scope,
      index,
    });
    return json({ result }, 200, SEARCH_CACHE);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}

function json(body: unknown, status: number, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cacheControl },
  });
}
