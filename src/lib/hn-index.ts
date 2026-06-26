/**
 * The one place the app talks to Upstash Redis Search through the official
 * `@upstash/redis` SDK (`redis.search.index(...).query(...)` / `.aggregate(...)`).
 *
 * Everything else - the edge `/api/hn` route, the server-side landing/gallery
 * data layers, and the bench/validate scripts - goes through here, so there is
 * exactly ONE construction of the `Redis` client and ONE mapping from the SDK's
 * return shapes to the app's `HnDoc` / `Aggregations` types. The query *shape*
 * (filter, orderBy, scoreFunc, aggregations) still lives in `hn-query.ts`; this
 * module only runs it and parses the result.
 *
 * `@upstash/redis` is fetch-based and edge-compatible, so this is safe to import
 * from the Vercel Edge runtime (the `/api/hn` route) - keep it on web-standard
 * APIs only, no Node built-ins.
 */

import { Redis } from "@upstash/redis";
import {
  buildAggregateOptions,
  buildSearchOptions,
  mapAggregations,
  mapDocs,
  type AggregateArgsOpts,
  type Aggregations,
  type HnDoc,
  type SearchArgsOpts,
  type SearchIndex,
} from "./hn-query";

/**
 * The SDK's `query()`/`aggregate()` live on a `redis.search.index({ name })`.
 * We pass NO schema on purpose: with the default (untyped) schema the SDK takes
 * a plain-object filter (exactly what `buildFilter` returns) and returns rows as
 * `{ key, score, data }` with a `Record<string, unknown>` `data`, which is all
 * `mapDocs`/`mapAggregations` need. The real schema is declared once, at write
 * time, in scripts/ingest*.ts (and shown in the SETUP snippet).
 */
function indexFor(redis: Redis, name: SearchIndex) {
  return redis.search.index({ name });
}

/**
 * Build a `Redis` client from explicit credentials (the edge route passes the
 * server-only token) or, with no args, from `UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN` in the environment (the server data layers + the
 * scripts). The client is just an HTTP wrapper, so a fresh one per request is
 * cheap and keeps the token out of module scope.
 */
export function hnRedis(creds?: { url: string; token: string }): Redis {
  if (creds) return new Redis({ url: creds.url, token: creds.token });
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

/**
 * Run a SEARCH.QUERY through the SDK and map the `{ key, score, data }[]` rows
 * the SDK returns onto the app's `HnDoc[]`. The query shape (filter + orderBy /
 * scoreFunc) comes straight from `buildSearchOptions`, so the executed call is
 * the same one `searchSnippet` renders in the "show the code" panel.
 */
export async function runSearch(
  redis: Redis,
  opts: SearchArgsOpts,
): Promise<HnDoc[]> {
  const { index, options } = buildSearchOptions(opts);
  const rows = await indexFor(redis, index).query(options);
  return mapDocs(rows);
}

/**
 * Run a SEARCH.AGGREGATE through the SDK and map the structured aggregation
 * object (by_month date-histogram) onto the app's `Aggregations`. The filter +
 * aggregations come from `buildAggregateOptions`, matching what
 * `aggregateSnippet` renders.
 */
export async function runAggregate(
  redis: Redis,
  opts: AggregateArgsOpts,
): Promise<Aggregations> {
  const { index, options } = buildAggregateOptions(opts);
  const agg = await indexFor(redis, index).aggregate(options);
  return mapAggregations(agg);
}

/**
 * Resolve the root story a comment hangs under by walking its `parent` chain in
 * the index, so the result list can label a posting `on thread "<title>"`. The
 * index stores only each item's immediate `parent`, so we HMGET a few items deep
 * (HN threads are shallow) until we hit something carrying a real title. Bounded
 * to a handful of hops and tolerant of gaps (a dead/missing ancestor just ends
 * the walk). Returns `{ id, title }` for the root, or `{ id: null, title: null }`
 * when the walk runs out.
 */
export async function resolveThreadRoot(
  redis: Redis,
  startId: string,
): Promise<{ id: number | null; title: string | null }> {
  let id = startId;
  for (let hop = 0; hop < 12 && id && id !== "0"; hop++) {
    const fields = (await redis.hmget(`hn:${id}`, "title", "type", "parent")) as
      | Record<string, string | null>
      | null;
    const title = fields?.title ?? null;
    const type = fields?.type ?? null;
    const parent = fields?.parent ?? null;
    // A story (or any item carrying a real title) is the thread root.
    if (type === "story" || (title && String(title).length > 0)) {
      return { id: Number(id), title: title == null ? null : String(title) };
    }
    if (!parent || parent === "0") break;
    id = String(parent);
  }
  return { id: null, title: null };
}
