/**
 * Unit tests for the pure job-trends utilities (src/lib/jobs-trends.ts).
 *
 * Script-evaluator style (matching scripts/eval-relevance.ts /
 * scripts/validate-comparisons.ts prior art): no test runner, just a tiny
 * `check` harness that prints PASS/FAIL per assertion and exits non-zero if any
 * fail. Everything under test is pure, so this runs with no network/env:
 *
 *   bun scripts/test-jobs-trends.ts
 *
 * Covers the seams the PRD's Testing Decisions call out:
 *   - gap-free calendar-month binning (contiguous month-indexes, no holes)
 *   - relative (100%) normalization (shares sum to ~100; empty months stay empty)
 *   - OR-group bucket-for-bucket summation
 *   - the dock-magnification falloff factor(d): factor(0) is the max,
 *     factor(>=radius)===1, monotonic non-increasing in |d|
 *   - the drill-down ranking key relevance + log(1 + replyCount)
 */
export {};

import {
  parseParts,
  monthKey,
  monthIndex,
  fromMonthIndex,
  binMonths,
  monthTotal,
  sumByMonth,
  monthRange,
  buildColumns,
  columnShares,
  columnPercents,
  factor,
  rankKey,
  rankByDiscussion,
  defaultDrillSegment,
  FIRST_YEAR,
  type RawBucket,
  type SeriesData,
} from "../src/lib/jobs-trends";

/* ---------- tiny assertion harness --------------------------------- */

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

/** Close-enough float compare (the shares are computed in floating point). */
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

/** Build one SeriesData straight from a sparse {monthKey: count} object. */
function series(label: string, color: string, byMonth: Record<string, number>): SeriesData {
  const m = new Map<string, number>(Object.entries(byMonth));
  let total = 0;
  for (const v of m.values()) total += v;
  return { label, parts: parseParts(label), color, byMonth: m, total };
}

/** UTC epoch-ms for the 1st of a (year, 0-based month). */
const ms = (y: number, mo: number) => Date.UTC(y, mo, 1);

/* ---------- parseParts (OR-group splitting) ------------------------ */

console.log("\nparseParts");
check("splits on |, trims, drops empties",
  JSON.stringify(parseParts("backend | sre |")) === JSON.stringify(["backend", "sre"]));
check("empty string -> []", parseParts("").length === 0);
check("single term -> [term]",
  JSON.stringify(parseParts("rust")) === JSON.stringify(["rust"]));

/* ---------- month-index round-trip --------------------------------- */

console.log("\nmonth index helpers");
check("monthKey is year-month", monthKey(2021, 3) === "2021-3");
check("monthIndex is year*12+month", monthIndex(2021, 3) === 2021 * 12 + 3);
{
  let roundTrips = true;
  for (let idx = monthIndex(FIRST_YEAR, 0); idx <= monthIndex(2026, 11); idx++) {
    const { year, month } = fromMonthIndex(idx);
    if (monthIndex(year, month) !== idx) roundTrips = false;
  }
  check("fromMonthIndex inverts monthIndex over the whole range", roundTrips);
}

/* ---------- binMonths: 30d buckets -> calendar months -------------- */

console.log("\nbinMonths (30d buckets -> calendar months)");
{
  // Two 30d buckets that land in the SAME calendar month must sum; a third in
  // the next month stays separate.
  const buckets: RawBucket[] = [
    { key: ms(2021, 3), docCount: 5 }, // Apr 2021
    { key: ms(2021, 3) + 10 * 86400e3, docCount: 2 }, // mid-Apr 2021 (same month)
    { key: ms(2021, 4), docCount: 1 }, // May 2021
  ];
  const binned = binMonths(buckets);
  check("two same-month buckets sum", binned.get("2021-3") === 7,
    `got ${binned.get("2021-3")}`);
  check("next-month bucket stays separate", binned.get("2021-4") === 1);
  check("monthTotal sums all buckets", monthTotal(binned) === 8);
}

/* ---------- sumByMonth: OR-group summation ------------------------- */

console.log("\nsumByMonth (OR-group bucket-for-bucket)");
{
  const a = new Map<string, number>([["2021-3", 5]]);
  const b = new Map<string, number>([["2021-3", 2], ["2021-4", 1]]);
  const summed = sumByMonth([a, b]);
  check("overlapping month adds", summed.get("2021-3") === 7);
  check("disjoint month carried through", summed.get("2021-4") === 1);
  check("no extra keys introduced", summed.size === 2);
  check("empty input -> empty map", sumByMonth([]).size === 0);
}

/* ---------- monthRange: gap-free contiguous months ----------------- */

console.log("\nmonthRange (gap-free contiguous month-indexes)");
{
  const end = monthIndex(2026, 5); // Jun 2026
  for (const win of ["all", "10y", "5y", "1y"] as const) {
    const r = monthRange(end, win);
    // contiguous: every step is exactly +1, no holes, strictly increasing.
    let contiguous = true;
    for (let i = 1; i < r.length; i++) if (r[i] !== r[i - 1] + 1) contiguous = false;
    check(`${win}: contiguous (+1 each step, no holes)`, contiguous);
    check(`${win}: ends at the anchor month`, r[r.length - 1] === end);
    check(`${win}: never starts before FIRST_YEAR`,
      r[0] >= monthIndex(FIRST_YEAR, 0));
  }
  // the bounded windows are exactly N*12 months long (anchored to end).
  check("1y window is 12 months", monthRange(end, "1y").length === 12);
  check("5y window is 60 months", monthRange(end, "5y").length === 60);
  check("10y window is 120 months", monthRange(end, "10y").length === 120);
}

/* ---------- buildColumns: gap-free columns with zero-fill ----------- */

console.log("\nbuildColumns (gap-free, zero-filled holes)");
{
  // python has Apr+Jun 2026 (skips May); javascript has only May 2026. The
  // built columns must include May with a real zero for python (no hole).
  const py = series("python", "#1", { "2026-3": 4, "2026-5": 6 });
  const js = series("javascript", "#2", { "2026-4": 3 });
  const cols = buildColumns([py, js], "1y");
  // contiguous month-indexes
  let contiguous = true;
  for (let i = 1; i < cols.length; i++) if (cols[i].idx !== cols[i - 1].idx + 1) contiguous = false;
  check("columns are contiguous (no skipped months)", contiguous);
  const may = cols.find((c) => c.year === 2026 && c.month === 4)!;
  check("the skipped month exists as a real column", !!may);
  check("python is a real zero in the skipped month", may.values[0] === 0);
  check("javascript has its value in that month", may.values[1] === 3);
  check("column total is the sum of its series", may.total === 3);
  const apr = cols.find((c) => c.month === 3 && c.year === 2026)!;
  check("from/to bracket the calendar month",
    apr.fromMs === Date.UTC(2026, 3, 1) && apr.toMs === Date.UTC(2026, 4, 1));
}

/* ---------- buildColumns dropEmpty: share-% empty-month removal ------ */

console.log("\nbuildColumns dropEmpty (share-% empty-month removal)");
{
  // python has Apr+Jun 2026; javascript only Jun -> May 2026 ("2026-4") gets a
  // posting from NEITHER, so it is a genuine zero-total month (the 30d-vs-
  // calendar binning artifact). dropEmpty must remove it from the set.
  const py = series("python", "#1", { "2026-3": 4, "2026-5": 6 });
  const js = series("javascript", "#2", { "2026-5": 2 });
  const kept = buildColumns([py, js], "1y", false);
  const dropped = buildColumns([py, js], "1y", true);
  // default (count mode) keeps every month, including the zero-total May.
  check("dropEmpty=false keeps the zero-total month",
    !!kept.find((c) => c.year === 2026 && c.month === 4 && c.total === 0));
  // dropEmpty (share mode) removes EVERY zero-total month - none remain.
  check("dropEmpty=true removes all zero-total months",
    dropped.every((c) => c.total > 0));
  check("dropEmpty=true drops the artifact May column",
    !dropped.find((c) => c.year === 2026 && c.month === 4));
  // the non-empty months survive unchanged (Apr=python 4; Jun=python 6+js 2=8).
  check("dropEmpty=true keeps the non-empty months",
    !!dropped.find((c) => c.year === 2026 && c.month === 3 && c.total === 4) &&
    !!dropped.find((c) => c.year === 2026 && c.month === 5 && c.total === 8));
  // dropEmpty never reorders: the surviving columns stay ascending by idx.
  let ascending = true;
  for (let i = 1; i < dropped.length; i++)
    if (dropped[i].idx <= dropped[i - 1].idx) ascending = false;
  check("dropEmpty=true preserves ascending month order", ascending);
  // an all-empty window collapses to no columns under dropEmpty.
  const none = series("none", "#3", {});
  check("dropEmpty=true on all-empty series -> no columns",
    buildColumns([none], "1y", true).length === 0);
}

/* ---------- normalization: shares sum to ~100, empties stay empty --- */

console.log("\nnormalization (relative 100%)");
{
  const py = series("python", "#1", { "2026-3": 3, "2026-5": 0 });
  const js = series("javascript", "#2", { "2026-3": 1 });
  const cols = buildColumns([py, js], "1y");
  const apr = cols.find((c) => c.month === 3 && c.year === 2026)!;
  const pct = columnPercents(apr);
  check("non-empty month: percents sum to ~100", near(pct[0] + pct[1], 100, 1e-6),
    `got ${pct[0] + pct[1]}`);
  check("non-empty month: shares match value/total",
    near(columnShares(apr)[0], 3 / 4) && near(columnShares(apr)[1], 1 / 4));
  // a month with no data anywhere must stay all-zero (no divide-by-zero, no bar).
  const empty = cols.find((c) => c.total === 0)!;
  check("empty month exists in the contiguous range", !!empty);
  const epct = columnPercents(empty);
  check("empty month: every share is 0 (stays empty)",
    epct.every((p) => p === 0));
}

/* ---------- factor(d): dock-magnification falloff ------------------- */

console.log("\nfactor(d) (raised-cosine dock magnification)");
{
  const boost = 1.2;
  const radius = 4;
  check("factor(0) is the maximum (1 + boost)", near(factor(0, boost, radius), 1 + boost));
  check("factor(radius) === 1", factor(radius, boost, radius) === 1);
  check("factor(> radius) === 1", factor(radius + 3, boost, radius) === 1);
  check("symmetric in sign of d", near(factor(2, boost, radius), factor(-2, boost, radius)));
  // monotonic non-increasing as |d| grows from 0 to radius.
  let monotonic = true;
  let prev = factor(0, boost, radius);
  for (let d = 0.1; d <= radius; d += 0.1) {
    const f = factor(d, boost, radius);
    if (f > prev + 1e-12) monotonic = false;
    prev = f;
  }
  check("monotonic non-increasing in |d| on [0, radius]", monotonic);
  check("radius <= 0 is a no-op (factor 1)", factor(0, boost, 0) === 1);
}

/* ---------- rankKey / rankByDiscussion: drill-down ranking --------- */

console.log("\nranking (relevance + log(1 + replyCount))");
{
  check("rankKey adds log1p(replyCount) to relevance",
    near(rankKey(2, 0), 2) && near(rankKey(2, Math.E - 1), 3));
  check("more replies outrank equal relevance",
    rankKey(5, 10) > rankKey(5, 0));
  // a quiet but very relevant posting can still beat a chatty weak one.
  check("relevance still dominates a large gap",
    rankKey(20, 0) > rankKey(1, 1000));
  // ordering of a fixed candidate set.
  const docs = [
    { id: "a", relevance: 5, replyCount: 0 }, //  5.000
    { id: "b", relevance: 4, replyCount: 50 }, // 4 + log(51) ~= 7.93
    { id: "c", relevance: 5, replyCount: 4 }, //  5 + log(5)  ~= 6.61
    { id: "d", relevance: 1, replyCount: 0 }, //  1.000
  ];
  const order = rankByDiscussion(docs).map((d) => d.id).join("");
  check("ranks a fixed set by relevance + log(1+replies)", order === "bcad",
    `got ${order}`);
  check("rankByDiscussion does not mutate the input",
    docs[0].id === "a" && docs[3].id === "d");
}

/* ---------- defaultDrillSegment: prefetch-on-load pick ------------- */

console.log("\ndefaultDrillSegment (prefetch-on-load pick)");
{
  // latest month is Jun 2026 (idx 2026*12+5); within it javascript (6) beats
  // python (4) and typescript (2), so it is the dominant band that prefetches.
  const py = series("python", "#1", { "2026-3": 9, "2026-5": 4 });
  const js = series("javascript", "#2", { "2026-4": 7, "2026-5": 6 });
  const ts = series("typescript", "#3", { "2026-5": 2 });
  const seg = defaultDrillSegment([py, js, ts])!;
  check("picks the latest data month",
    seg.year === 2026 && seg.month === 5, `got ${seg?.year}-${seg?.month}`);
  check("picks the dominant band in that month", seg.seriesIndex === 1,
    `got index ${seg?.seriesIndex}`);
  check("from/to bracket the picked calendar month",
    seg.fromMs === Date.UTC(2026, 5, 1) && seg.toMs === Date.UTC(2026, 6, 1));

  // earlier month dominance does NOT override the latest-month rule: python has
  // the biggest all-time peak (Apr) but the prefetch still lands on the latest
  // month's leader.
  const seg2 = defaultDrillSegment([py, js, ts])!;
  check("latest-month rule beats an earlier all-time peak",
    seg2.month === 5 && seg2.seriesIndex === 1);

  // empties: no series, or every series empty -> null (nothing to drill).
  check("no series -> null", defaultDrillSegment([]) === null);
  check("all-empty series -> null",
    defaultDrillSegment([series("a", "#1", {}), series("b", "#2", {})]) === null);
  // a month present with only zeros must not be picked (bestVal<=0 -> null).
  check("a zero-only latest month -> null",
    defaultDrillSegment([series("a", "#1", { "2026-5": 0 })]) === null);
}

/* ---------- summary ------------------------------------------------- */

console.log(`\n${"=".repeat(50)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
