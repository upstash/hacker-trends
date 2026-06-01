/**
 * Rank candidate trend queries by VOLUME + MULTI-PEAK shape, to choose the
 * best example chips for the UI.
 *
 * For each candidate we run a monthly date-histogram (same filter shape the app
 * uses) over all time, then score:
 *   - total      : sum of monthly docCounts (overall volume)
 *   - span       : first/last non-empty month (does the index even cover it?)
 *   - peakMax    : the single biggest month
 *   - peaks      : # of distinct spikes: clusters of consecutive months that
 *                  rise above max(peakFloor, PEAK_FRAC * peakMax), so a steady
 *                  plateau counts as ONE peak, not many.
 *   - peakiness  : peakMax / median(non-zero months): spiky vs flat.
 *
 * We want HIGH total, peaks >= 2, and high peakiness. Output is sorted so the
 * best multi-peak candidates float to the top.
 *
 * Usage:
 *   bun --env-file=.env.local scripts/probe-trends.ts            # built-in list
 *   bun --env-file=.env.local scripts/probe-trends.ts "term a" "term b" ...
 *   echo "term a\nterm b" | bun --env-file=.env.local scripts/probe-trends.ts -
 */
export {};

const REST_URL = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

const PEAK_FRAC = 0.4; // a month counts toward a spike if >= 40% of the term's own max
const PEAK_FLOOR = 15; // ...and at least this many docs, to ignore low-signal noise
const CONCURRENCY = 6;

async function call<T>(parts: (string | number)[]): Promise<{ result?: T; error?: string }> {
  const path = parts.map((p) => encodeURIComponent(String(p))).join("/");
  const r = await fetch(`${REST_URL}/${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  return (await r.json()) as { result?: T; error?: string };
}

// Keep in lockstep with src/lib/hn-query.ts buildFilter (query-only path).
function tokenize(q: string): string[] {
  const split = q
    .trim()
    .split(/\s+/)
    .flatMap((t) => t.split(/[^\p{L}\p{N}]+/u))
    .filter((t) => t.length >= 2);
  if (split.length > 0) return split;
  return q.trim().split(/\s+/).filter((t) => t.length > 0);
}

function buildFilter(q: string): Record<string, unknown> {
  const tokens = tokenize(q);
  const titleClause = (t: string) => ({ title: { $eq: t, $boost: 5.0 } });
  const textClause = (t: string) => ({ text: { $eq: t } });
  if (tokens.length === 0) return {};
  if (tokens.length === 1) {
    const t = tokens[0];
    return { $or: [titleClause(t), textClause(t)] };
  }
  return { $and: tokens.map((t) => ({ $or: [titleClause(t), textClause(t)] })) };
}

type Bucket = { key: number; keyAsString: string; docCount: number };

function kv(v: unknown): Record<string, unknown> {
  if (Array.isArray(v)) {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < v.length; i += 2) o[String(v[i])] = v[i + 1];
    return o;
  }
  return (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
}

async function histogram(filter: unknown): Promise<Bucket[] | string> {
  const j = await call<unknown[]>([
    "search.aggregate",
    "hn",
    JSON.stringify(filter),
    JSON.stringify({ x: { $dateHistogram: { field: "time", fixedInterval: "30d" } } }),
  ]);
  if (j.error) return `ERR ${j.error}`;
  const x = kv(kv(j.result).x);
  const raw = x.buckets;
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => {
    const bo = kv(b);
    return {
      key: Number(bo.key),
      keyAsString: String(bo.keyAsString ?? ""),
      docCount: Number(bo.docCount ?? 0),
    };
  });
}

type Stats = {
  q: string;
  tokens: string[];
  total: number;
  first: string;
  last: string;
  peakMax: number;
  peakMonth: string;
  peaks: number;
  peakMonths: string[];
  peakiness: number;
  err?: string;
};

function ym(s: string): string {
  return s.slice(0, 7); // YYYY-MM
}

function analyze(q: string, buckets: Bucket[]): Stats {
  const nonzero = buckets.filter((b) => b.docCount > 0);
  const total = buckets.reduce((s, b) => s + b.docCount, 0);
  if (nonzero.length === 0) {
    return {
      q, tokens: tokenize(q), total: 0, first: "-", last: "-",
      peakMax: 0, peakMonth: "-", peaks: 0, peakMonths: [], peakiness: 0,
    };
  }
  const counts = nonzero.map((b) => b.docCount);
  const peakMax = Math.max(...counts);
  const peakBucket = nonzero.find((b) => b.docCount === peakMax)!;
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;

  const threshold = Math.max(PEAK_FLOOR, PEAK_FRAC * peakMax);
  // Walk chronologically; group consecutive above-threshold months into one spike.
  const chron = [...buckets].sort((a, b) => a.key - b.key);
  let peaks = 0;
  let inPeak = false;
  const peakMonths: string[] = [];
  for (const b of chron) {
    const hot = b.docCount >= threshold;
    if (hot && !inPeak) {
      peaks++;
      peakMonths.push(ym(b.keyAsString));
    }
    inPeak = hot;
  }

  return {
    q, tokens: tokenize(q), total,
    first: ym(chron.find((b) => b.docCount > 0)!.keyAsString),
    last: ym([...chron].reverse().find((b) => b.docCount > 0)!.keyAsString),
    peakMax, peakMonth: ym(peakBucket.keyAsString),
    peaks, peakMonths, peakiness: peakMax / median,
  };
}

const DEFAULT_QUERIES = [
  "elon musk", "sam altman", "chatgpt", "deepseek", "agi", "ai bubble",
  "censorship", "antitrust", "return to office", "tiktok", "layoffs",
  "copilot", "llama", "gemini", "zig", "bun", "figma", "crypto",
];

function readQueries(): string[] {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "-") {
    // read newline-separated terms from stdin
    const txt = require("fs").readFileSync(0, "utf8") as string;
    return txt.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  if (args.length > 0) return args;
  return DEFAULT_QUERIES;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function main() {
  const QUERIES = readQueries();
  console.error(`Probing ${QUERIES.length} candidates (concurrency ${CONCURRENCY})...`);
  const stats = await mapLimit(QUERIES, CONCURRENCY, async (q) => {
    const h = await histogram(buildFilter(q));
    if (typeof h === "string") {
      return { q, tokens: tokenize(q), total: 0, first: "-", last: "-",
        peakMax: 0, peakMonth: "-", peaks: 0, peakMonths: [], peakiness: 0, err: h } as Stats;
    }
    return analyze(q, h);
  });

  // Rank: multi-peak first, then by a volume*peakiness score.
  const score = (s: Stats) => s.total * Math.log1p(s.peakiness) * (s.peaks >= 2 ? 2 : 1);
  stats.sort((a, b) => score(b) - score(a));

  const h = (s: string, n: number) => s.padEnd(n);
  console.log(
    `\n${h("query", 20)} ${h("total", 9)} ${h("peaks", 6)} ${h("peakMax", 9)} ${h("peaky", 7)} ${h("span", 18)} top-peaks`,
  );
  console.log("-".repeat(110));
  for (const s of stats) {
    if (s.err) {
      console.log(`${h(s.q, 20)} ${s.err}`);
      continue;
    }
    console.log(
      `${h(s.q, 20)} ${h(String(s.total), 9)} ${h(String(s.peaks), 6)} ${h(String(s.peakMax), 9)} ` +
      `${h(s.peakiness.toFixed(1), 7)} ${h(`${s.first}..${s.last}`, 18)} ${s.peakMonths.slice(0, 6).join(" ")}`,
    );
  }

  const shortlist = stats.filter((s) => s.peaks >= 2 && s.total >= 500 && s.peakiness >= 3);
  console.log(`\n=== shortlist (peaks>=2, total>=500, peakiness>=3): ${shortlist.length} ===`);
  console.log(shortlist.map((s) => s.q).join(", "));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
