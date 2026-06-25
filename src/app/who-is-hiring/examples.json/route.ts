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
 * This route NEVER computes the gallery. The ~120-aggregate build lives entirely
 * in CI (`scripts/prime-jobs-gallery.ts`, run from the daily GitHub Action with a
 * WRITABLE token), which primes the Redis `jobs-gallery-wire:<version>` key. The
 * deployed app (read-only token) only does:
 *   1. Vercel edge CDN - `s-maxage` + `stale-while-revalidate`, so everyone after
 *      the first hit is served at the edge without touching Redis.
 *   2. On a CDN miss, a single Redis GET of the pre-primed wire key.
 *   3. If that read misses or fails, the in-repo snapshot (a frozen wire copy).
 * There is no live-compute fallback, so a CDN miss can never fan out aggregates
 * against the index.
 */

import { readJobsGalleryWire } from "@/lib/jobs-gallery-data";
// Frozen wire snapshot (scripts/dump-jobs-gallery.ts), served when the Redis key
// is missing - the always-available floor so the gallery never renders empty.
import snapshot from "./snapshot.json";

export const runtime = "nodejs";

// One day at the edge, then up to a week of stale-while-revalidate: the gallery
// only changes when the catalog/index does, so day-old data is fine and the
// first visitor after expiry still gets an instant (stale) response. Mirrors the
// main /examples.json route's headers exactly.
const CDN_CACHE = "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

export async function GET() {
  // Read-only: try the CI-primed Redis wire key (one KV GET, no index access),
  // else serve the baked snapshot. Never computes, so this is always cheap.
  const wire = (await readJobsGalleryWire()) ?? snapshot;
  return Response.json(wire, { headers: { "cache-control": CDN_CACHE } });
}
