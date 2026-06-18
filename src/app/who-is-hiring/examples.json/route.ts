/**
 * Public, CDN-cached gallery dataset for the "Who is hiring?" search page,
 * served as one JSON document at `/who-is-hiring/examples.json`.
 *
 * Why this exists (perf): each gallery card is a relative stacked-bar mini chart
 * over LIVE jobs-scoped aggregates. Without this, every visible card fans out
 * one cold `/api/hn` aggregate per term - dozens of round trips before the
 * gallery fills in. The main page solves the identical problem with
 * `/examples.json`; this is its jobs-scoped twin.
 *
 * The body is the compact wire form (jobs-gallery-wire.ts): one flat
 * [monthIndex, count, ...] array per DISTINCT part, far smaller than the raw
 * {key, docCount} objects. The client (`JobsMiniCard`) fetches it once after the
 * shell paints, decodes it, and assembles each card's series from the parts -
 * falling back to a live per-card aggregate only if this fetch fails.
 *
 * Caching: the response carries `s-maxage` + `stale-while-revalidate` (the SAME
 * shape as `/examples.json`), so Vercel's edge CDN serves it without touching
 * Redis for everyone after the first hit and keeps serving a slightly-stale copy
 * while it refreshes in the background. The jobs gallery only changes when the
 * curated set or the daily index does, so day-old data is fine.
 *
 * Node runtime (not Edge): a cold cache miss fans out ~120 aggregate calls on the
 * way to priming the single Redis key, which is happier on Node's networking.
 */

import { getJobsGalleryData } from "@/lib/jobs-gallery-data";
import { encodeJobsGalleryWire } from "@/lib/jobs-gallery-wire";

export const runtime = "nodejs";

// One day at the edge, then up to a week of stale-while-revalidate: the gallery
// only changes when the catalog/index does, so day-old data is fine and the
// first visitor after expiry still gets an instant (stale) response. Mirrors the
// main /examples.json route's headers exactly.
const CDN_CACHE = "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

export async function GET() {
  try {
    const wire = encodeJobsGalleryWire(await getJobsGalleryData());
    return Response.json(wire, { headers: { "cache-control": CDN_CACHE } });
  } catch (e) {
    // Never cache a failure - let the next request retry against Redis.
    return Response.json(
      { error: (e as Error).message },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
