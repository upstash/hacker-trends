import { slugToTerm } from "@/lib/site";
import { isJobsLandingTerm } from "@/lib/jobs-seo";
import { normalizeSeries } from "@/lib/jobs-trends";

/** The page's term for a slug, or null when no page exists for it. */
export function termFor(slug: string): string | null {
  const term = normalizeSeries(slugToTerm(slug));
  return term && isJobsLandingTerm(term) ? term : null;
}
