/**
 * Server-side data layer for the SEO landing pages (`/trends/[term]`,
 * `/compare/[slug]`).
 *
 * These pages are statically generated / ISR-revalidated (see each route's
 * `revalidate`), so the cost here is paid at build/revalidate time, not per
 * request. For a term's monthly histogram we first try the single cached
 * examples key (one GET returns every catalog term's series); only a term
 * outside the catalog falls back to a live aggregate. Top stories are always a
 * single live SEARCH.QUERY - real HN headlines are exactly the indexable
 * content these pages exist to surface.
 *
 * Server-only (reads the Upstash token); never import from a "use client" file.
 */

import { hnRedis, runAggregate, runSearch } from "@/lib/hn-index";
import { getExamplesData, type MonthCount } from "@/lib/examples-data";
import { type HnDoc } from "@/lib/hn-query";

const HAS_CREDS = !!(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

/** The SDK client (env-driven), or null when creds are missing so a missing
 *  backend degrades to an empty page section, never a crash. */
const redis = HAS_CREDS ? hnRedis() : null;

/** A term's monthly histogram: prefer the shared examples cache (one GET for
 *  the whole catalog), fall back to a live SDK aggregate for off-catalog terms. */
async function bucketsFor(term: string): Promise<MonthCount[]> {
  try {
    const examples = await getExamplesData();
    const cached = examples.terms[term];
    if (cached && cached.length) return cached;
  } catch {
    // fall through to live
  }
  if (!redis) return [];
  try {
    const agg = await runAggregate(redis, { q: term });
    return agg.buckets.map((b) => ({ key: b.key, docCount: b.docCount }));
  } catch {
    return [];
  }
}

/** Top stories for a term, by upvotes - the headline list a landing page shows.
 *  `type: "story"` so comments don't crowd out the front-page-able items. */
async function topStories(term: string, limit = 12): Promise<HnDoc[]> {
  if (!redis) return [];
  try {
    return await runSearch(redis, { q: term, sort: "score", limit, type: "story" });
  } catch {
    return [];
  }
}

export type TermStats = {
  /** sum of monthly counts across all of HN history */
  total: number;
  /** the single biggest month: label like "Feb 2026", plus its count */
  peakLabel: string | null;
  peakCount: number;
  /** first and last month with any mentions (year labels) */
  firstYear: number | null;
  lastYear: number | null;
};

function monthLabel(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

export function statsFor(buckets: MonthCount[]): TermStats {
  let total = 0;
  let peak: MonthCount | null = null;
  let first: number | null = null;
  let last: number | null = null;
  for (const b of buckets) {
    total += b.docCount;
    if (b.docCount > 0) {
      if (first === null) first = b.key;
      last = b.key;
      if (!peak || b.docCount > peak.docCount) peak = b;
    }
  }
  return {
    total,
    peakLabel: peak ? monthLabel(peak.key) : null,
    peakCount: peak?.docCount ?? 0,
    firstYear: first ? new Date(first).getUTCFullYear() : null,
    lastYear: last ? new Date(last).getUTCFullYear() : null,
  };
}

/** A plain-language, factual one-liner stating the headline numbers up front -
 *  the sentence an LLM answer or a featured snippet can lift verbatim. Built
 *  deterministically from the stats (no model), so it's always accurate. */
export function trendSummary(term: string, stats: TermStats): string {
  const display = term.charAt(0).toUpperCase() + term.slice(1);
  if (stats.total === 0) {
    return `“${display}” has no recorded Hacker News mentions in this index yet.`;
  }
  const span =
    stats.firstYear && stats.lastYear
      ? stats.firstYear === stats.lastYear
        ? ` in ${stats.firstYear}`
        : ` between ${stats.firstYear} and ${stats.lastYear}`
      : "";
  const peak = stats.peakLabel
    ? `, peaking in ${stats.peakLabel} with ${stats.peakCount.toLocaleString()} that month`
    : "";
  return `“${display}” was mentioned ${stats.total.toLocaleString()} times on Hacker News${span}${peak}.`;
}

/** Just the histogram + derived stats for a term (no story fetch). Used by the
 *  OG image routes, which only draw the line. */
export async function getTermSeries(
  term: string,
): Promise<{ buckets: MonthCount[]; stats: TermStats }> {
  const buckets = await bucketsFor(term);
  return { buckets, stats: statsFor(buckets) };
}

export type TermLanding = {
  term: string;
  buckets: MonthCount[];
  stats: TermStats;
  stories: HnDoc[];
};

export async function getTermLanding(term: string): Promise<TermLanding> {
  const [buckets, stories] = await Promise.all([
    bucketsFor(term),
    topStories(term),
  ]);
  return { term, buckets, stats: statsFor(buckets), stories };
}

export type ComparisonSeries = {
  term: string;
  buckets: MonthCount[];
  stats: TermStats;
  /** A few top headlines for this term - real, per-term content so a comparison
   *  page isn't just an overlaid chart (which read as thin/templated). */
  stories: HnDoc[];
};

export type ComparisonLanding = {
  terms: string[];
  series: ComparisonSeries[];
};

export async function getComparisonLanding(
  terms: string[],
  storiesPerTerm = 4,
): Promise<ComparisonLanding> {
  const series = await Promise.all(
    terms.map(async (term) => {
      const [buckets, stories] = await Promise.all([
        bucketsFor(term),
        topStories(term, storiesPerTerm),
      ]);
      return { term, buckets, stats: statsFor(buckets), stories };
    }),
  );
  return { terms, series };
}
