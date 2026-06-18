/**
 * T01 acceptance probe: confirm scope=jobs narrows the matched set.
 *
 * Runs the SAME aggregate the edge route runs (through the `@upstash/redis`
 * search SDK via `runAggregate`) for `q=rust` with and without `scope=jobs`, and
 * prints the summed monthly counts. Job-scoped counts must be dramatically lower
 * than all-HN counts (job postings are a tiny subcorpus).
 *
 * Run: bun scripts/probe-jobs-scope.ts
 */
import { hnRedis, runAggregate } from "../src/lib/hn-index";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error("Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (.env.local)");
}

const redis = hnRedis();

async function total(q: string, scope?: "jobs"): Promise<number> {
  const agg = await runAggregate(redis, { q, scope });
  return agg.buckets.reduce((s, b) => s + b.docCount, 0);
}

for (const q of ["rust", "python", "react"]) {
  const all = await total(q);
  const jobs = await total(q, "jobs");
  const ratio = all > 0 ? (jobs / all) : 0;
  const ok = jobs > 0 && jobs < all;
  console.log(
    `${ok ? "PASS" : "FAIL"}  q=${q.padEnd(8)} all=${String(all).padStart(7)}  jobs=${String(jobs).padStart(6)}  jobs/all=${(ratio * 100).toFixed(1)}%`,
  );
}
