/**
 * Root route: the whole app on one page.
 *
 * This server shell just parses the incoming `?…` into seed state (so a shared
 * link renders the right view with no hydration flash) and hands off to the
 * client. It deliberately does NOT fetch the gallery histograms: that used to
 * be an `await getExamplesData()` here, which blocked first paint on a multi-MB
 * Redis read and was the page's LCP bottleneck (~2.6s). The gallery's text and
 * links come from the static catalog (so SEO is unaffected), and the client
 * fetches the histogram data from the CDN-cached `/examples.json` AFTER paint.
 *
 * Everything interactive — the compare/search tool AND the embedded gallery —
 * lives in <HackerTrends/>, so clicking an example swaps the query in place
 * instead of navigating.
 */

import type { Metadata } from "next";
import { parseShareState } from "@/lib/share-url";
import { SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION } from "@/lib/site";
import { HackerTrends } from "./HackerTrends";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Tab title is intentionally just the brand name (title.absolute bypasses the
  // layout's "%s · Hacker Trends" template). The descriptive, keyword-rich
  // phrasing search engines and social cards use lives in description/openGraph.
  title: { absolute: SITE_NAME },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    // A page-level openGraph block fully replaces the layout's (Next doesn't
    // deep-merge it), so restate type/siteName here or they'd vanish from the
    // homepage's tags.
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME}: ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: "/",
  },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else if (v !== undefined) sp.append(k, v);
  }

  return <HackerTrends initial={parseShareState(sp)} />;
}
