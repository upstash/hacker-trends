/**
 * Server-side data layer for the SEO landing pages (`/trends/[term]`,
 * `/compare/[slug]`) and their OG images.
 *
 * Those routes are ISR (see each route's `revalidate`): rendered on first
 * request, then served from cache, so the cost here is paid once per page per
 * revalidate window, not per request. A term's histogram comes from the shared
 * examples cache (one read-only GET for the whole catalog, memoized per
 * instance); only a term outside it runs a live aggregate. Top stories are one
 * live SEARCH.QUERY - real HN headlines are the indexable content these pages
 * exist to surface. While the runtime kill switch is on, nothing live runs: the
 * cache (or the baked snapshot) is the only source.
 *
 * Server-only (reads the Upstash token); never import from a "use client" file.
 */

import { hnRedis, runAggregate, runSearch } from "@/lib/hn-index";
import { readExamplesCache, type MonthCount } from "@/lib/examples-data";
import { decodeExamplesWire, type ExamplesWire } from "@/lib/examples-wire";
import { isQueryingDisabled } from "@/lib/runtime-flags";
import { SLOTS, lastSlotOf, slotOf, slotRange } from "@/lib/trend-time";
import { type HnDoc } from "@/lib/hn-query";
import snapshot from "@/app/examples.json/snapshot.json";

const HAS_CREDS = !!(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

/** The SDK client (env-driven), or null when creds are missing so a missing
 *  backend degrades to an empty page section, never a crash. */
const redis = HAS_CREDS ? hnRedis() : null;

/** A cached catalog: term -> histogram, plus the slot that was still in
 *  progress when it was built (charts end that data there). */
type Gallery = { terms: Record<string, MonthCount[]>; endSlot: number };

const GALLERY_TTL_MS = 5 * 60_000;
const GALLERY_MISS_TTL_MS = 30_000;
let gallery: { at: number; ttl: number; p: Promise<Gallery | null> } | null = null;

/** The examples cache blob, memoized per instance for a few minutes and shared
 *  by concurrent renders, so a burst of ISR regenerations is one multi-MB GET.
 *  Read-only: a miss is `null` (remembered briefly), never a compute. */
function galleryCache(): Promise<Gallery | null> {
  const now = Date.now();
  if (gallery && now - gallery.at < gallery.ttl) return gallery.p;
  const p = readExamplesCache()
    .then((d) => (d ? { terms: d.terms, endSlot: lastSlotOf(d.terms) } : null))
    .catch(() => null);
  const entry = { at: now, ttl: GALLERY_TTL_MS, p };
  gallery = entry;
  void p.then((g) => {
    if (!g) entry.ttl = GALLERY_MISS_TTL_MS;
  });
  return p;
}

let snap: Gallery | null = null;
/** The baked gallery snapshot: last resort for catalog terms when the cache is
 *  missing and live querying is off or failing. */
function snapshotGallery(): Gallery {
  if (!snap) {
    const terms = decodeExamplesWire(snapshot as ExamplesWire);
    snap = { terms, endSlot: lastSlotOf(terms) };
  }
  return snap;
}

export type TermSeries = {
  buckets: MonthCount[];
  /** The data's in-progress slot (see trend-time `trendPaths`). */
  endSlot: number;
};

/** A term's histogram: the examples cache, else a live aggregate (skipped while
 *  querying is disabled), else the baked snapshot. Throws when a live aggregate
 *  fails with nothing to fall back to, so ISR keeps the previous page (or
 *  retries) instead of caching an empty chart. */
async function seriesFor(term: string, live: boolean): Promise<TermSeries> {
  const g = await galleryCache();
  const cached = g?.terms[term];
  if (g && cached?.length) return { buckets: cached, endSlot: g.endSlot };
  let failure: unknown = null;
  if (live && redis) {
    try {
      const agg = await runAggregate(redis, { q: term });
      return {
        buckets: agg.buckets.map((b) => ({ key: b.key, docCount: b.docCount })),
        endSlot: SLOTS - 1,
      };
    } catch (e) {
      failure = e;
    }
  }
  const s = snapshotGallery();
  const baked = s.terms[term];
  if (baked?.length) return { buckets: baked, endSlot: s.endSlot };
  if (failure) throw failure;
  return { buckets: [], endSlot: SLOTS - 1 };
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

/** "Feb 2026": the calendar month a 30d bucket starts in. */
function monthLabel(epochMs: number): string {
  const d = new Date(slotRange(slotOf(epochMs)).fromMs);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

/** Headline stats. The peak skips the in-progress slot (`endSlot`): a partial
 *  count isn't a peak month. */
export function statsFor(buckets: MonthCount[], endSlot = SLOTS - 1): TermStats {
  let total = 0;
  let peak: MonthCount | null = null;
  let first: number | null = null;
  let last: number | null = null;
  for (const b of buckets) {
    total += b.docCount;
    if (b.docCount > 0) {
      if (first === null) first = b.key;
      last = b.key;
      if (slotOf(b.key) < endSlot && (!peak || b.docCount > peak.docCount)) peak = b;
    }
  }
  return {
    total,
    peakLabel: peak ? monthLabel(peak.key) : null,
    peakCount: peak?.docCount ?? 0,
    firstYear: first ? new Date(slotRange(slotOf(first)).fromMs).getUTCFullYear() : null,
    lastYear: last ? new Date(slotRange(slotOf(last)).fromMs).getUTCFullYear() : null,
  };
}

/** A plain-language, factual one-liner stating the headline numbers up front -
 *  the sentence an LLM answer or a featured snippet can lift verbatim. Built
 *  deterministically from the stats (no model), so it's always accurate. */
export function trendSummary(term: string, stats: TermStats): string {
  const display = term.charAt(0).toUpperCase() + term.slice(1);
  if (stats.total === 0) {
    return `${display} has no recorded Hacker News mentions in this index yet.`;
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
  return `${display} was mentioned ${stats.total.toLocaleString()} times on Hacker News${span}${peak}.`;
}

/** Just the histogram + derived stats for a term (no story fetch). Used by the
 *  OG image routes, which only draw the line. */
export async function getTermSeries(
  term: string,
): Promise<TermSeries & { stats: TermStats }> {
  const live = !(await isQueryingDisabled());
  const series = await seriesFor(term, live);
  return { ...series, stats: statsFor(series.buckets, series.endSlot) };
}

export type TermLanding = TermSeries & {
  term: string;
  stats: TermStats;
  stories: HnDoc[];
};

export async function getTermLanding(term: string): Promise<TermLanding> {
  const live = !(await isQueryingDisabled());
  const [series, stories] = await Promise.all([
    seriesFor(term, live),
    live ? topStories(term) : Promise.resolve([]),
  ]);
  return { term, ...series, stats: statsFor(series.buckets, series.endSlot), stories };
}

export type ComparisonSeries = TermSeries & {
  term: string;
  stats: TermStats;
  /** A few top headlines for this term - real, per-term content so a comparison
   *  page isn't just an overlaid chart (which read as thin/templated). */
  stories: HnDoc[];
};

export type ComparisonLanding = {
  terms: string[];
  series: ComparisonSeries[];
};

/** Per-term series + stats, and (when `storiesPerTerm` > 0) top stories. The
 *  OG image passes 0: it only draws the lines. */
export async function getComparisonLanding(
  terms: string[],
  storiesPerTerm = 4,
): Promise<ComparisonLanding> {
  const live = !(await isQueryingDisabled());
  const series = await Promise.all(
    terms.map(async (term) => {
      const [s, stories] = await Promise.all([
        seriesFor(term, live),
        live && storiesPerTerm > 0 ? topStories(term, storiesPerTerm) : Promise.resolve([]),
      ]);
      return { term, ...s, stats: statsFor(s.buckets, s.endSlot), stories };
    }),
  );
  return { terms, series };
}
