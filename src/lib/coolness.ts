/**
 * Internal "coolness" metric for the /examples comparisons.
 *
 * A heuristic for how INTERESTING a comparison is likely to be to a human, used
 * only to ORDER the comparison gallery (most interesting first). It is never
 * shown in the UI; it just replaces the previously-arbitrary array order.
 *
 * It scores the things that make a "changing places" chart fun to look at, each
 * derived from the same monthly histograms the gallery already plots:
 *
 *   - fame         how big the biggest moment was, the tallest single spike
 *                  across the terms (a 7k-post month is a cultural event)
 *   - volume       how much HN talks about these terms overall, log-scaled
 *   - recency      recent rivalries feel current; a 2025 race beats a 2010 one
 *   - leadChanges  does the #1 line actually change hands? (the whole point of
 *                  a comparison), what fraction of the terms get a turn on top
 *   - offset       peaks spread across a few years, not all spiking at once
 *                  (saturates fast; a clean handoff doesn't need a decade)
 *   - balance      comparable peak heights, a real contest, not a blowout
 *   - drama        sharp, tall spikes rather than gentle humps
 *
 * Each sub-score is normalized to 0..1; coolness is their weighted sum (0..1).
 * Tweak WEIGHTS to re-rank; they sum to 1 so the result stays interpretable.
 */

/** Lean monthly point (mirrors examples-data MonthCount; `key` is an epoch ms). */
type MonthBucket = { key: number; docCount: number };

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const RECENCY_FLOOR_YEAR = 2009; // peaks at/older than this score ~0 on recency
const RECENCY_CEIL_YEAR = 2026; // ...and at/after this score ~1
const FAME_FULL = 3.9; // log10(tallest single month) for a full fame score (~8k posts)
const VOLUME_FULL = 5.3; // log10(combined docs) that maps to a full volume score (~200k)
const OFFSET_FULL_YEARS = 4; // peak spread (yrs) that maps to a full offset score
const DRAMA_FULL = 12; // peakiness (peak/median) that maps to a full drama score
const LEAD_NOISE_FRAC = 0.15; // ignore "leads" in months below this × the global peak

const WEIGHTS = {
  fame: 0.28,
  volume: 0.12,
  recency: 0.22,
  leadChanges: 0.15,
  offset: 0.08,
  balance: 0.05,
  drama: 0.1,
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

type TermStats = { total: number; peakMax: number; peakMs: number; peakiness: number };

function statsFor(buckets: MonthBucket[]): TermStats {
  let total = 0;
  let peakMax = 0;
  let peakMs = 0;
  const nonzero: number[] = [];
  for (const b of buckets) {
    total += b.docCount;
    if (b.docCount > 0) nonzero.push(b.docCount);
    if (b.docCount > peakMax) {
      peakMax = b.docCount;
      peakMs = b.key;
    }
  }
  nonzero.sort((a, b) => a - b);
  const median = nonzero[Math.floor(nonzero.length / 2)] || 1;
  return { total, peakMax, peakMs, peakiness: peakMax / median };
}

/** Fraction of the terms that are the single tallest line in at least one
 *  meaningful month (above LEAD_NOISE_FRAC × the comparison's global peak). 1.0
 *  means every term gets a turn at #1; the lead truly changes hands. */
function leadChangeScore(seriesBuckets: MonthBucket[][]): number {
  const n = seriesBuckets.length;
  if (n < 2) return 0;
  const byMonth = new Map<number, number[]>();
  let globalPeak = 0;
  seriesBuckets.forEach((buckets, i) => {
    for (const b of buckets) {
      if (!byMonth.has(b.key)) byMonth.set(b.key, new Array(n).fill(0));
      const row = byMonth.get(b.key)!;
      row[i] += b.docCount;
      if (row[i] > globalPeak) globalPeak = row[i];
    }
  });
  const floor = globalPeak * LEAD_NOISE_FRAC;
  const leaders = new Set<number>();
  for (const counts of byMonth.values()) {
    let max = 0;
    let leader = -1;
    counts.forEach((c, i) => {
      if (c > max) {
        max = c;
        leader = i;
      }
    });
    if (leader >= 0 && max >= floor) leaders.add(leader);
  }
  return leaders.size / n;
}

/** Coolness in 0..1 for a comparison's terms, given the gallery's histogram map. */
export function comparisonCoolness(
  terms: string[],
  termData: Record<string, MonthBucket[]>,
): number {
  const seriesBuckets = terms.map((t) => termData[t] ?? []);
  const stats = seriesBuckets.map(statsFor);

  const tallestPeak = Math.max(0, ...stats.map((x) => x.peakMax));
  const fame = clamp01(Math.log10(1 + tallestPeak) / FAME_FULL);

  const totalVol = stats.reduce((s, x) => s + x.total, 0);
  const volume = clamp01(Math.log10(1 + totalVol) / VOLUME_FULL);

  const latestPeakMs = Math.max(0, ...stats.map((x) => x.peakMs));
  const latestYear = latestPeakMs ? new Date(latestPeakMs).getUTCFullYear() : RECENCY_FLOOR_YEAR;
  const recency = clamp01(
    (latestYear - RECENCY_FLOOR_YEAR) / (RECENCY_CEIL_YEAR - RECENCY_FLOOR_YEAR),
  );

  const peakMsList = stats.map((x) => x.peakMs).filter((m) => m > 0);
  const offsetYears =
    peakMsList.length > 1 ? (Math.max(...peakMsList) - Math.min(...peakMsList)) / YEAR_MS : 0;
  const offset = clamp01(offsetYears / OFFSET_FULL_YEARS);

  const peaks = stats.map((x) => x.peakMax);
  const maxPeak = Math.max(...peaks);
  const balance = maxPeak > 0 ? Math.min(...peaks) / maxPeak : 0;

  const drama = clamp01(Math.max(...stats.map((x) => x.peakiness)) / DRAMA_FULL);

  const leadChanges = leadChangeScore(seriesBuckets);

  return (
    WEIGHTS.fame * fame +
    WEIGHTS.volume * volume +
    WEIGHTS.recency * recency +
    WEIGHTS.leadChanges * leadChanges +
    WEIGHTS.offset * offset +
    WEIGHTS.balance * balance +
    WEIGHTS.drama * drama
  );
}

/** Comparisons (or anything with a `terms` array) sorted coolest-first. */
export function sortByCoolness<T extends { terms: string[] }>(
  comparisons: readonly T[],
  termData: Record<string, MonthBucket[]>,
): T[] {
  return [...comparisons]
    .map((c) => ({ c, score: comparisonCoolness(c.terms, termData) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}
