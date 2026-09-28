/**
 * The "Who is hiring?" job-trends hub at `/who-is-hiring`.
 *
 * Server shell: it owns the keyword-led <title>/meta/canonical (so the page is
 * rankable) and hands off to the <WhoIsHiringSearch/> client component, which
 * holds all the interactive state (compare chips, the per-month stacked chart,
 * the comment drill-down, and the two galleries). It fetches nothing and reads
 * no request data, so the page is fully STATIC (CDN-served): the chart and
 * galleries fetch job-scoped data on the client after paint, and a shared
 * `?q=` comparison is read client-side.
 */

import { jobsMetadata } from "./_seo/meta";
import { WhoIsHiringSearch } from "./WhoIsHiringSearch";

// Lead the <title> with the exact thing people search ("Who is hiring") plus the
// recurring HN phrase, then "job trends / search" for the long tail. title.absolute
// bypasses the layout's "%s · Hacker Trends" template so the brand tail doesn't
// crowd out the keyword head on this hub page.
const HUB_TITLE =
  "Who Is Hiring? Hacker News Job Trends - Search & Compare Skills Over Time";

const HUB_DESCRIPTION =
  "Chart how often any skill, tool, or work-style appears in Hacker News 'Who is hiring?' posts since 2011. Compare languages and frameworks and read the real postings.";

export const metadata = jobsMetadata({
  title: HUB_TITLE,
  description: HUB_DESCRIPTION,
  path: "/who-is-hiring",
  type: "website",
});

export default function WhoIsHiringHubPage() {
  return <WhoIsHiringSearch />;
}
