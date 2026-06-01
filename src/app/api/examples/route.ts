/**
 * Serves the /examples gallery data: one date-histogram per catalog term,
 * computed once and cached under a single Redis key. See `examples-data.ts`.
 *
 * GET /api/examples          → the cached blob (computes + caches on a miss)
 * GET /api/examples?fresh=1  → force a recompute + re-cache (use from a writable
 *                              env to prime the key after the catalog changes)
 *
 * Node runtime (not Edge): a cache miss fans out ~150 aggregate calls, which is
 * happier with Node's networking than the Edge runtime's limits.
 */

import { getExamplesData } from "@/lib/examples-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  try {
    const data = await getExamplesData({ fresh });
    return Response.json(data, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
