/**
 * Prime the /examples gallery cache key after a catalog change: recompute every
 * histogram and best-effort-write `examples:<CATALOG_VERSION>`, then read the key
 * back to confirm the write actually persisted (the deployed token is read-only,
 * so this must be run from an env whose token can write).
 *
 *   bun --env-file=.env.local scripts/refresh-cache.ts
 */
export {};
import { getExamplesData } from "../src/lib/examples-data";
import { CATALOG_VERSION } from "../src/lib/examples";

const URL_ENDPOINT = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

async function main() {
  console.log(`Recomputing all histograms for catalog ${CATALOG_VERSION}...`);
  const data = await getExamplesData({ fresh: true });
  console.log(`computed: version=${data.version}  terms=${Object.keys(data.terms).length}  generatedAt=${data.generatedAt}`);

  const r = await fetch(URL_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(["GET", `examples:${CATALOG_VERSION}`]),
    cache: "no-store",
  });
  const j = (await r.json()) as { result?: string };
  const cached = j.result ? (JSON.parse(j.result) as typeof data) : null;
  if (cached?.version === CATALOG_VERSION) {
    console.log(`✓ cache key examples:${CATALOG_VERSION} persisted: version=${cached.version} terms=${Object.keys(cached.terms).length} generatedAt=${cached.generatedAt}`);
  } else {
    console.log(`✗ cache key examples:${CATALOG_VERSION} NOT written (token is read-only?). Live compute still works; prime from a writable env.`);
    process.exit(2);
  }
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
