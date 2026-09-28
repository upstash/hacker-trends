/**
 * CI-only: recompute the "Who is hiring?" gallery histograms from the live index
 * and write the encoded wire payload to the Redis `jobs-gallery-wire:<version>`
 * key that `/who-is-hiring/examples.json` (and the landing pages) read.
 *
 * Why a script (not the route): the build fans out ~105 jobs-scoped aggregates
 * and a Redis write, which the deployed app must never do on a request path. So
 * the app only reads the key and this runs from the daily GitHub Action (after
 * the ingest), keeping all gallery computation out of Vercel.
 *
 * Run:  bun scripts/prime-jobs-gallery.ts --write
 * Without `--write` it only prints this usage and exits 0 (it would otherwise
 * aggregate against, and write to, the live database).
 * Requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env.
 *
 * Exit codes: 0 = cached a complete build (or usage); 1 = creds missing or the
 * build was incomplete (some curated part returned empty) so nothing was cached
 * - the Action surfaces this as a failure so a degraded gallery doesn't pass
 * silently.
 */
import {
  allGalleryParts,
  buildJobsGalleryWire,
  JOBS_GALLERY_VERSION,
} from "@/lib/jobs-gallery-data";

const args = process.argv.slice(2);
if (!args.includes("--write") || args.includes("--help")) {
  console.error(
    [
      "usage: bun scripts/prime-jobs-gallery.ts --write",
      "",
      `Aggregates every gallery part on the LIVE index and writes`,
      `jobs-gallery-wire:${JOBS_GALLERY_VERSION} (30-day TTL). Nothing runs without --write.`,
    ].join("\n"),
  );
  process.exit(0);
}

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("prime-jobs-gallery: missing UPSTASH_REDIS_REST_URL/TOKEN");
  process.exit(1);
}

const { wire, cached } = await buildJobsGalleryWire();
// An empty part is omitted from the wire (never stored as a false zero).
const missing = allGalleryParts().filter((p) => !(wire.terms[p]?.length > 0));
console.error(
  `version=${wire.version} parts=${Object.keys(wire.terms).length} missing=${missing.length} cached=${cached}`,
);

if (!cached) {
  console.error(`NOT cached - incomplete build. missing parts: ${missing.join(", ")}`);
  process.exit(1);
}
console.error(`primed jobs-gallery-wire:${wire.version}`);
