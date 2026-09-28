/**
 * Slug <-> terms for `/who-is-hiring/compare/[slug]`, shared by the page and its
 * social card.
 */

import { comparisonSlug, slugToTerm } from "@/lib/site";
import {
  hasCuratedJobsComparison,
  isJobsLandingTerm,
  jobsDisplayTerm,
} from "@/lib/jobs-seo";
import { COMPARISONS } from "@/lib/jobs-gallery";
import { MAX_SERIES } from "@/lib/jobs-trends";

/** Resolve a slug to its ordered series list, or null (404). A curated gallery
 *  comparison keeps its OR-group series; any other slug is split on `-vs-` and
 *  must name 2..MAX_SERIES distinct landing terms (so random slugs can't mint
 *  new ISR pages). Curated-copy slugs are always allowed. */
export function termsForSlug(slug: string): string[] | null {
  const curated = COMPARISONS.find((c) => comparisonSlug(c.terms) === slug);
  if (curated) return curated.terms;
  const terms = [...new Set(slug.split("-vs-").map((p) => slugToTerm(p)).filter(Boolean))];
  if (terms.length < 2 || terms.length > MAX_SERIES) return null;
  if (hasCuratedJobsComparison(slug)) return terms;
  return terms.every(isJobsLandingTerm) ? terms : null;
}

/** Display label for one series string: capitalized, with an OR-group collapsed
 *  to its parts joined by " / " ("ai|ml|llm" reads "AI / ML / LLM"). */
export function seriesLabel(s: string): string {
  return s.includes("|")
    ? s.split("|").map((p) => jobsDisplayTerm(p.trim())).join(" / ")
    : jobsDisplayTerm(s);
}
