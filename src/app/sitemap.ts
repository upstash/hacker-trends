import type { MetadataRoute } from "next";
import {
  SITE_URL,
  abs,
  allTrendTerms,
  termToSlug,
  termTier,
  allComparisonSlugs,
  isIndexedTermSlug,
  isIndexedComparisonSlug,
  CONTENT_UPDATED,
} from "@/lib/site";

// Only indexed pages belong in the sitemap. Tier-3 trend terms and the
// thin/obscure comparisons are noindex,follow — still crawlable via internal
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

  return [...core, ...comparisons, ...trends];
}
