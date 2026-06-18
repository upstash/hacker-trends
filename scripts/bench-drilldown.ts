/**
 * bench-drilldown.ts - End-to-end latency breakdown for the chart drill-down.
 *
 * The user reports the drill-down "still feels much slower than 100ms" even
 * though the raw hnjobs query benches ~107ms. This script measures the actual
 * Upstash command latency for the drill-down query on the `hnjobs` index, and
 * compares the two candidate rankings:
 *
 *   A) SCOREFUNC (BM25 + log1p(replies))  - what useJobComments ships today
 *   B) ORDERBY replies DESC                - "most-discussed first", no scorefunc
 *
 * Both filter the SAME set (the term must appear in title|text, date-ranged to
 * the month) on the postings-only `hnjobs` index, so B is a candidate because
 * every returned doc already contains the term; we only choose the order.
 *
 * It also times an OR-group drill (two parts via Promise.all) to confirm the
 * slowest part dominates, and a warm repeat of the same command (server-side
 * Upstash cache, not the browser HTTP cache - that's a separate, client-only
 * win measured by reasoning in the report).
 *
 * Run: bun scripts/bench-drilldown.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hnRedis, runSearch } from "../src/lib/hn-index";
import { type HnDoc, type SearchArgsOpts } from "../src/lib/hn-query";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ---- load .env.local (UPSTASH_REDIS_REST_URL / _TOKEN) -------------- */
function loadEnv() {
  try {
    const txt = readFileSync(join(HERE, "..", ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {}
}
loadEnv();

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("Missing Upstash credentials in .env.local");
  process.exit(1);
}

const redis = hnRedis();

/** Run one drill-down search through the SDK, timing the round-trip and
 *  returning the mapped docs (the wall-clock the edge route would pay). */
async function runOne(opts: SearchArgsOpts): Promise<{ ms: number; docs: HnDoc[] }> {
  const t0 = performance.now();
  const docs = await runSearch(redis, opts);
  return { ms: performance.now() - t0, docs };
}

/** SCOREFUNC variant (what ships today): sort = "relevance" on hnjobs. */
function scorefuncOpts(q: string, from: string, to: string): SearchArgsOpts {
  return { q, sort: "relevance", limit: 10, from, to, index: "hnjobs" };
}
/** ORDERBY replies DESC variant: sort = "discussed" on hnjobs. */
function orderbyOpts(q: string, from: string, to: string): SearchArgsOpts {
  return { q, sort: "discussed", limit: 10, from, to, index: "hnjobs" };
}

function pctile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function stat(label: string, xs: number[]) {
  const min = Math.min(...xs);
  const med = pctile(xs, 50);
  const p90 = pctile(xs, 90);
  const max = Math.max(...xs);
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(
    `  ${label.padEnd(28)} min ${min.toFixed(0).padStart(4)}  med ${med
      .toFixed(0)
      .padStart(4)}  avg ${avg.toFixed(0).padStart(4)}  p90 ${p90
      .toFixed(0)
      .padStart(4)}  max ${max.toFixed(0).padStart(4)}  ms`,
  );
}

const monthRange = (year: number, month0: number): [string, string] => [
  new Date(Date.UTC(year, month0, 1)).toISOString(),
  new Date(Date.UTC(year, month0 + 1, 1)).toISOString(),
];

// A few representative (term, month) drill-downs the chart's default + chips hit.
const CASES: { q: string; year: number; month0: number }[] = [
  { q: "python", year: 2026, month0: 4 }, // May 2026 (a default term, recent)
  { q: "typescript", year: 2026, month0: 4 },
  { q: "rust", year: 2024, month0: 0 },
  { q: "remote", year: 2022, month0: 5 }, // high-volume term
];

const ITERS = 8;

async function main() {
  console.log(`hnjobs drill-down bench  (${process.env.UPSTASH_REDIS_REST_URL})  ${ITERS} iters/case\n`);

  // Sanity: confirm the two rankings return the same SET (same ids), differ only
  // in order, and carry real reply counts.
  {
    const [from, to] = monthRange(2026, 4);
    const a = await runOne(scorefuncOpts("python", from, to));
    const b = await runOne(orderbyOpts("python", from, to));
    const da = a.docs;
    const db = b.docs;
    const idsA = new Set(da.map((d) => d.id));
    const overlap = db.filter((d) => idsA.has(d.id)).length;
    console.log(
      `sanity (python, May 2026): SCOREFUNC=${da.length} docs, ORDERBY=${db.length} docs, ` +
        `top-10 id overlap=${overlap}/${db.length}; replies present=${da.every(
          (d) => d.replies !== undefined,
        )}`,
    );
    console.log(
      `  SCOREFUNC top3 replies: [${da.slice(0, 3).map((d) => d.replies).join(", ")}]  ` +
        `ORDERBY top3 replies: [${db.slice(0, 3).map((d) => d.replies).join(", ")}]\n`,
    );
  }

  const allScore: number[] = [];
  const allOrder: number[] = [];

  for (const c of CASES) {
    const [from, to] = monthRange(c.year, c.month0);
    const sf: number[] = [];
    const ob: number[] = [];
    // warm both once (server cache) then measure
    await runOne(scorefuncOpts(c.q, from, to));
    await runOne(orderbyOpts(c.q, from, to));
    for (let i = 0; i < ITERS; i++) {
      sf.push((await runOne(scorefuncOpts(c.q, from, to))).ms);
      ob.push((await runOne(orderbyOpts(c.q, from, to))).ms);
    }
    allScore.push(...sf);
    allOrder.push(...ob);
    console.log(`[${c.q} ${c.year}-${String(c.month0 + 1).padStart(2, "0")}]`);
    stat("SCOREFUNC (relevance)", sf);
    stat("ORDERBY replies DESC", ob);
    console.log();
  }

  console.log("=== aggregate over all cases ===");
  stat("SCOREFUNC (relevance)", allScore);
  stat("ORDERBY replies DESC", allOrder);

  // OR-group: two-part drill via Promise.all -> slowest part dominates.
  {
    const [from, to] = monthRange(2026, 4);
    const parts = ["backend", "sre"];
    const t0 = performance.now();
    const partMs = await Promise.all(
      parts.map(async (p) => (await runOne(scorefuncOpts(p, from, to))).ms),
    );
    const wall = performance.now() - t0;
    console.log(
      `\nOR-group [${parts.join("|")}] May 2026 (Promise.all): parts=[${partMs
        .map((m) => m.toFixed(0))
        .join(", ")}]ms  wall=${wall.toFixed(0)}ms  (slowest part dominates)`,
    );
  }

  // Cold vs warm same command: server-side repeat.
  {
    const [from, to] = monthRange(2024, 0);
    const cold = (await runOne(scorefuncOpts("rust", from, to))).ms; // already warm-ish
    const warm: number[] = [];
    for (let i = 0; i < 5; i++) warm.push((await runOne(scorefuncOpts("rust", from, to))).ms);
    console.log(
      `\nserver repeat (rust Jan 2024): ${cold.toFixed(0)}ms then warm med ${pctile(
        warm,
        50,
      ).toFixed(0)}ms (Upstash-side only; the client HTTP/in-memory cache is the real repeat win)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
