/**
 * One-off: write the OLD baked gallery snapshot (the committed wire copy in
 * src/app/examples.json/snapshot.json, captured before the index went down) back
 * into the `examples:<CATALOG_VERSION>` Redis key, so `/examples.json` serves the
 * old good 308-term data while querying is ENABLED - instead of the
 * fresh-but-incomplete current-month recompute.
 *
 * The snapshot is in WIRE form; the cache key holds RAW {key,docCount} form, so
 * we decode the wire back to raw before writing. The route re-encodes it to the
 * identical wire (the main page uses a stable slot grid), so this round-trips.
 *
 *   bun scripts/restore-examples-snapshot.ts
 */
export {};
import { Redis } from "@upstash/redis";
import { decodeExamplesWire } from "../src/lib/examples-wire";
import { CATALOG_VERSION } from "../src/lib/examples";
import snapshot from "../src/app/examples.json/snapshot.json";

const CACHE_KEY = `examples:${CATALOG_VERSION}`;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, same as examples-data.ts

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

if (snapshot.version !== CATALOG_VERSION) {
  console.error(
    `version mismatch: snapshot=${snapshot.version} catalog=${CATALOG_VERSION} - aborting`,
  );
  process.exit(1);
}

const terms = decodeExamplesWire(snapshot as Parameters<typeof decodeExamplesWire>[0]);
const data = {
  version: CATALOG_VERSION,
  generatedAt: new Date().toISOString(),
  terms,
};
console.error(`decoded ${Object.keys(terms).length} terms from snapshot ${snapshot.version}`);

await redis.set(CACHE_KEY, JSON.stringify(data), { ex: CACHE_TTL_SECONDS });

// Read back + confirm.
const back = await redis.get<typeof data | string>(CACHE_KEY);
const o = typeof back === "string" ? JSON.parse(back) : back;
console.error(
  `✓ wrote ${CACHE_KEY}: version=${o?.version} terms=${Object.keys(o?.terms ?? {}).length}`,
);
