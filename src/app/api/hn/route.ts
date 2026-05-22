/**
 * Live search/aggregate endpoint for the app — a thin Vercel Edge proxy in
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
export const dynamic = "force-dynamic"; // always a live query (no caching yet)

// Server-side read-only Upstash credentials. These live only on the server and
// never reach the browser — the client talks exclusively to this edge route,
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

  const path = encodePath(argsFromParams(new URL(req.url).searchParams));

  try {
    const r = await fetch(`${URL_ENDPOINT}/${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: "no-store",
    });
    // Pass Upstash's body straight through ({ result } | { error }).
    return new Response(await r.text(), {
      status: r.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
