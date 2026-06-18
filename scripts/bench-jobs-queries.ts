/**
 * PERF benchmark: PROVE why the "Who is hiring?" chart + gallery are slow, and
 * that the dedicated `hnjobs` postings index is the fix.
 *
 *   bun --env-file=.env.local scripts/bench-jobs-queries.ts
 *
 * What this measures (wall-clock of the live Upstash REST round-trip, the exact
 * thing the browser/edge pays). Each case is run for several trials and we
 * report min / median / p90 / max so a single network blip can't mislead.
 *
 *   1. CURRENT chart path: aggregate "rust"/"python"/"react" on the GIANT shared
 *      `hn` index WITH scope=jobs - the 180-way `$or` over the non-`.fast()`
 *      `parent` field - plus the 30d `$dateHistogram`. This is what every chart
 *      render and every gallery mini-card runs today.
 *   2. SAME term aggregate on the dedicated `hnjobs` index (postings-only, NO
 *      scope arm, same `$dateHistogram`). NOTE: a full `hnjobs` backfill is
 *      running concurrently, so its COUNTS may be partial mid-fill - we report
 *      them but care about LATENCY / query shape, which is representative even
 *      while the index is filling (the filter does the same work per matched
 *      doc whether the index holds 10k or 93k postings).
 *   3. Marginal cost of the 180-way `$or` alone: aggregate "rust" on `hn`
 *      WITHOUT scope vs WITH scope. The delta is the price of the parent `$or`.
 *   4. Drill-down search of "rust" within ONE month: `hn`+scope=jobs (180-way
 *      `$or` + a time range) vs `hnjobs` (just text + a time range).
 *
 * Goes through the SAME `@upstash/redis` search SDK path the edge route runs
 * (via `runAggregate` / `runSearch`), so the latency is representative of
 * production. We point a case at `hnjobs` instead of `hn` simply by passing
 * `index: "hnjobs"` (the filter + aggregations are unchanged).
 */

import { hnRedis, runAggregate, runSearch } from "../src/lib/hn-index";
import {
  type AggregateArgsOpts,
  type Aggregations,
  type HnDoc,
  type SearchArgsOpts,
} from "../src/lib/hn-query";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error("Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (.env.local)");
}

const redis = hnRedis();

const TRIALS = 6; // trials per case; first trial is kept (no warm-up discard) so
// the table shows the cold-ish reality, but min/median strip the worst spikes.
const TERMS = ["rust", "python", "react"];

/** One latency sample plus a small payload summary so we can sanity-check the
 *  query actually matched something (and isn't fast because it errored). */
type Sample = { ms: number; summary: string };

/** Run a single timed SDK call - the wall-clock the edge route would pay - and
 *  reduce its result to a one-line summary so we can sanity-check the query
 *  actually matched (and isn't fast because it errored). The SDK talks straight
 *  to the Upstash REST endpoint (no CDN/HTTP cache in front), so this measures
 *  Upstash itself. */
async function runOnce(call: () => Promise<string>): Promise<Sample> {
  const t0 = performance.now();
  try {
    const summary = await call();
    return { ms: performance.now() - t0, summary };
  } catch (e) {
    return { ms: performance.now() - t0, summary: `ERR ${(e as Error).message}`.slice(0, 60) };
  }
}

/** Run a call TRIALS times back-to-back, returning the samples. */
async function trials(call: () => Promise<string>): Promise<Sample[]> {
  const out: Sample[] = [];
  for (let i = 0; i < TRIALS; i++) out.push(await runOnce(call));
  return out;
}

/* ---------- stats + table -------------------------------------------- */

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

type Row = { label: string; samples: Sample[] };

function printTable(title: string, rows: Row[]): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  const head = [
    "case".padEnd(42),
    "min".padStart(8),
    "med".padStart(8),
    "p90".padStart(8),
    "max".padStart(8),
    "  payload",
  ].join("");
  console.log(head);
  for (const { label, samples } of rows) {
    const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
    const cell = (n: number) => `${n.toFixed(0)}ms`.padStart(8);
    console.log(
      [
        label.padEnd(42),
        cell(ms[0]),
        cell(pct(ms, 50)),
        cell(pct(ms, 90)),
        cell(ms[ms.length - 1]),
        "  " + (samples[samples.length - 1]?.summary ?? ""),
      ].join(""),
    );
  }
}

/* ---------- summarizers ---------------------------------------------- */

const aggSummary = (agg: Aggregations) => {
  const total = agg.buckets.reduce((s, b) => s + b.docCount, 0);
  return `${agg.buckets.length} buckets, ${total} docs`;
};

const docsSummary = (docs: HnDoc[]) => `returned=${docs.length}`;

/** Time one aggregate over TRIALS runs, summarizing the bucket/doc counts. */
const aggTrials = (opts: AggregateArgsOpts) =>
  trials(async () => aggSummary(await runAggregate(redis, opts)));

/** Time one search over TRIALS runs, summarizing the returned doc count. */
const searchTrials = (opts: SearchArgsOpts) =>
  trials(async () => docsSummary(await runSearch(redis, opts)));

/* ---------- the four cases ------------------------------------------- */

async function case1And2(): Promise<void> {
  // Per-term: the CURRENT chart aggregate (hn + scope=jobs + 30d histogram), then
  // the SAME aggregate on the postings-only `hnjobs` index (which drops the scope
  // arm automatically - it's already postings-only).
  const rows: Row[] = [];
  for (const q of TERMS) {
    rows.push({ label: `1. hn + scope=jobs   q=${q}`, samples: await aggTrials({ q, scope: "jobs" }) });
  }
  for (const q of TERMS) {
    rows.push({ label: `2. hnjobs (no scope) q=${q}`, samples: await aggTrials({ q, index: "hnjobs" }) });
  }
  printTable("CASE 1 vs 2 - chart aggregate: shared hn+scope vs dedicated hnjobs", rows);
}

async function case3(): Promise<void> {
  // Isolate the price of the 180-way parent $or: same term + same histogram on
  // the same `hn` index, with vs without the scope arm. The delta is the $or.
  const q = "rust";
  const rows: Row[] = [
    { label: `3a. hn, NO scope     q=${q}`, samples: await aggTrials({ q }) },
    { label: `3b. hn, scope=jobs   q=${q}`, samples: await aggTrials({ q, scope: "jobs" }) },
  ];
  printTable("CASE 3 - marginal cost of the 180-way parent $or (hn index)", rows);
}

async function case4(): Promise<void> {
  // Drill-down: "rust" within ONE month window. hn+scope pays the 180-way $or on
  // top of the time range; hnjobs pays only text + time range. Use the latest
  // full month window the chart would request.
  const q = "rust";
  const from = "2026-05-01T00:00:00.000Z";
  const to = "2026-06-01T00:00:00.000Z";
  const rows: Row[] = [
    {
      label: `4a. hn + scope=jobs  ${from.slice(0, 7)}`,
      samples: await searchTrials({ q, sort: "relevance", from, to, scope: "jobs", index: "hn", limit: 30 }),
    },
    {
      label: `4b. hnjobs           ${from.slice(0, 7)}`,
      samples: await searchTrials({ q, sort: "relevance", from, to, index: "hnjobs", limit: 30 }),
    },
  ];
  printTable("CASE 4 - drill-down search within one month: hn+scope vs hnjobs", rows);
}

/* ---------- main ----------------------------------------------------- */

async function main() {
  console.log(`bench-jobs-queries: ${TRIALS} trials/case against ${process.env.UPSTASH_REDIS_REST_URL}`);
  console.log(`NOTE: hnjobs is backfilling concurrently; its docCounts may be PARTIAL.`);
  console.log(`      We care about LATENCY / query SHAPE, which is representative mid-fill.`);
  await case1And2();
  await case3();
  await case4();
  console.log(`\nDone. Latency is the Upstash round-trip (cache: no-store).`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
