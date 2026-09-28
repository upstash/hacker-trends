/**
 * Server-side data layer for the "Who is hiring?" SEO landing pages
 * (`/who-is-hiring/[term]`, `/who-is-hiring/compare/[slug]`,
 * `/who-is-hiring/top/[slug]`).
 *
 * The jobs-scoped twin of `landing-data.ts`. Those routes are ISR pages
 * (`revalidate` = 1 day, no build-time prerender): the stats and a sample of the
 * real job postings are server-rendered into the cached HTML so Google (and a
 * no-JS visitor) sees the actual content, and the monthly series is handed to the
 * client chart as initial data. Everything here runs at most once per page per
 * revalidate window, never per view.
 *
 * Two reads back the page:
 *
 *   1. Monthly histograms (the chart + the stats), one per OR-group PART. We
 *      read the CI-primed gallery wire (`readJobsGalleryParts`, one memoized GET
 *      covering every gallery part) and only aggregate live for a part it does
 *      not cover (or when the key is missing). Never the full gallery rebuild.
 *
 *   2. A sample of the real postings (the unique, indexable content). A single
 *      SEARCH.QUERY per term on the jobs index, each carrying its poster handle,
 *      parent thread id (for the `/archived/<id>` link) and a text snippet.
 *
 * When live querying is disabled (`isQueryingDisabled`) the live reads are
 * skipped, and any render that had to degrade (disabled, or a read failed)
 * shortens its own ISR lifetime so the full page comes back
 * within minutes instead of a day.
 *
 * Server-only: it reads the Upstash token. Import from route handlers / server
 * components only, never from a "use client" file.
 */

import { hnRedis, runAggregate, runSearch } from "@/lib/hn-index";
import { type HnDoc, type SortMode } from "@/lib/hn-query";
import { readJobsGalleryParts } from "@/lib/jobs-gallery-data";
import { drillIndex } from "@/lib/jobs-index";
import { isQueryingDisabled } from "@/lib/runtime-flags";
import {
  parseParts,
  normalizeSeries,
  binMonths,
  sumByMonth,
  colorAt,
  monthKey,
  monthIndex,
  fromMonthIndex,
  currentMonthIndex,
  centeredSnippet,
  type RawBucket,
  type SeriesData,
} from "@/lib/jobs-trends";
import { WHO_IS_HIRING_THREADS } from "@/lib/who-is-hiring-data";

const HAS_CREDS = !!(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

/** A lean monthly point - epoch-ms bucket key + the count. */
export type MonthCount = { key: number; docCount: number };

/** The SDK client (env-driven), or null when creds are missing so a missing
 *  backend degrades to an empty page section, never a crash. */
const redis = HAS_CREDS ? hnRedis() : null;

/** Per-render state: whether live reads are allowed, and whether anything had
 *  to degrade (so the render can shorten its ISR lifetime). */
type Ctx = { live: boolean; degraded: boolean };

async function newCtx(): Promise<Ctx> {
  const live = !!redis && !(await isQueryingDisabled());
  return { live, degraded: !live };
}

/** How long a degraded render may be served before ISR retries it. */
const DEGRADED_REVALIDATE_S = 300;

/** Shorten the current render's ISR lifetime. A fetch with a smaller
 *  `next.revalidate` than the route's lowers the whole route's revalidate for
 *  this render (Next's documented per-render opt-in); a PING is the cheapest
 *  request that carries it, and the data cache dedupes it for its lifetime. */
async function finish(ctx: Ctx): Promise<void> {
  if (!ctx.degraded || !process.env.UPSTASH_REDIS_REST_URL) return;
  try {
    await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/ping`, {
      headers: { authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      next: { revalidate: DEGRADED_REVALIDATE_S },
    });
  } catch {
    // best effort: worst case the degraded page lives for the normal window
  }
}

/* ---------- monthly histograms (chart + stats) ---------------------- */

/** One OR-group part's jobs-scoped monthly histogram: the primed gallery wire
 *  first (one memoized GET for every gallery part), else a live aggregate for
 *  just this part. */
async function partBuckets(part: string, ctx: Ctx): Promise<MonthCount[]> {
  const gallery = await readJobsGalleryParts();
  const cached = gallery?.[part];
  if (cached && cached.length) return cached;
  if (!ctx.live) return [];
  try {
    // Same gate the live hooks use: the dedicated `hnjobs` index when ready (no
    // scope arm), else the shared `hn` index narrowed by `scope=jobs`.
    const { index, scope } = drillIndex();
    const agg = await runAggregate(redis!, { q: part, scope, index });
    return agg.buckets.map((b) => ({ key: b.key, docCount: b.docCount }));
  } catch {
    ctx.degraded = true;
    return [];
  }
}

/** Build one binned, colored `SeriesData` for a series string (summing its `|`
 *  OR-group parts bucket-for-bucket, exactly like the live `useJobSeries` hook
 *  does, but on the server). */
async function buildSeries(series: string, colorIdx: number, ctx: Ctx): Promise<SeriesData> {
  const label = normalizeSeries(series);
  const parts = parseParts(label);
  const perPart = await Promise.all(
    parts.map(async (p) => binMonths((await partBuckets(p, ctx)) as RawBucket[])),
  );
  const byMonth = sumByMonth(perPart);
  let total = 0;
  for (const v of byMonth.values()) total += v;
  return {
    label,
    parts,
    color: colorAt(colorIdx),
    byMonth,
    total,
  };
}

/** Build the full `SeriesData[]` for a term-set (the chart input), index-aligned
 *  to `terms` so colors match the legend. */
async function buildJobSeries(terms: string[], ctx: Ctx): Promise<SeriesData[]> {
  return Promise.all(terms.map((t, i) => buildSeries(t, i, ctx)));
}

/* ---------- derived stats ------------------------------------------- */

export type JobsTermStats = {
  /** all-time total mentions across the whole "Who is hiring?" history. */
  total: number;
  /** the single biggest month: label like "Feb 2026" + its count. */
  peakLabel: string | null;
  peakCount: number;
  /** the most recent month's count (the freshest bar). */
  latestLabel: string | null;
  latestCount: number;
  /** the latest month is the in-progress current month (count is so far). */
  latestPartial: boolean;
  /** first and last calendar year with any mentions. */
  firstYear: number | null;
  lastYear: number | null;
};

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Full month names for the human "<Month> <Year>" section heading. */
const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Latest month-index across all series (the freshest bar). Falls back to the
 *  current month when every series is empty. */
function latestIdx(series: SeriesData[]): number {
  let max = -1;
  for (const s of series)
    for (const k of s.byMonth.keys()) {
      const [y, m] = k.split("-").map(Number);
      const idx = monthIndex(y, m);
      if (idx > max) max = idx;
    }
  return max >= 0 ? max : currentMonthIndex();
}

/** Per-series headline stats from its binned month map. `latest*` reports the
 *  count in the dataset's newest month (shared across the whole term-set so the
 *  numbers line up). */
export function statsForSeries(s: SeriesData, latestMonthIdx: number): JobsTermStats {
  let total = 0;
  let peakKey: string | null = null;
  let peakCount = 0;
  let first: number | null = null;
  let last: number | null = null;
  // Walk in chronological order so first/last years are correct.
  const keys = [...s.byMonth.keys()].sort((a, b) => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return monthIndex(ay, am) - monthIndex(by, bm);
  });
  for (const k of keys) {
    const v = s.byMonth.get(k) ?? 0;
    total += v;
    if (v > 0) {
      const [y] = k.split("-").map(Number);
      if (first === null) first = y;
      last = y;
      if (v > peakCount) {
        peakCount = v;
        peakKey = k;
      }
    }
  }
  const label = (k: string | null): string | null => {
    if (!k) return null;
    const [y, m] = k.split("-").map(Number);
    return `${MONTH_ABBR[m]} ${y}`;
  };
  const [ly, lm] = (() => {
    const yy = Math.floor(latestMonthIdx / 12);
    const mm = ((latestMonthIdx % 12) + 12) % 12;
    return [yy, mm];
  })();
  const latestKey = monthKey(ly, lm);
  return {
    total,
    peakLabel: label(peakKey),
    peakCount,
    latestLabel: `${MONTH_ABBR[lm]} ${ly}`,
    latestCount: s.byMonth.get(latestKey) ?? 0,
    latestPartial: latestMonthIdx === currentMonthIndex(),
    firstYear: first,
    lastYear: last,
  };
}

/* ---------- real job postings (the indexable content) --------------- */

/** A trimmed job posting for the server-rendered sample. */
export type JobPosting = {
  /** HN comment id (the posting itself). */
  id: number;
  /** poster handle. */
  by: string;
  /** parent "Who is hiring?" thread id - the `/archived/<parent>` destination. */
  parent: number | null;
  /** "YYYY-MM" of the posting (its thread's month). */
  month: string | null;
  /** a clean, HTML-stripped excerpt of the posting body. */
  snippet: string;
  /** direct-reply (discussion) count, when the dedicated `hnjobs` index supplies
   *  it. Drives the "most interactions" ordering of the popular sample; absent on
   *  the shared `hn` index (where the comment count is always 0). */
  replies?: number;
};

/** thread-id -> "YYYY-MM", so a posting can be labelled by its hiring month. */
const THREAD_MONTH: Map<number, string> = (() => {
  const m = new Map<number, string>();
  for (const t of WHO_IS_HIRING_THREADS) m.set(t.id, t.month);
  return m;
})();

/** Strip HTML + decode the handful of entities the index stores, collapse
 *  whitespace. Same cleanup the client drill-down panel does, but server-side so
 *  the excerpt is in the crawlable HTML. */
function plain(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

/** A readable excerpt of the cleaned body, centered on the first whole-word
 *  match of `term` so the highlighted mention is always in view. */
function excerpt(raw: string, term: string, max = 280): string {
  return centeredSnippet(plain(raw), term, max);
}

/** "YYYY-MM" of a posting: its thread's manifest month, else the posting time
 *  (a thread the manifest doesn't know yet still gets a label). */
function postingMonth(d: HnDoc, parent: number | null): string | null {
  const known = parent != null ? THREAD_MONTH.get(parent) : undefined;
  if (known) return known;
  const t = Date.parse(d.time);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 7) : null;
}

/** Turn a raw `HnDoc` posting into the trimmed wire shape. */
function toPosting(d: HnDoc, term: string): JobPosting {
  const parent = d.parent ?? null;
  // `replies` on the dedicated `hnjobs` index; `ndesc` on the shared `hn` index
  // (always 0 for comments). Only carry a positive count.
  const replies = d.replies ?? d.ndesc ?? 0;
  return {
    id: d.id,
    by: d.by,
    parent,
    month: postingMonth(d, parent),
    snippet: excerpt(d.text ?? "", term),
    ...(replies > 0 ? { replies } : {}),
  };
}

/** Over-fetch a term's postings, scope=jobs (or `hnjobs` when ready). `sort`
 *  picks the ordering ("relevance" for a representative sample; "discussed" to
 *  surface the most-replied-to postings), and `from`/`to` bound the time window
 *  (e.g. one calendar month, or this year onward). */
async function fetchPostings(
  part: string,
  opts: { limit: number; from?: string; to?: string; sort?: SortMode },
  ctx: Ctx,
): Promise<HnDoc[]> {
  if (!ctx.live) return [];
  const { index, scope } = drillIndex();
  try {
    return await runSearch(redis!, {
      q: part,
      scope,
      index,
      sort: opts.sort ?? "relevance",
      limit: opts.limit,
      from: opts.from,
      to: opts.to,
    });
  } catch {
    ctx.degraded = true;
    return [];
  }
}

/** Collect up to `limit` postings from `docs` into `out`, skipping anything
 *  already taken (by id) or a repeat poster (by handle) - so one company
 *  spamming the thread can't fill the list with near-identical text. Mutates the
 *  shared `seenAuthor`/`seenId` sets so successive passes compose, and a later
 *  section never repeats a posting an earlier one already showed. */
function collectPostings(
  docs: HnDoc[],
  term: string,
  limit: number,
  out: JobPosting[],
  seenAuthor: Set<string>,
  seenId: Set<number>,
): void {
  for (const d of docs) {
    if (out.length >= limit) break;
    if (seenId.has(d.id)) continue;
    const p = toPosting(d, term);
    if (!p.snippet) continue;
    const key = p.by.toLowerCase();
    if (seenAuthor.has(key)) continue;
    seenAuthor.add(key);
    seenId.add(d.id);
    out.push(p);
  }
}

/** How far back "recent" reaches for the small per-side comparison samples. */
const RECENT_FROM = "2024-01-01T00:00:00.000Z";

/**
 * A representative sample of the REAL postings that mention a term, for the
 * server-rendered "what these jobs actually look like" section. Prefer recent
 * postings (since RECENT_FROM) so the sample reflects who is hiring now; if that
 * yields fewer than `limit`, top up from the all-time set. De-duped by poster so
 * a single company spamming the thread can't fill the sample with near-identical
 * text.
 */
async function samplePostings(
  term: string,
  limit: number,
  ctx: Ctx,
): Promise<JobPosting[]> {
  const part = parseParts(term)[0] ?? term;
  const out: JobPosting[] = [];
  const seenAuthor = new Set<string>();
  const seenId = new Set<number>();
  // Recent first, then backfill from all-time if the recent window is thin.
  collectPostings(
    await fetchPostings(part, { limit: limit * 4, from: RECENT_FROM }, ctx),
    part, limit, out, seenAuthor, seenId,
  );
  if (out.length < limit && ctx.live) {
    collectPostings(
      await fetchPostings(part, { limit: limit * 4 }, ctx),
      part, limit, out, seenAuthor, seenId,
    );
  }
  return out;
}

/** ISO [from, to) window covering one calendar month (0-based `month`). */
function monthIsoWindow(year: number, month: number): { from: string; to: string } {
  return {
    from: new Date(Date.UTC(year, month, 1)).toISOString(),
    to: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

/** The two posting groups a single-skill page shows: the newest month's
 *  postings, and the most-discussed ones (deduped against the first group). */
export type JobsTermPostings = {
  /** postings from the dataset's newest month (the "<Month> <Year>" section). */
  month: JobPosting[];
  /** human label of that newest month, e.g. "June 2026". */
  monthLabel: string;
  /** the most-discussed postings (most replies first), excluding `month`. */
  popular: JobPosting[];
  /** the year `popular` is scoped to, or null when it falls back to all-time. */
  popularYear: number | null;
};

/**
 * Build the two postings groups for a single-skill page:
 *
 *   1. `month` - the postings in the dataset's NEWEST month (so the lead section
 *      is honestly "<this month>'s postings", not a vague "recent" mix that
 *      reaches back years).
 *   2. `popular` - the most-DISCUSSED postings (ranked by direct replies), scoped
 *      to the current year and EXCLUDING anything already in `month`. If the
 *      year is thin it broadens to all-time (`popularYear` then null).
 */
async function termPostings(
  term: string,
  latestIdxVal: number,
  ctx: Ctx,
): Promise<JobsTermPostings> {
  const part = parseParts(term)[0] ?? term;
  const { year: ly, month: lm } = fromMonthIndex(latestIdxVal);
  const monthLabel = `${MONTH_FULL[lm]} ${ly}${latestIdxVal === currentMonthIndex() ? " (so far)" : ""}`;

  const seenAuthor = new Set<string>();
  const seenId = new Set<number>();

  // 1) Newest month, most-discussed first so the lead postings are the liveliest.
  const win = monthIsoWindow(ly, lm);
  const month: JobPosting[] = [];
  collectPostings(
    await fetchPostings(part, { limit: 24, from: win.from, to: win.to, sort: "discussed" }, ctx),
    part, 5, month, seenAuthor, seenId,
  );

  // 2) Most-discussed this year, excluding the month set. Broaden to all-time if
  //    the current year is too thin to fill the section.
  const yearFrom = new Date(Date.UTC(ly, 0, 1)).toISOString();
  let popularYear: number | null = ly;
  const popular: JobPosting[] = [];
  collectPostings(
    await fetchPostings(part, { limit: 50, from: yearFrom, sort: "discussed" }, ctx),
    part, 5, popular, seenAuthor, seenId,
  );
  if (popular.length < 3 && ctx.live) {
    popularYear = null;
    collectPostings(
      await fetchPostings(part, { limit: 50, sort: "discussed" }, ctx),
      part, 5, popular, seenAuthor, seenId,
    );
  }

  return { month, monthLabel, popular, popularYear };
}

/* ---------- remote share (cheap extra stat) ------------------------- */

/** What fraction of a term's postings also mention "remote", as a rough
 *  remote-share signal for job-seekers. Two cheap jobs aggregates (the term, and
 *  the term ANDed with remote via a two-token query) reusing the gallery cache
 *  where possible. Returns null when the term has no postings or the stat
 *  couldn't be read live. */
async function remoteShare(term: string, ctx: Ctx): Promise<number | null> {
  const part = parseParts(term)[0] ?? term;
  const [base, withRemote] = await Promise.all([
    partBuckets(part, ctx),
    (async () => {
      if (!ctx.live) return null;
      try {
        const { index, scope } = drillIndex();
        const agg = await runAggregate(redis!, { q: `${part} remote`, scope, index });
        return agg.buckets.map((b) => ({ key: b.key, docCount: b.docCount }));
      } catch {
        ctx.degraded = true;
        return null;
      }
    })(),
  ]);
  const total = base.reduce((a, b) => a + b.docCount, 0);
  if (total <= 0 || !withRemote) return null;
  const remote = withRemote.reduce((a, b) => a + b.docCount, 0);
  return Math.max(0, Math.min(1, remote / total));
}

/* ---------- composed landing payloads ------------------------------- */

export type JobsTermLanding = {
  term: string;
  series: SeriesData[];
  stats: JobsTermStats;
  /** the newest month's postings + the most-discussed postings (see
   *  `JobsTermPostings`); replaces the old single "recent" list. */
  postings: JobsTermPostings;
  /** fraction of postings that also mention remote, or null. */
  remote: number | null;
  /** when this render happened (epoch ms): the chart's "current month". */
  renderedAt: number;
};

/** Everything the single-skill page needs, fetched in parallel. */
export async function getJobsTermLanding(term: string): Promise<JobsTermLanding> {
  const ctx = await newCtx();
  const [series, remote] = await Promise.all([
    buildJobSeries([term], ctx),
    remoteShare(term, ctx),
  ]);
  const latest = latestIdx(series);
  const stats = statsForSeries(series[0], latest);
  const postings = await termPostings(term, latest, ctx);
  await finish(ctx);
  return { term, series, stats, postings, remote, renderedAt: Date.now() };
}

export type JobsComparisonSeries = {
  term: string;
  stats: JobsTermStats;
  /** a couple of real postings per side, so a comparison page isn't only a chart. */
  postings: JobPosting[];
};

export type JobsComparisonLanding = {
  terms: string[];
  series: SeriesData[];
  perSeries: JobsComparisonSeries[];
  /** when this render happened (epoch ms): the chart's "current month". */
  renderedAt: number;
};

/** Everything a comparison / category page needs: the binned series for the
 *  stacked chart, plus per-series stats and a small sample of real postings. */
export async function getJobsComparisonLanding(
  terms: string[],
  postingsPerTerm = 3,
): Promise<JobsComparisonLanding> {
  const ctx = await newCtx();
  const series = await buildJobSeries(terms, ctx);
  const latest = latestIdx(series);
  const perSeries = await Promise.all(
    series.map(async (s) => ({
      term: s.label,
      stats: statsForSeries(s, latest),
      postings: await samplePostings(s.label, postingsPerTerm, ctx),
    })),
  );
  await finish(ctx);
  return { terms, series, perSeries, renderedAt: Date.now() };
}
