/**
 * Public, CDN-cached gallery data: the compact slot-indexed histograms the
 * landing-page sparklines plot, served as one JSON document at `/examples.json`.
 *
 * Why this exists (web-vitals): the homepage used to `await getExamplesData()`
 * inside its server render, so nothing painted until a multi-MB Redis GET + a
 * ~190-term transcode finished - a ~2.6s LCP. The gallery data isn't needed for
 * first paint (the gallery's text/links come from the static catalog), so we
 * lift it out to this endpoint and the client fetches it AFTER the shell paints.
 *
 * Caching: the response carries `s-maxage` + `stale-while-revalidate`, so Vercel's
 * edge CDN serves it without touching Redis for everyone after the first hit, and
 * keeps serving a slightly-stale copy while it refreshes in the background. The
 * payload is the compact wire form (see examples-wire.ts), ~10× smaller than the
 * raw {key,docCount} objects.
 *
 * PURE-READ on Vercel: this route NEVER computes. The Redis `examples:<version>`
 * key is primed out-of-band by the daily ingest Action (`refresh-cache.ts`); the
 * serverless function only ever does a single GET. On a cache miss it serves the
 * baked snapshot (with a short edge TTL so it self-heals once the Action re-primes)
 * instead of fanning out ~300 aggregates - the read-only prod token can't cache
 * the result anyway, so a computing route would re-run that fan-out on every miss
 * and hammer the Search DB (a contributor to the 2026-06-25 spike SEV-1).
 */

import { readExamplesCache } from "@/lib/examples-data";
import { encodeExamplesWire } from "@/lib/examples-wire";
import { QUERYING_DISABLED } from "@/lib/maintenance";
// Snapshot of the live gallery wire (308 terms), captured from the CDN before
// the index went down. Served verbatim while querying is disabled, AND as the
// fallback on a live cache miss, so the homepage chart + sparklines always have
// lines to draw with zero Upstash compute.
import snapshot from "./snapshot.json";

export const runtime = "nodejs";

// One day at the edge, then up to a week of stale-while-revalidate: the gallery
// only changes when the catalog/index does, so day-old data is fine and the
// first visitor after expiry still gets an instant (stale) response.
const CDN_CACHE = "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

// Snapshot-fallback TTL: much shorter, so a primed key is picked up within
// minutes. Still long enough that a load spike can't turn a cache miss into a
// per-request Redis stampede (the CDN absorbs it between revalidations).
const CDN_CACHE_MISS = "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";

export async function GET() {
  // DB down: serve the baked snapshot (already in wire form) instead of fanning
  // out aggregates to a dead index.
  if (QUERYING_DISABLED) {
    return Response.json(snapshot, { headers: { "cache-control": CDN_CACHE } });
  }
  // Single Redis GET, never a compute. `readExamplesCache()` returns null on a
  // miss / corrupt key / Redis error - all of which fall back to the snapshot.
  const data = await readExamplesCache();
  if (!data) {
    return Response.json(snapshot, { headers: { "cache-control": CDN_CACHE_MISS } });
  }
  return Response.json(encodeExamplesWire(data), {
    headers: { "cache-control": CDN_CACHE },
  });
}
