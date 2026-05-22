/**
 * Browser client for the app's search/aggregate calls.
 *
 * Requests now go browser -> `/api/hn` (a Vercel Edge function) -> Upstash,
 * instead of browser -> Upstash directly. The Edge hop ties the old direct
 * path on latency (the ~600ms query dominates either way) while keeping the
 * Upstash token server-side. Command construction + response parsing live in
 * `hn-query.ts`; the edge route builds the same command from these params, so
 * the wire contract is just `?op=&q=&sort=&…`.
 */

import {
  parseAggregations,
  parseDocs,
  type AggregateArgsOpts,
  type AggResponse,
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
  const r = await fetch(`/api/hn?${sp.toString()}`, {
    cache: "no-store",
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
  const { signal, q, sort, limit = 30, from, to, by, type } = opts;
  const t0 = performance.now();
  const raw = await callEdge<unknown>(
    { op: "search", q, sort, limit, from, to, by, type },
    signal,
  );
  const latencyMs = performance.now() - t0;
  return {
    total: Array.isArray(raw) ? raw.length : 0,
    docs: parseDocs(raw),
    latencyMs,
  };
}

/* ---------- aggregations ------------------------------------------- */

export async function aggregate(
  opts: AggregateArgsOpts & { signal?: AbortSignal },
): Promise<AggResponse> {
  const { signal, q, from, to } = opts;
  const t0 = performance.now();
  const raw = await callEdge<unknown[]>({ op: "aggregate", q, from, to }, signal);
  const latencyMs = performance.now() - t0;
  return { ...parseAggregations(raw), latencyMs };
}
