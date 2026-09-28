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
 * Everything interactive - the compare/search tool AND the embedded gallery -
 * lives in <HackerTrends/>, so clicking an example swaps the query in place
 * instead of navigating.
 */

import type { Metadata } from "next";
import { parseShareState } from "@/lib/share-url";
import {
  SITE_NAME,
  SITE_TAGLINE,
  SITE_DESCRIPTION,
  HOME_TITLE,
  DEFAULT_OG_IMAGE,
  OG_BASE,
  TWITTER_BASE,
  comparisonSlug,
  termToSlug,
} from "@/lib/site";
import { HackerTrends } from "./HackerTrends";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Dynamic only because it reads `?q=`; the render touches no database (the
// gallery and chart data are fetched client-side from `/examples.json`).
export const dynamic = "force-dynamic";

async function toParams(searchParams: SearchParams): Promise<URLSearchParams> {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else if (v !== undefined) sp.append(k, v);
  }
  return sp;
}

/** Homepage metadata. A shared `/?q=a&q=b` link gets a card for those terms
 *  (the matching /trends or /compare OG image); canonical stays "/". */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const sp = await toParams(searchParams);
  const terms = sp.has("q") ? parseShareState(sp).terms : [];
  const slug = terms.length > 1 ? comparisonSlug(terms) : termToSlug(terms[0] ?? "");
  // Homepage title carries the "Hacker News" keyword (HOME_TITLE) so the page it
  // ranks for ("hacker news trends") is reinforced by the title, not just the
  // exact-match domain. title.absolute bypasses the layout's "%s · Hacker Trends"
  // template; child routes still use the bare SITE_NAME brand in that template.
  if (!slug) {
    return {
      title: { absolute: HOME_TITLE },
      description: SITE_DESCRIPTION,
      alternates: { canonical: "/" },
      openGraph: {
        ...OG_BASE,
        title: `${SITE_NAME}: ${SITE_TAGLINE}`,
        description: SITE_DESCRIPTION,
        url: "/",
        images: [DEFAULT_OG_IMAGE],
      },
    };
  }
  const label = terms.join(" vs ");
  const title = `${label} on Hacker News`;
  const description = `How often ${label} came up on Hacker News, month by month since 2007.`;
  const image = {
    url: `/${terms.length > 1 ? "compare" : "trends"}/${slug}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: title,
  };
  return {
    title: { absolute: `${title} · ${SITE_NAME}` },
    description,
    alternates: { canonical: "/" },
    openGraph: { ...OG_BASE, title, description, url: "/", images: [image] },
    twitter: { ...TWITTER_BASE, title, description, images: [image.url] },
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return <HackerTrends initial={parseShareState(await toParams(searchParams))} />;
}
