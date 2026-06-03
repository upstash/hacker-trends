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

import { COMPARISONS, EXAMPLE_GROUPS, type Comparison } from "./examples";

/** Canonical production origin (no trailing slash). */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://hackernewstrends.com"
).replace(/\/$/, "");

export const SITE_NAME = "Hacker Trends";

/** The descriptive one-liner used for og:title / social cards (NOT the browser
 *  tab title — that stays the short brand name, per design). */
export const SITE_TAGLINE = "18 years of Hacker News, charted";

export const SITE_DESCRIPTION =
  "Overlay any topics, tools, or people and see how their traction rose and fell across 18 years of Hacker News: live date-histograms over 45M posts and comments. Powered by Upstash Redis Search.";

/** First indexed month and last, kept in sync with trend-time.ts (2007 → 2026). */
export const HISTORY_FROM_YEAR = 2007;
export const HISTORY_TO_YEAR = 2026;
/** The span as stated in all brand copy ("18 years of Hacker News"). Pinned,
 *  not computed, so it stays consistent with the tagline (2026−2007 elapsed). */
export const HISTORY_SPAN_YEARS = 18;

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
