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
import { HackerTrends } from "./HackerTrends";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hacker Trends: 18 years of Hacker News, charted",
  description:
    "Overlay any topics, tools, or people and see how their traction rose and fell across 18 years of Hacker News: live date-histograms over 45M posts and comments. Powered by Upstash Redis Search.",
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

  const examplesData = await getExamplesData();

  return (
    <HackerTrends initial={parseShareState(sp)} examplesData={examplesData} />
  );
}
