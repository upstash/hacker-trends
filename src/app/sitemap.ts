import type { MetadataRoute } from "next";
import {
  SITE_URL,
  abs,
  allTrendTerms,
  termToSlug,
  allComparisonSlugs,
} from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const core: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified, changeFrequency: "daily", priority: 1 },
    { url: abs("/how-it-works"), lastModified, changeFrequency: "monthly", priority: 0.8 },
  ];

  const comparisons: MetadataRoute.Sitemap = allComparisonSlugs().map((slug) => ({
    url: abs(`/compare/${slug}`),
    lastModified,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const trends: MetadataRoute.Sitemap = allTrendTerms().map((term) => ({
    url: abs(`/trends/${termToSlug(term)}`),
    lastModified,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...core, ...comparisons, ...trends];
}
