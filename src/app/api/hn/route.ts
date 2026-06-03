/**
 * Live search/aggregate endpoint for the app: a thin Vercel Edge proxy in
 * front of Upstash Redis Search.
 *
 * The ~600ms Upstash query dominates total latency, so a browser-direct call
 * and an edge hop are a latency wash; we run on the Edge because it ties
 * browser-direct while keeping the Upstash credential server-side and giving
 * us one place to add caching later.
 *
 * It runs the byte-identical command the browser used to build (via the shared
 * `argsFromParams`) and passes Upstash's JSON body straight back through, so
 * the client keeps its existing `{ result } | { error }` parsing.
 */

import { argsFromParams, encodePath } from "@/lib/hn-query";

export const runtime = "edge";
// NOTE: intentionally NOT pinning preferredRegion. This is a global app, so the
// edge function should run nearest each viewer (Vercel's default) to keep the
// browser→edge hop short worldwide. The edge→Upstash hop does cost an extra RTT
// for viewers far from the Frankfurt read region, but caching (below) makes that
// a one-time-per-query cost rather than something every visitor pays.

// How long the edge/CDN may serve a cached query response before refetching, and
// how long it may serve a stale one while revalidating in the background. The HN
// index is rebuilt by a periodic ingest (not live), and these are trend queries
// over 18 years of data, so an hour of staleness is invisible — but it turns the
// ~600ms Upstash query into a ~50ms CDN hit for every repeat of a given query
// (and the popular gallery terms are shared across all visitors). This is the
// single biggest latency win; the query itself dominates and caching skips it.
const SEARCH_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

// Server-side read-only Upstash credentials. These live only on the server and
// never reach the browser; the client talks exclusively to this edge route,
// never to Upstash directly. Set UPSTASH_REDIS_REST_TOKEN to a read-only ACL
// token in the deployment environment.
const URL_ENDPOINT = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

export async function GET(req: Request) {
  if (!URL_ENDPOINT || !TOKEN) {
    return json(
      { error: "Missing Upstash credentials on the server" },
      500,
    );
  }

  const params = new URL(req.url).searchParams;

  // `op=thread`: resolve the root story a comment hangs under, so the result
  // list can label it `on thread "<title>"`. Our index stores only each item's
  // immediate `parent`, so we walk parents up to the story — a few HGETs deep
  // at most — all against the same Upstash index (no external HN API).
  if (params.get("op") === "thread") return resolveThread(params.get("id"));

  const path = encodePath(argsFromParams(params));

  try {
    const r = await fetch(`${URL_ENDPOINT}/${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: "no-store",
    });
    // Pass Upstash's body straight through ({ result } | { error }). A given
    // (op,q,sort,range,…) URL is deterministic, so let the CDN cache the OK
    // responses (see SEARCH_CACHE); never cache an error, or a transient Upstash
    // blip would stick for the whole TTL.
    return new Response(await r.text(), {
      status: r.status,
      headers: {
        "content-type": "application/json",
        "cache-control": r.ok ? SEARCH_CACHE : "no-store, max-age=0",
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}

/**
 * Walk a comment's parent chain in the Upstash index until we reach the story
 * it belongs to, returning `{ id, title }` for that story. Bounded to a handful
 * of hops (HN threads are shallow) and tolerant of gaps — a dead/missing
 * ancestor (we don't index dead items) just ends the walk with what we have.
 */
async function resolveThread(startId: string | null): Promise<Response> {
  if (!startId) return json({ error: "missing id" }, 400);
  const headers = { Authorization: `Bearer ${TOKEN}` };
  let id = startId;
  for (let hop = 0; hop < 12 && id && id !== "0"; hop++) {
    const r = await fetch(`${URL_ENDPOINT}/HMGET/hn:${id}/title/type/parent`, {
      headers,
      cache: "no-store",
    });
    if (!r.ok) break;
    const j = (await r.json()) as { result?: (string | null)[] };
    const [title, type, parent] = j.result ?? [];
    // A story (or any item carrying a real title) is the thread root.
    if (type === "story" || (title && title.length > 0)) {
      return json({ result: { id: Number(id), title } }, 200, SEARCH_CACHE);
    }
    if (!parent || parent === "0") break;
    id = parent;
  }
  return json({ result: { id: null, title: null } }, 200, SEARCH_CACHE);
}

function json(body: unknown, status: number, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cacheControl },
  });
}
