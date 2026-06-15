/**
 * Dump real shock-value metrics for every COMPARISON, from the cached examples
 * series (single GET, read-only token). For each term we compute volume, the
 * single tallest month, "tower ratio" (peak / median of non-zero months), and
 * for each comparison we detect lead-changes (crossovers) between terms over
 * time. Output is compact JSON, sorted by a rough shock score, so the launch
 * analysis can pick the most attention-grabbing matchups from real numbers.
 *
 *   bun --env-file=.env.local scripts/dump-comparison-shock.ts > /tmp/shock.json
 */
export {};
import { getExamplesData, type MonthCount } from "../src/lib/examples-data";
import { COMPARISONS } from "../src/lib/examples";

function ym(key: number): string {
  const d = new Date(key);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function median(xs: number[]): number {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function termMetrics(series: MonthCount[]) {
  const total = series.reduce((a, b) => a + b.docCount, 0);
  let peak = { key: 0, docCount: -1 };
  for (const p of series) if (p.docCount > peak.docCount) peak = p;
  const med = median(series.map((p) => p.docCount));
  return {
    total,
    peakMonth: peak.docCount > 0 ? ym(peak.key) : null,
    peakValue: peak.docCount,
    towerRatio: med ? +(peak.docCount / med).toFixed(1) : 0, // spikiness
  };
}

// Lead changes: walk a unioned monthly timeline; whoever is highest that month
// "leads". Count how many times the leader's identity flips. A clean handoff
// (e.g. docker->kubernetes) flips ~once; a back-and-forth rivalry flips often.
function leadChanges(seriesByTerm: Record<string, MonthCount[]>, terms: string[]) {
  const months = new Set<number>();
  for (const t of terms) for (const p of seriesByTerm[t]) months.add(p.key);
  const ordered = [...months].sort((a, b) => a - b);
  const at: Record<string, Map<number, number>> = {};
  for (const t of terms) at[t] = new Map(seriesByTerm[t].map((p) => [p.key, p.docCount]));
  let prevLeader: string | null = null;
  let flips = 0;
  const handoffs: string[] = [];
  for (const m of ordered) {
    let leader: string | null = null;
    let best = 0;
    let monthTotal = 0;
    for (const t of terms) {
      const v = at[t].get(m) ?? 0;
      monthTotal += v;
      if (v > best) { best = v; leader = t; }
    }
    if (monthTotal < 8) continue; // ignore low-signal months
    if (leader && leader !== prevLeader) {
      if (prevLeader) { flips++; handoffs.push(`${prevLeader}->${leader}@${ym(m)}`); }
      prevLeader = leader;
    }
  }
  return { flips, handoffs };
}

async function main() {
  const data = await getExamplesData(); // cached single GET
  const rows = COMPARISONS.map((c) => {
    const per: Record<string, ReturnType<typeof termMetrics>> = {};
    const seriesByTerm: Record<string, MonthCount[]> = {};
    let ok = true;
    for (const t of c.terms) {
      const s = data.terms[t];
      if (!s) { ok = false; continue; }
      seriesByTerm[t] = s;
      per[t] = termMetrics(s);
    }
    if (!ok) return { terms: c.terms, missing: true };
    const lc = leadChanges(seriesByTerm, c.terms);
    const maxTower = Math.max(...c.terms.map((t) => per[t].towerRatio));
    const maxPeak = Math.max(...c.terms.map((t) => per[t].peakValue));
    const totalVol = c.terms.reduce((a, t) => a + per[t].total, 0);
    // shock score: a dramatic single-month tower OR a clean lead-change, weighted
    // by enough overall volume that the chart isn't noise.
    const shock = +(
      (maxTower * 2 + lc.flips * 8) * Math.log10(totalVol + 10)
    ).toFixed(1);
    return {
      terms: c.terms,
      shock,
      totalVol,
      maxTowerRatio: maxTower,
      maxPeakMonthDocs: maxPeak,
      leadFlips: lc.flips,
      handoffs: lc.handoffs.slice(0, 5),
      per,
      story: c.story,
    };
  });
  const ranked = rows
    .filter((r) => !("missing" in r))
    .sort((a: any, b: any) => b.shock - a.shock);
  process.stdout.write(JSON.stringify({ count: ranked.length, ranked }, null, 2));
  process.stderr.write(`\n${rows.filter((r) => "missing" in r).length} missing\n`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
