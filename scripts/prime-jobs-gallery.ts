/**
 * CI-only: recompute the "Who is hiring?" gallery histograms from the live index
 * and write the encoded wire payload to the Redis `jobs-gallery-wire:<version>`
 * key that `/who-is-hiring/examples.json` serves.
 *
 * Why a script (not the route): the build fans out ~120 jobs-scoped aggregates
 * and needs a WRITABLE Upstash token, which the deployed app deliberately does
 * NOT have. So the route is read-only and this runs from the daily GitHub Action
 * (next to the ingest), keeping all gallery computation out of Vercel.
 *
 * Run:  bun scripts/prime-jobs-gallery.ts
 * Requires UPSTASH_REDIS_REST_URL + a WRITABLE UPSTASH_REDIS_REST_TOKEN in env.
 *
 * Exit codes: 0 = cached a complete build; 1 = creds missing or build was
 * incomplete (some curated part returned empty) so nothing was cached - the
 * Action surfaces this as a failure so a degraded gallery doesn't pass silently.
 */
import { buildJobsGalleryWire } from "@/lib/jobs-gallery-data";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("prime-jobs-gallery: missing UPSTASH_REDIS_REST_URL/TOKEN");
  process.exit(1);
}

const { wire, cached } = await buildJobsGalleryWire();
const parts = Object.keys(wire.terms);
const empty = parts.filter((p) => wire.terms[p].length === 0);
console.error(
  `version=${wire.version} parts=${parts.length} empty=${empty.length} cached=${cached}`,
);

if (!cached) {
  console.error(
    `NOT cached - incomplete build. empty parts: ${empty.join(", ") || "(none?)"}`,
  );
  process.exit(1);
}
console.error(`primed jobs-gallery-wire:${wire.version}`);
