/**
 * Public, CDN-cached gallery dataset for the "Who is hiring?" search page,
 * served as one JSON document at `/who-is-hiring/examples.json`.
 *
 * Why this exists (perf): each gallery card is a relative stacked-bar mini chart
 * over jobs-scoped monthly counts. Without this, every visible card would fan
 * out one `/api/hn` aggregate per term. The main page solves the identical
 * problem with `/examples.json`; this is its jobs-scoped twin.
 *
 * The body is the compact wire form (jobs-gallery-wire.ts): one flat
 * [monthIndex, count, ...] array per DISTINCT part. The client (`useJobsGallery`)
 * fetches it once after the shell paints and assembles each card's series from
 * the parts. A card whose parts are missing renders flat; it never falls back to
 * live aggregates.
 *
 * This route NEVER computes the gallery. The ~105-aggregate build lives entirely
 * in CI (`scripts/prime-jobs-gallery.ts`, run from the daily GitHub Action),
 * which primes the Redis `jobs-gallery-wire:<version>` key. The deployed app
 * only does:
 *   1. Vercel edge CDN - `s-maxage` + `stale-while-revalidate`, so everyone after
 *      the first hit is served at the edge without touching Redis.
 *   2. On a CDN miss, a single (per-instance memoized) Redis GET of the wire key.
 *   3. If that read misses or fails, the in-repo snapshot (a frozen wire copy),
 *      cached only briefly so the primed key is picked up within minutes.
 */

import { readJobsGalleryWire } from "@/lib/jobs-gallery-data";
// Frozen wire snapshot (scripts/dump-jobs-gallery.ts), served when the Redis key
// is missing so the route always answers with valid JSON.
import snapshot from "./snapshot.json";

export const runtime = "nodejs";

// One day at the edge, then up to a week of stale-while-revalidate: the gallery
// only changes when the daily prime runs, so day-old data is fine and the first
// visitor after expiry still gets an instant (stale) response.
const CDN_CACHE = "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

// Snapshot-fallback TTL (mirrors /examples.json): short, so one Redis blip or a
// not-yet-primed version can't pin the fallback for a day, but long enough that
// a spike can't turn the miss into a per-request Redis stampede.
const CDN_CACHE_MISS = "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";

export async function GET() {
  const wire = await readJobsGalleryWire();
  if (!wire) {
    return Response.json(snapshot, { headers: { "cache-control": CDN_CACHE_MISS } });
  }
  return Response.json(wire, { headers: { "cache-control": CDN_CACHE } });
}
