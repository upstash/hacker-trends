/**
 * Prime the /examples gallery cache key: recompute every catalog histogram and
 * write `examples:<CATALOG_VERSION>`, then read the key back to confirm the
 * write persisted. Runs daily from the ingest Action; the deployed app only
 * reads the key.
 *
 *   bun scripts/refresh-cache.ts --write
 *
 * Bare (or --help) prints usage and exits without touching the DB.
 *
 * Exit codes: 0 = a complete build was cached; 1 = creds missing or the build
 * was incomplete (some term still failed after retries), so nothing was written
 * and the previous value keeps serving; 2 = the write did not persist.
 */
export {};
import { buildExamplesCache, readExamplesCache } from "../src/lib/examples-data";
import { CATALOG_VERSION } from "../src/lib/examples";

async function main() {
  if (!process.argv.includes("--write")) {
    console.log(
      "Usage: bun scripts/refresh-cache.ts --write\n" +
        `  recomputes all gallery histograms and WRITES examples:${CATALOG_VERSION} to the Redis in UPSTASH_REDIS_REST_URL/TOKEN`,
    );
    return;
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error("refresh-cache: missing UPSTASH_REDIS_REST_URL/TOKEN");
    process.exit(1);
  }

  console.log(`Recomputing all histograms for catalog ${CATALOG_VERSION}...`);
  const { data, missing, cached } = await buildExamplesCache();
  console.log(`computed: version=${data.version}  terms=${Object.keys(data.terms).length}  missing=${missing.length}  generatedAt=${data.generatedAt}`);
  if (!cached) {
    console.error(`✗ NOT cached - incomplete build. missing terms: ${missing.join(", ")}`);
    process.exit(1);
  }

  const back = await readExamplesCache();
  if (back?.generatedAt === data.generatedAt) {
    console.log(`✓ cache key examples:${CATALOG_VERSION} persisted: terms=${Object.keys(back.terms).length} generatedAt=${back.generatedAt}`);
  } else {
    console.error(`✗ cache key examples:${CATALOG_VERSION} did not read back after the write`);
    process.exit(2);
  }
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
