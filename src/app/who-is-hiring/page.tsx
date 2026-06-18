/**
 * The "Who is hiring?" job-trends hub at `/who-is-hiring`.
 *
 * Server shell: it owns the keyword-led <title>/meta/canonical (so the page is
 * rankable) and hands off to the <WhoIsHiringSearch/> client component, which
 * holds all the interactive state (compare chips, the per-month stacked chart,
 * the comment drill-down, and the two galleries). Like the homepage shell it
 * does NOT fetch anything here - the chart and galleries fetch live job-scoped
 * data on the client after paint, so first paint isn't blocked on a Redis read.
 */

import type { Metadata } from "next";
import { SITE_NAME, abs } from "@/lib/site";
import { WhoIsHiringSearch } from "./WhoIsHiringSearch";

export const dynamic = "force-dynamic";

// Lead the <title> with the exact thing people search ("Who is hiring") plus the
// recurring HN phrase, then "job trends / search" for the long tail. title.absolute
// bypasses the layout's "%s · Hacker Trends" template so the brand tail doesn't
// crowd out the keyword head on this hub page.
const HUB_TITLE =
  "Who Is Hiring? Hacker News Job Trends - Search & Compare Skills Over Time";

const HUB_DESCRIPTION =
  "Chart how often any skill, tool, or work-style appears in Hacker News 'Who is hiring?' posts since 2011. Compare languages and frameworks and read the real postings.";

export const metadata: Metadata = {
  title: { absolute: HUB_TITLE },
  description: HUB_DESCRIPTION,
  alternates: { canonical: abs("/who-is-hiring") },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: HUB_TITLE,
    description: HUB_DESCRIPTION,
    url: abs("/who-is-hiring"),
  },
};

export default function WhoIsHiringHubPage() {
  return <WhoIsHiringSearch />;
}
