/**
 * Validate the "Who is hiring?" galleries (src/lib/jobs-gallery.ts) against the
 * LIVE jobs-scoped index, the way the page actually draws them. Three checks,
 * in the script-evaluator style of scripts/validate-comparisons.ts:
 *
 *   1. NO DEAD TERMS - every plain term and every OR-group part used anywhere in
 *      a gallery card returns live job-scoped data (>= MIN_MENTIONS all-time
 *      mentions). A dead pick would render as an empty band.
 *
 *   2. NO FLAT LINES - for each COMPARISON, fold the live 30d buckets into
 *      gap-free calendar months (the production binning, reused verbatim from
 *      src/lib/jobs-trends.ts), normalize to relative (100%) shares, and confirm
 *      the card actually tells a story: some series' relative share swings by at
 *      least SWING over the window, OR the leading series changes hands at least
 *      once. A comparison where one term dominates every month flat is flagged.
 *
 *   3. GAP-FREE BINNING - the contiguous columns the chart builds for every card
 *      have strictly +1 month-index steps (no holes, no repeats, no skipped x).
 *      This is a pure property but we assert it here over the REAL fetched data
 *      so a binning regression surfaces against live shapes, not just fixtures.
 *
 * Run: bun --env-file=.env.local scripts/validate-jobs-gallery.ts
 *
 * Exits non-zero (so CI / the build loop fails) if any term is dead, any chosen
 * comparison is a flat line, or any card's columns are not gap-free. Fix the
 * offending pick in src/lib/jobs-gallery.ts (re-run scripts/discover-job-trends.ts
 * to re-measure) until this passes clean.
 */
export {};

import { hnRedis, runAggregate } from "../src/lib/hn-index";
import {
  parseParts,
  binMonths,
  monthTotal,
  sumByMonth,
  buildColumns,
  columnShares,
  colorAt,
  type RawBucket,
  type SeriesData,
} from "../src/lib/jobs-trends";
import { GALLERY, COMPARISONS } from "../src/lib/jobs-gallery";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error("Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (.env.local)");
}

const redis = hnRedis();

/** A term with fewer than this many all-time job-scoped mentions is "dead": its
 *  band would be visually empty in a relative stack. The discovery script uses
 *  the same 150 floor, so this is the contract that keeps them honest. */
const MIN_MENTIONS = 150;
/** A comparison is a flat line unless some series' relative share moves by at
 *  least this much across the window, or the leader changes hands. */
const SWING = 0.12;
/** Months with too small a sample are excluded from the swing scan so a single
 *  noisy early month can't fake a story. */
const MIN_COLUMN_TOTAL = 5;
const CONCURRENCY = 6;

/* ---------- one live jobs-scoped aggregate per series part ----------- */

/** Fetch a single term's live jobs-scoped 30d buckets as `RawBucket[]` (the
 *  shape `binMonths` consumes). Runs the SAME SDK aggregate the edge route runs,
 *  so this validates the production query path, not a re-implementation. */
async function fetchBuckets(term: string): Promise<RawBucket[]> {
  const agg = await runAggregate(redis, { q: term, scope: "jobs" });
  return agg.buckets.map((b) => ({ key: b.key, docCount: b.docCount }));
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/* ---------- term enumeration ---------------------------------------- */

/** Every DISTINCT atomic part probed: plain terms AND every OR-group part, since
 *  a dead part silently subtracts from its summed band. */
function allParts(): string[] {
  const set = new Set<string>();
  for (const card of GALLERY)
    for (const series of card.terms)
      for (const part of parseParts(series)) set.add(part.toLowerCase());
  return [...set];
}

/* ---------- build a SeriesData from a series string + bucket cache --- */

function seriesFrom(seriesStr: string, idx: number, cache: Map<string, RawBucket[]>): SeriesData {
  const parts = parseParts(seriesStr);
  const maps = parts.map((p) => binMonths(cache.get(p.toLowerCase()) ?? []));
  const byMonth = sumByMonth(maps);
  return {
    label: seriesStr,
    parts,
    color: colorAt(idx),
    byMonth,
    total: monthTotal(byMonth),
  };
}

/* ---------- the story / flat-line test ------------------------------ */

/** Does this comparison tell a relative-share story? True when, across the
 *  meaningful months, some series' share swings by >= SWING OR the leader
 *  changes at least once. `diag` carries the numbers for the printout. */
function tellsStory(series: SeriesData[]): { ok: boolean; maxSwing: number; leadChanges: number } {
  const cols = buildColumns(series, "all").filter((c) => c.total >= MIN_COLUMN_TOTAL);
  if (cols.length < 2) return { ok: false, maxSwing: 0, leadChanges: 0 };

  // Per-series min/max relative share across the meaningful months.
  const lo = series.map(() => Infinity);
  const hi = series.map(() => -Infinity);
  let prevLeader = -1;
  let leadChanges = 0;
  for (const col of cols) {
    const shares = columnShares(col);
    let leader = 0;
    for (let s = 0; s < series.length; s++) {
      lo[s] = Math.min(lo[s], shares[s]);
      hi[s] = Math.max(hi[s], shares[s]);
      if (shares[s] > shares[leader]) leader = s;
    }
    if (prevLeader !== -1 && leader !== prevLeader) leadChanges++;
    prevLeader = leader;
  }
  let maxSwing = 0;
  for (let s = 0; s < series.length; s++) maxSwing = Math.max(maxSwing, hi[s] - lo[s]);
  return { ok: maxSwing >= SWING || leadChanges >= 1, maxSwing, leadChanges };
}

/* ---------- gap-free binning assertion ------------------------------ */

/** The contiguous columns must step by exactly +1 month-index, with no holes,
 *  repeats or skips. Pure property, asserted over real fetched data. */
function gapFree(series: SeriesData[]): boolean {
  const cols = buildColumns(series, "all");
  for (let i = 1; i < cols.length; i++) {
    if (cols[i].idx !== cols[i - 1].idx + 1) return false;
  }
  return cols.length > 0;
}

/* -------------------------------------------------------------------- */

async function main() {
  const parts = allParts();
  console.log(`Probing ${parts.length} distinct gallery terms (scope=jobs)...\n`);
  const bucketLists = await mapLimit(parts, CONCURRENCY, fetchBuckets);
  const cache = new Map<string, RawBucket[]>();
  parts.forEach((p, i) => cache.set(p, bucketLists[i]));

  // 1. No dead terms.
  let dead = 0;
  const totals = new Map<string, number>();
  for (const p of parts) {
    const total = monthTotal(binMonths(cache.get(p) ?? []));
    totals.set(p, total);
    if (total < MIN_MENTIONS) {
      dead++;
      console.log(`  DEAD   ${p.padEnd(20)} ${total} mentions  (< ${MIN_MENTIONS})`);
    }
  }
  console.log(`\nTerms: ${parts.length - dead} live, ${dead} dead (< ${MIN_MENTIONS} mentions)\n`);

  // 2. No flat lines, for each COMPARISON.
  let flat = 0;
  for (const card of COMPARISONS) {
    const series = card.terms.map((s, i) => seriesFrom(s, i, cache));
    const { ok, maxSwing, leadChanges } = tellsStory(series);
    if (!ok) flat++;
    console.log(
      `  ${ok ? "story" : "FLAT "}  swing=${maxSwing.toFixed(2)} leads=${leadChanges}  ${card.title}`,
    );
  }
  console.log(`\nComparisons: ${COMPARISONS.length - flat} tell a story, ${flat} flat\n`);

  // 3. Gap-free binning, for EVERY card.
  let holey = 0;
  for (const card of GALLERY) {
    const series = card.terms.map((s, i) => seriesFrom(s, i, cache));
    if (!gapFree(series)) {
      holey++;
      console.log(`  HOLES  ${card.title}`);
    }
  }
  console.log(`Binning: ${GALLERY.length - holey} gap-free, ${holey} with holes\n`);

  const bad = dead + flat + holey;
  if (bad > 0) {
    console.log(`FAIL: ${dead} dead terms, ${flat} flat comparisons, ${holey} holey cards.`);
    process.exit(1);
  }
  console.log("PASS: no dead terms, no flat comparisons, all cards gap-free.");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
