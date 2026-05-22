/**
 * Validate every COMPARISON in src/lib/examples.ts the way the gallery actually
 * draws it: all series share ONE y-axis (globalMax), so a term whose own peak is
 * tiny next to its siblings renders as a flat line on the floor. For each
 * comparison we fetch the real histograms, find each term's peak month + height,
 * and flag any where min(peakMax)/max(peakMax) < FLAT_FLOOR (a flat line) or
 * where the peaks aren't offset in time (no visible lead-swap).
 *
 *   bun --env-file=.env.local scripts/validate-comparisons.ts
 */
export {};
import { COMPARISONS } from "../src/lib/examples";

const REST_URL = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
const FLAT_FLOOR = 0.25; // min/max peakMax below this => a line hugs the floor
const CONCURRENCY = 6;

function tokenize(q: string): string[] {
  const split = q.trim().split(/\s+/)
    .flatMap((t) => t.split(/[^\p{L}\p{N}]+/u))
    .filter((t) => t.length >= 2);
  return split.length > 0 ? split : q.trim().split(/\s+/).filter(Boolean);
}
function buildFilter(q: string): Record<string, unknown> {
  const tokens = tokenize(q);
  const titleClause = (t: string) => ({ title: { $eq: t, $boost: 5.0 } });
  const textClause = (t: string) => ({ text: { $eq: t } });
  if (tokens.length === 0) return {};
  if (tokens.length === 1)
    return { $or: [titleClause(tokens[0]), textClause(tokens[0]), { by: tokens[0] }] };
  return { $and: tokens.map((t) => ({ $or: [titleClause(t), textClause(t)] })) };
}
function kv(v: unknown): Record<string, unknown> {
  if (Array.isArray(v)) {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < v.length; i += 2) o[String(v[i])] = v[i + 1];
    return o;
  }
  return (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
}
async function call<T>(parts: (string | number)[]) {
  const path = parts.map((p) => encodeURIComponent(String(p))).join("/");
  const r = await fetch(`${REST_URL}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` }, cache: "no-store" });
  return (await r.json()) as { result?: T; error?: string };
}
async function peak(term: string): Promise<{ max: number; month: string; total: number }> {
  const j = await call<unknown[]>([
    "search.aggregate", "hn", JSON.stringify(buildFilter(term)),
    JSON.stringify({ x: { $dateHistogram: { field: "time", fixedInterval: "30d" } } }),
  ]);
  const buckets = (kv(kv(j.result).x).buckets as unknown[]) ?? [];
  let max = 0, month = "-", total = 0;
  for (const b of buckets) {
    const bo = kv(b);
    const c = Number(bo.docCount ?? 0);
    total += c;
    if (c > max) { max = c; month = String(bo.keyAsString ?? "").slice(0, 7); }
  }
  return { max, month, total };
}
async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

async function main() {
  const allTerms = [...new Set(COMPARISONS.flatMap((c) => c.terms))];
  const probed = await mapLimit(allTerms, CONCURRENCY, peak);
  const byTerm = new Map(allTerms.map((t, i) => [t, probed[i]]));

  let flat = 0, ok = 0;
  for (const c of COMPARISONS) {
    const ps = c.terms.map((t) => ({ t, ...byTerm.get(t)! }));
    const maxes = ps.map((p) => p.max);
    const ratio = Math.min(...maxes) / Math.max(...maxes);
    const months = ps.map((p) => p.month).sort();
    const offset = new Set(months.map((m) => m.slice(0, 4))).size >= 2 || months[0] !== months[months.length - 1];
    const bad = ratio < FLAT_FLOOR;
    if (bad) flat++; else ok++;
    const flag = bad ? "FLAT!" : "ok   ";
    console.log(
      `${flag} ratio=${ratio.toFixed(2)} ${offset ? "offset " : "SAME-T "} ${c.terms.map((t) => `${t}@${byTerm.get(t)!.month}(${byTerm.get(t)!.max})`).join("  ")}`,
    );
  }
  console.log(`\n${ok} ok, ${flat} flat (ratio < ${FLAT_FLOOR}) out of ${COMPARISONS.length} comparisons`);
  if (flat > 0) process.exit(1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
