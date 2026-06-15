/**
 * Single source of truth for SEO-facing site identity and the slug <-> term
 * mapping that the programmatic landing pages (`/trends/[term]`,
 * `/compare/[slug]`) are built from.
 *
 * Everything that needs an absolute URL (OpenGraph tags, sitemap, JSON-LD,
 * canonical links) reads `SITE_URL` from here so the canonical domain lives in
 * exactly one place. Override it per-environment with NEXT_PUBLIC_SITE_URL if
 * the deploy ever moves.
 */

import {
  COMPARISONS,
  EXAMPLE_GROUPS,
  type Comparison,
  type ExampleGroup,
} from "./examples";
import { TIER1_SLUGS, TIER3_SLUGS, COMPARE_NOINDEX_SLUGS } from "./tiers";

/** Canonical production origin (no trailing slash). */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://hackernewstrends.com"
).replace(/\/$/, "");

export const SITE_NAME = "Hacker Trends";

/** The homepage <title> element (and SERP/browser-tab title). Unlike SITE_NAME
 *  (the bare brand, used for og:siteName, JSON-LD, and the child-route template),
 *  this carries the "Hacker News" keyword so the homepage reinforces the query
 *  it ranks for ("hacker news trends") instead of leaning on the EMD alone.
 *  Kept focused on that one winnable cluster - NOT diluted toward "hacker news
 *  search" (a query Algolia owns). ~43 chars, fits the SERP without truncation. */
export const HOME_TITLE = "Hacker Trends - Topic Trends on Hacker News";

/** The descriptive one-liner used for og:title / social cards (NOT the browser
 *  tab title - that stays the short brand name, per design). */
export const SITE_TAGLINE = "18 years of Hacker News, charted";

/** Meta description: not a ranking factor, but matched query words bold in the
 *  snippet, so breadth is free CTR upside. Front-loads "search" + "Hacker News",
 *  kept to ~156 chars so nothing truncates (the old 192-char version had its
 *  "Powered by Upstash" tail cut off; that credit lives on-page + in JSON-LD). */
export const SITE_DESCRIPTION =
  "Search 18 years of Hacker News and chart how any topic, tool, or person trended. Overlay terms to compare their rise and fall across 45M posts and comments.";

/** First indexed month and last, kept in sync with trend-time.ts (2007 → 2026). */
export const HISTORY_FROM_YEAR = 2007;
export const HISTORY_TO_YEAR = 2026;
/** The span as stated in all brand copy ("18 years of Hacker News"). Pinned,
 *  not computed, so it stays consistent with the tagline (2026−2007 elapsed). */
export const HISTORY_SPAN_YEARS = 18;

/** When the catalog/landing content was last meaningfully refreshed. Pinned (not
 *  `new Date()`) so the sitemap's <lastmod> doesn't claim every URL changed on
 *  every deploy - Google learns to distrust always-"now" timestamps. Bump this
 *  when the catalog or the underlying data set is refreshed (alongside
 *  CATALOG_VERSION in examples.ts). */
export const CONTENT_UPDATED = new Date("2026-06-01T00:00:00Z");

/** Build an absolute URL on the canonical origin from a path. */
export function abs(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/* ---------- term <-> slug ------------------------------------------- */

/** A URL-safe slug for a single term. Lossy (so we keep reverse maps below for
 *  catalog terms), but stable: lowercase, non-alphanumerics collapsed to `-`. */
export function termToSlug(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Comparison slug: each term slugged, joined with `-vs-`
 *  (e.g. ["openai","anthropic"] -> "openai-vs-anthropic"). */
export function comparisonSlug(terms: string[]): string {
  return terms.map(termToSlug).join("-vs-");
}

/** Every distinct catalog term that gets its own /trends/[term] page. */
export function allTrendTerms(): string[] {
  const set = new Set<string>();
  for (const g of EXAMPLE_GROUPS) for (const t of g.terms) set.add(t);
  for (const c of COMPARISONS) for (const t of c.terms) set.add(t);
  return [...set];
}

/** slug -> original term, for resolving a /trends/[term] request back to the
 *  exact catalog phrasing. */
const TERM_BY_SLUG: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const t of allTrendTerms()) {
    const s = termToSlug(t);
    if (!m.has(s)) m.set(s, t);
  }
  return m;
})();

/** Resolve a /trends/[term] slug to a term. Falls back to a de-slugged form
 *  (dashes -> spaces) for terms outside the catalog, so the route still renders
 *  a live result instead of 404-ing on an arbitrary query. */
export function slugToTerm(slug: string): string {
  const known = TERM_BY_SLUG.get(slug.toLowerCase());
  if (known) return known;
  return decodeURIComponent(slug).replace(/-+/g, " ").trim();
}

/** True when the slug maps to a curated catalog term (used to decide indexing
 *  + whether to prebuild it). */
export function isKnownTermSlug(slug: string): boolean {
  return TERM_BY_SLUG.has(slug.toLowerCase());
}

/* ---------- SEO tiers ------------------------------------------------ */
/* Not every catalog term deserves a slot in the search index: the long tail of
 * HN-insider jargon can't realistically rank and only dilutes the site's
 * quality average (the signal 2024–26 "scaled content" enforcement keys on). So
 * terms are tiered (see tiers.ts): Tier 1 gets custom analysis + top sitemap
 * priority, Tier 2 is indexed/templated, Tier 3 is noindex,follow + dropped from
 * the sitemap (still crawlable, just not competing). */

export type Tier = 1 | 2 | 3;

/** The indexing tier for a term. Unknown (off-catalog) terms are treated as
 *  Tier 3 - they already render noindex. */
export function termTier(term: string): Tier {
  const s = termToSlug(term);
  if (TIER1_SLUGS.has(s)) return 1;
  if (!isKnownTermSlug(s) || TIER3_SLUGS.has(s)) return 3;
  return 2;
}

/** Whether a /trends/[slug] page should be indexed: a curated catalog term that
 *  isn't demoted to Tier 3. */
export function isIndexedTermSlug(slug: string): boolean {
  const s = slug.toLowerCase();
  return isKnownTermSlug(s) && !TIER3_SLUGS.has(s);
}

/** Whether a /compare/[slug] page should be indexed: a curated comparison not on
 *  the thin/obscure noindex list. */
export function isIndexedComparisonSlug(slug: string): boolean {
  const s = slug.toLowerCase();
  return !!comparisonBySlug(s) && !COMPARE_NOINDEX_SLUGS.has(s);
}

/* ---------- comparison lookup --------------------------------------- */

const COMPARISON_BY_SLUG: Map<string, Comparison> = (() => {
  const m = new Map<string, Comparison>();
  for (const c of COMPARISONS) m.set(comparisonSlug(c.terms), c);
  return m;
})();

export function comparisonBySlug(slug: string): Comparison | undefined {
  return COMPARISON_BY_SLUG.get(slug.toLowerCase());
}

export function allComparisonSlugs(): string[] {
  return COMPARISONS.map((c) => comparisonSlug(c.terms));
}

/* ---------- cross-linking helpers ----------------------------------- */
/* These build the internal link graph between landing pages: same-category
 * siblings, the comparisons a term appears in, and a deterministic sample of
 * other terms. Dense internal linking - not the sitemap - is what gets the
 * long-tail /trends + /compare pages discovered and ranked. */

/** The catalog group a term belongs to (first match), or undefined for terms
 *  that only exist inside a comparison pair. */
export function groupOfTerm(term: string): ExampleGroup | undefined {
  return EXAMPLE_GROUPS.find((g) => g.terms.includes(term));
}

/** A small, stable hash of a string → non-negative int, for deterministic
 *  "random" sampling that stays identical across ISR rebuilds (no Math.random,
 *  which would reshuffle links every revalidate and waste crawl signal). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministically pick up to `n` items from `pool`, seeded by `seed` so the
 *  selection is stable per page but varies across pages. */
function sampleStable<T>(pool: T[], n: number, seed: string): T[] {
  if (pool.length <= n) return [...pool];
  const scored = pool
    .map((item, i) => ({ item, k: hashStr(`${seed}:${i}:${String(item)}`) }))
    .sort((a, b) => a.k - b.k);
  return scored.slice(0, n).map((x) => x.item);
}

/** Up to `n` sibling terms from the same catalog group (excludes `term`). */
export function siblingTerms(term: string, n = 6): string[] {
  const g = groupOfTerm(term);
  if (!g) return [];
  const siblings = g.terms.filter((t) => t !== term);
  return sampleStable(siblings, n, term);
}

/** Curated comparisons that include `term`. */
export function comparisonsForTerm(term: string): Comparison[] {
  return COMPARISONS.filter((c) => c.terms.includes(term));
}

/** A deterministic sample of `n` other catalog terms, drawn from groups other
 *  than the term's own (so "More to explore" reaches across the catalog). */
export function sampleOtherTerms(term: string, n = 4): string[] {
  const ownGroup = groupOfTerm(term);
  const pool = allTrendTerms().filter(
    (t) => t !== term && !(ownGroup && ownGroup.terms.includes(t)),
  );
  return sampleStable(pool, n, `other:${term}`);
}

/** A deterministic sample of `n` other curated comparisons, excluding `slug`. */
export function sampleOtherComparisons(slug: string, n = 4): Comparison[] {
  const pool = COMPARISONS.filter((c) => comparisonSlug(c.terms) !== slug);
  return sampleStable(pool, n, `cmp:${slug}`);
}

/** The clean landing-page URL for one or more terms: a single term routes to
 *  its `/trends/[term]` page, several to the `/compare/[slug]` overlay. This is
 *  the crawlable canonical destination the gallery links to (the in-place
 *  `onPick` handler intercepts real clicks). */
export function landingHref(terms: string[]): string {
  if (terms.length === 1) return `/trends/${termToSlug(terms[0])}`;
  return `/compare/${comparisonSlug(terms)}`;
}
