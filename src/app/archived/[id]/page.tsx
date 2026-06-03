/**
 * Archived item view: `/archived/<id>`.
 *
 * HN hides comments/stories that get flagged, killed, or deleted after we
 * indexed them — but the Algolia HN Search archive still mirrors the content.
 * This route renders that archived item (and its reply tree) in the app's HN
 * visual style, so the "archived ›" links in the results stay readable instead
 * of dumping raw JSON.
 *
 * Fetch happens client-side against the open-CORS Algolia API; the page itself
 * is just a server shell so the [id] param resolves cleanly.
 */

import type { Metadata } from "next";
import { ArchivedItem } from "./ArchivedItem";

export const dynamic = "force-dynamic";

// Thin, third-party-mirrored content (Algolia's HN archive). Keep it usable for
// people following an "archived ›" link, but out of the search index.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ArchivedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ArchivedItem id={id} />;
}
