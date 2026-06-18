import type { MetadataRoute } from "next";
import {
  SITE_URL,
  abs,
  allTrendTerms,
  termToSlug,
  comparisonSlug,
  termTier,
  allComparisonSlugs,
  isIndexedTermSlug,
  isIndexedComparisonSlug,
  CONTENT_UPDATED,
} from "@/lib/site";
import {
  curatedJobsTermSlugs,
  curatedJobsComparisonSlugs,
  allJobsCategorySlugs,
} from "@/lib/jobs-seo";
import { comparisonTermSets } from "@/lib/jobs-gallery";

// Only indexed pages belong in the sitemap. Tier-3 trend terms and the
// thin/obscure comparisons are noindex,follow - still crawlable via internal
// links, but kept out of the sitemap so they don't dilute the indexed set.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = CONTENT_UPDATED;

  const core: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified, changeFrequency: "daily", priority: 1 },
    { url: abs("/how-it-works"), lastModified, changeFrequency: "monthly", priority: 0.8 },
  ];

  const comparisons: MetadataRoute.Sitemap = allComparisonSlugs()
    .filter((slug) => isIndexedComparisonSlug(slug))
    .map((slug) => ({
      url: abs(`/compare/${slug}`),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.7,
    }));

  const trends: MetadataRoute.Sitemap = allTrendTerms()
    .filter((term) => isIndexedTermSlug(termToSlug(term)))
    .map((term) => ({
      url: abs(`/trends/${termToSlug(term)}`),
      lastModified,
      changeFrequency: "weekly",
      // Tier 1 (custom analysis) ranks above the templated Tier 2 long tail.
      priority: termTier(term) === 1 ? 0.7 : 0.6,
    }));

  // The "Who is hiring?" hub + its programmatic landing routes. Only the curated
  // pages (bespoke copy) are indexed + listed here; templated terms/comparisons
  // stay noindex,follow (crawlable via internal links, not in the sitemap).
  const jobsHub: MetadataRoute.Sitemap = [
    { url: abs("/who-is-hiring"), lastModified, changeFrequency: "daily", priority: 0.9 },
  ];

  const jobsTerms: MetadataRoute.Sitemap = curatedJobsTermSlugs().map((slug) => ({
    url: abs(`/who-is-hiring/${slug}`),
    lastModified,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  // Curated comparison copy + every gallery head-to-head (the gallery stories
  // are the canonical comparison pages even when they use the keyword template).
  const jobsComparisonSlugs = new Set<string>([
    ...curatedJobsComparisonSlugs(),
    ...comparisonTermSets().map((terms) => comparisonSlug(terms)),
  ]);
  const jobsComparisons: MetadataRoute.Sitemap = [...jobsComparisonSlugs].map(
    (slug) => ({
      url: abs(`/who-is-hiring/compare/${slug}`),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.7,
    }),
  );

  // The "Top N <category>" question pages (`/who-is-hiring/top/<slug>`). Every
  // category card is curated (bespoke question copy), so all are indexed.
  const jobsCategories: MetadataRoute.Sitemap = allJobsCategorySlugs().map(
    (slug) => ({
      url: abs(`/who-is-hiring/top/${slug}`),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.7,
    }),
  );

  return [
    ...core,
    ...comparisons,
    ...trends,
    ...jobsHub,
    ...jobsTerms,
    ...jobsComparisons,
    ...jobsCategories,
  ];
}
