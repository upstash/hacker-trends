/**
 * Public, CDN-cached gallery data: the compact slot-indexed histograms the
 * landing-page sparklines plot, served as one JSON document at `/examples.json`.
 *
 * Why this exists (web-vitals): the homepage used to `await getExamplesData()`
 * inside its server render, so nothing painted until a multi-MB Redis GET + a
 * ~190-term transcode finished — a ~2.6s LCP. The gallery data isn't needed for
 * first paint (the gallery's text/links come from the static catalog), so we
 * lift it out to this endpoint and the client fetches it AFTER the shell paints.
 *
 * Caching: the response carries `s-maxage` + `stale-while-revalidate`, so Vercel's
 * edge CDN serves it without touching Redis for everyone after the first hit, and
 * keeps serving a slightly-stale copy while it refreshes in the background. The
 * payload is the compact wire form (see examples-wire.ts), ~10× smaller than the
 * raw {key,docCount} objects.
 *
 * Node runtime (not Edge): a cold cache miss fans out ~150 aggregate calls on the
 * way to priming the single Redis key, which is happier on Node's networking.
 */

import { getExamplesData } from "@/lib/examples-data";
import { encodeExamplesWire } from "@/lib/examples-wire";

export const runtime = "nodejs";

// One day at the edge, then up to a week of stale-while-revalidate: the gallery
// only changes when the catalog/index does, so day-old data is fine and the
// first visitor after expiry still gets an instant (stale) response.
const CDN_CACHE = "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

export async function GET() {
  try {
    const wire = encodeExamplesWire(await getExamplesData());
    return Response.json(wire, { headers: { "cache-control": CDN_CACHE } });
  } catch (e) {
    // Never cache a failure — let the next request retry against Redis.
    return Response.json(
      { error: (e as Error).message },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
