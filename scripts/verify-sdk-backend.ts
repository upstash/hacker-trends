/**
 * Verify the rewritten `/api/hn` backend now runs through the `@upstash/redis`
 * search SDK (`redis.search.index({ name }).query/aggregate`) and returns the
 * SAME numbers the old hand-built raw-REST path produced.
 *
 *   bun --env-file=.env.local scripts/verify-sdk-backend.ts
 *
 * It exercises the three live data paths through the new SDK helpers
 * (`runAggregate` / `runSearch` in src/lib/hn-index.ts):
 *
 *   (a) aggregate q=rust scope=jobs on the shared `hn` index (the 180-way parent
 *       $or + 30d $dateHistogram) - the CURRENT chart/gallery path.
 *   (b) aggregate q=rust on the dedicated `hnjobs` index (no scope arm).
 *   (c) a drill-down SEARCH q=rust in one recent month on `hnjobs`.
 *
 * Plus the cross-check the PRD's gallery validation relies on: scope=jobs totals
 * for rust / python / react, asserted against the known-good doc counts from the
 * old path (rust ~2691 docs / ~151 monthly buckets; python ~20421; react
 * ~20394). Exits non-zero if any assertion fails.
 */
export {};

import { hnRedis, runAggregate, runSearch } from "../src/lib/hn-index";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error("Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (.env.local)");
}

const redis = hnRedis();

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

/** Sum of all monthly docCounts for a jobs-scoped aggregate on the shared `hn`
 *  index (the value validate-jobs-gallery / probe-jobs-scope assert against). */
async function jobsTotal(q: string): Promise<{ total: number; buckets: number }> {
  const agg = await runAggregate(redis, { q, scope: "jobs" });
  const total = agg.buckets.reduce((s, b) => s + b.docCount, 0);
  return { total, buckets: agg.buckets.length };
}

// Known-good numbers from the OLD raw-REST path (the targets the rewrite must
// reproduce). Job counts grow slightly as new monthly threads are ingested, so
// we allow a small upward tolerance rather than demanding exact equality.
const KNOWN = {
  rust: 2691,
  python: 20421,
  react: 20394,
} as const;
// Counts only ever grow (new postings get added), so accept >= a floor a few
// percent below the recorded number, and reject anything wildly off.
const FLOOR = 0.97; // never expect fewer than 97% of the recorded count
const CEIL = 1.25; // and not more than 25% above (catches a runaway/wrong query)

async function main() {
  console.log(`verify-sdk-backend: ${process.env.UPSTASH_REDIS_REST_URL}\n`);

  /* (a) aggregate q=rust scope=jobs on hn (chart path) ------------------ */
  console.log("(a) aggregate q=rust scope=jobs on `hn`");
  const a = await jobsTotal("rust");
  console.log(`    -> ${a.buckets} monthly buckets, ${a.total} docs`);
  check("rust scope=jobs returns docs", a.total > 0);
  check("rust scope=jobs has monthly buckets", a.buckets >= 140, `${a.buckets} buckets (~151 expected)`);
  check(
    "rust scope=jobs total matches known-good (~2691)",
    a.total >= KNOWN.rust * FLOOR && a.total <= KNOWN.rust * CEIL,
    `${a.total} vs ~${KNOWN.rust}`,
  );

  /* the python / react cross-check (same path) -------------------------- */
  console.log("\n    cross-check python / react (scope=jobs on `hn`)");
  for (const q of ["python", "react"] as const) {
    const r = await jobsTotal(q);
    console.log(`    ${q}: ${r.buckets} buckets, ${r.total} docs`);
    check(
      `${q} scope=jobs total matches known-good (~${KNOWN[q]})`,
      r.total >= KNOWN[q] * FLOOR && r.total <= KNOWN[q] * CEIL,
      `${r.total} vs ~${KNOWN[q]}`,
    );
  }

  /* (b) aggregate q=rust on hnjobs (no scope) --------------------------- */
  console.log("\n(b) aggregate q=rust on `hnjobs` (no scope arm)");
  const b = await runAggregate(redis, { q: "rust", index: "hnjobs" });
  const bTotal = b.buckets.reduce((s, x) => s + x.docCount, 0);
  console.log(`    -> ${b.buckets.length} monthly buckets, ${bTotal} docs`);
  // hnjobs may be only partially backfilled in this environment; assert the
  // query SHAPE works (structured buckets come back), not an exact count.
  check("hnjobs aggregate returns structured monthly buckets", Array.isArray(b.buckets));
  check("hnjobs aggregate bucket has key/keyAsString/docCount",
    b.buckets.length === 0 ||
      (typeof b.buckets[0].key === "number" &&
        typeof b.buckets[0].keyAsString === "string" &&
        typeof b.buckets[0].docCount === "number"));

  /* (c) drill-down search q=rust in one recent month on hnjobs ---------- */
  console.log("\n(c) drill-down search q=rust, May 2026, on `hnjobs`");
  const docs = await runSearch(redis, {
    q: "rust",
    sort: "relevance",
    index: "hnjobs",
    limit: 10,
    from: "2026-05-01T00:00:00.000Z",
    to: "2026-06-01T00:00:00.000Z",
  });
  console.log(`    -> ${docs.length} docs; ids=[${docs.slice(0, 5).map((d) => d.id).join(", ")}]`);
  check("drill-down search returns mapped HnDocs",
    docs.every((d) => typeof d.id === "number" && d.id > 0));
  check("drill-down docs carry a numeric _score (relevance)",
    docs.length === 0 || typeof docs[0]._score === "number");
  // hnjobs postings carry the precomputed `replies` field; if any rows came back
  // they should expose it as a number (the drill-down ranks by it).
  check("drill-down hnjobs docs expose numeric replies",
    docs.length === 0 || docs.every((d) => typeof d.replies === "number"));

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
