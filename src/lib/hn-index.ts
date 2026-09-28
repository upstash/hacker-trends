/**
 * The one place the app talks to Upstash Redis Search through the official
 * `@upstash/redis` SDK (`redis.search.index(...).query(...)` / `.aggregate(...)`).
 *
 * Everything else - the Node `/api/hn` route, the server-side landing/gallery
 * data layers, and the bench/validate scripts - goes through here, so there is
 * exactly ONE construction of the `Redis` clients and ONE mapping from the SDK's
 * return shapes to the app's `HnDoc` / `Aggregations` types. The query *shape*
 * (filter, orderBy, scoreFunc, aggregations) still lives in `hn-query.ts`; this
 * module only runs it and parses the result. Server-only: it reads the tokens.
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
 * Build a `Redis` client for the Search DB from explicit credentials or, with no
 * args, from `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (the route,
 * the server data layers and the scripts). That token is WRITABLE (the limiters,
 * result cache and ingest all write). The client is just an HTTP wrapper, so a
 * fresh one per request is cheap.
 */
export function hnRedis(creds?: { url: string; token: string }): Redis {
  if (creds) return new Redis({ url: creds.url, token: creds.token });
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

// Every cache/limiter/lock/flag command is small, so cap each one: a stalled
// cache DB must degrade to "miss" / "allow", never hang the request.
const CACHE_CMD_TIMEOUT_MS = 1000;
let cacheClient: Redis | null | undefined;

/**
 * The Redis used for the `/api/hn` result cache, rate limiters, single-flight
 * locks and the runtime kill-switch flag. Set `CACHE_REDIS_REST_URL` +
 * `CACHE_REDIS_REST_TOKEN` (a separate plain Upstash Redis) so a saturated
 * Search DB can't also stall cache hits; unset, it falls back to the main
 * `UPSTASH_REDIS_REST_*` DB. `null` when neither is configured. Commands time out
 * after CACHE_CMD_TIMEOUT_MS and throw, which every caller treats as fail-open.
 */
export function cacheRedis(): Redis | null {
  if (cacheClient !== undefined) return cacheClient;
  const own = process.env.CACHE_REDIS_REST_URL && process.env.CACHE_REDIS_REST_TOKEN;
  const url = own ? process.env.CACHE_REDIS_REST_URL : process.env.UPSTASH_REDIS_REST_URL;
  const token = own
    ? process.env.CACHE_REDIS_REST_TOKEN
    : process.env.UPSTASH_REDIS_REST_TOKEN;
  cacheClient =
    url && token
      ? new Redis({
          url,
          token,
          retry: { retries: 1 },
          signal: () => AbortSignal.timeout(CACHE_CMD_TIMEOUT_MS),
        })
      : null;
  return cacheClient;
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

// HN threads are usually shallow; past this many parents we give up and the UI
// links the immediate parent instead.
const MAX_THREAD_HOPS = 12;

export type ThreadRoot = { id: number; title: string | null };

/**
 * Resolve the root story of many items at once by walking their `parent`
 * chains in the index. The index stores only each item's immediate `parent`, so
 * each hop is ONE pipelined HMGET round-trip covering every chain still walking
 * (deduped: comments sharing an ancestor share its lookup), bounded to
 * MAX_THREAD_HOPS. An item carrying a real title (or type story) is the root;
 * a dead/missing ancestor ends that chain. Returns start id -> root, with no
 * entry for chains that ran out.
 */
export async function resolveThreadRoots(
  redis: Redis,
  startIds: number[],
): Promise<Map<number, ThreadRoot>> {
  const out = new Map<number, ThreadRoot>();
  // ancestor id being looked up -> start ids waiting on it
  let frontier = new Map<number, number[]>();
  for (const s of new Set(startIds)) {
    if (s > 0) frontier.set(s, [s]);
  }
  for (let hop = 0; hop < MAX_THREAD_HOPS && frontier.size > 0; hop++) {
    const ids = [...frontier.keys()];
    const p = redis.pipeline();
    for (const id of ids) p.hmget(`hn:${id}`, "title", "type", "parent");
    const rows = (await p.exec()) as (Record<string, unknown> | null)[];
    const next = new Map<number, number[]>();
    ids.forEach((id, i) => {
      const waiting = frontier.get(id)!;
      const f = rows[i];
      const title = f?.title == null ? null : String(f.title);
      if (f?.type === "story" || (title && title.length > 0)) {
        for (const s of waiting) out.set(s, { id, title });
        return;
      }
      const parent = Number(f?.parent ?? 0);
      if (parent > 0) next.set(parent, [...(next.get(parent) ?? []), ...waiting]);
    });
    frontier = next;
  }
  return out;
}

/**
 * Attach `thread` (the root story) to every comment doc, for the result list's
 * `on thread "<title>"` label. Walks from each comment's `parent`, so a direct
 * reply to a story costs one hop. Best effort: a Redis error leaves the docs
 * without `thread` rather than failing the search.
 */
export async function withThreads(redis: Redis, docs: HnDoc[]): Promise<HnDoc[]> {
  const comments = docs.filter((d) => d.type === "comment" && d.parent);
  if (comments.length === 0) return docs;
  try {
    const roots = await resolveThreadRoots(
      redis,
      comments.map((d) => d.parent!),
    );
    return docs.map((d) => {
      const root = d.type === "comment" && d.parent ? roots.get(d.parent) : undefined;
      return root ? { ...d, thread: root } : d;
    });
  } catch (e) {
    console.error("[hn-index] thread resolution failed:", e);
    return docs;
  }
}

/** Single-item form for `/api/hn?op=thread&id=`: the root story of `startId`,
 * or `{ id: null, title: null }` when the walk runs out. */
export async function resolveThreadRoot(
  redis: Redis,
  startId: number,
): Promise<{ id: number | null; title: string | null }> {
  const root = (await resolveThreadRoots(redis, [startId])).get(startId);
  return root ?? { id: null, title: null };
}
