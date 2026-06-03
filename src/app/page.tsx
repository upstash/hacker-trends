/**
 * Root route: the whole app on one page.
 *
 * This server shell does two things and hands off to the client:
 *   1. parses the incoming `?…` into seed state (so a shared link renders the
 *      right view with no hydration flash), and
 *   2. fetches the trend gallery's data once from a single cached Redis key
 *      (see examples-data.ts) and passes it down, so the "example queries"
 *      gallery at the bottom of the page costs one cache read, not ~190 live
 *      queries.
 *
 * Everything interactive — the compare/search tool AND the embedded gallery —
 * lives in <HackerTrends/>, so clicking an example swaps the query in place
 * instead of navigating.
 */

import type { Metadata } from "next";
import { parseShareState } from "@/lib/share-url";
import { getExamplesData } from "@/lib/examples-data";
import { encodeExamplesWire } from "@/lib/examples-wire";
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

  // Ship the gallery histograms to the client in a compact slot-indexed form
  // (see examples-wire.ts) — the verbose {key, docCount} objects pushed the
  // RSC payload past 8 MB; the wire form is ~10× smaller.
  const examplesData = encodeExamplesWire(await getExamplesData());

  return (
    <HackerTrends initial={parseShareState(sp)} examplesData={examplesData} />
  );
}
