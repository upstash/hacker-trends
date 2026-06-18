/**
 * Browser client for the app's search/aggregate calls.
 *
 * Requests go browser -> `/api/hn` (a Vercel Edge function) -> Upstash, instead
 * of browser -> Upstash directly. The Edge hop ties the old direct path on
 * latency (the ~600ms query dominates either way) while keeping the Upstash
 * token server-side. The edge route now runs the query through the
 * `@upstash/redis` search SDK and returns the ALREADY-PARSED payload, so the
 * client just reads `result` - no raw REST parsing here anymore. The query
 * shape lives in `hn-query.ts`; the wire contract is just `?op=&q=&sort=&…`.
 */

import {
  type AggregateArgsOpts,
  type AggResponse,
  type Aggregations,
  type HnDoc,
  type SearchArgsOpts,
  type SearchResponse,
} from "./hn-query";

export type {
  HnDoc,
  SortMode,
  SearchResponse,
  Bucket,
  Aggregations,
  AggResponse,
} from "./hn-query";

type Params = Record<string, string | number | undefined>;

async function callEdge<T>(params: Params, signal?: AbortSignal): Promise<T> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  // A given `?op=&q=&sort=&from=&to=&index=…` URL is fully deterministic and the
  // edge route returns it with a real `Cache-Control` (max-age for the browser,
  // s-maxage for the CDN). So DON'T force `no-store`: use the default HTTP cache
  // so re-hovering / re-clicking the SAME (term, month) is served straight from
  // the browser cache - no network, no ~200ms Upstash round-trip - instead of
  // refetching every time. Aborts still work (the cache lookup respects signal).
  const r = await fetch(`/api/hn?${sp.toString()}`, {
    cache: "default",
    signal,
  });
  if (!r.ok) throw new Error(`/api/hn -> ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { result?: T; error?: string };
  if (j.error) throw new Error(j.error);
  return j.result as T;
}

/* ---------- search --------------------------------------------------- */

export async function searchPosts(
  opts: SearchArgsOpts & { signal?: AbortSignal },
): Promise<SearchResponse> {
  const { signal, q, sort, limit = 30, from, to, by, type, scope, index } = opts;
  const t0 = performance.now();
  // The edge route returns the already-mapped HnDoc[].
  const docs = await callEdge<HnDoc[]>(
    { op: "search", q, sort, limit, from, to, by, type, scope, index },
    signal,
  );
  const latencyMs = performance.now() - t0;
  return {
    total: Array.isArray(docs) ? docs.length : 0,
    docs: docs ?? [],
    latencyMs,
  };
}

/* ---------- aggregations ------------------------------------------- */

export async function aggregate(
  opts: AggregateArgsOpts & { signal?: AbortSignal },
): Promise<AggResponse> {
  const { signal, q, from, to, scope, index } = opts;
  const t0 = performance.now();
  // The edge route returns the already-mapped Aggregations.
  const agg = await callEdge<Aggregations>(
    { op: "aggregate", q, from, to, scope, index },
    signal,
  );
  const latencyMs = performance.now() - t0;
  return { ...agg, latencyMs };
}
