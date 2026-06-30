/**
 * Prominent "this is built on Upstash Redis Search" callout for the organic
 * landing pages (/trends, /compare, /who-is-hiring/*). Those pages pull the bulk
 * of the site's search traffic, and turning that reader into an Upstash docs /
 * repo click is the entire point of this demo - so the pitch gets a real
 * bordered callout with two clear CTAs, not just a faint footer link.
 *
 * Pure server component; the click tracking rides on <OutboundLink/>. Pass a
 * page-specific `location` so GA can attribute conversions per surface.
 */

import { OutboundLink } from "./OutboundLink";

export function RedisSearchCTA({
  location,
  subject = "This chart",
}: {
  location: string;
  /** What "is a single Redis Search query" - e.g. "This chart", "This comparison". */
  subject?: string;
}) {
  return (
    <aside className="mx-3 mt-6 rounded border border-[color:var(--hn-orange)]/40 bg-[color:var(--hn-orange)]/5 px-4 py-3">
      <div className="text-[13px] font-bold">Built on Upstash Redis Search</div>
      <p className="text-[12px] text-[color:var(--hn-subtle)] mt-1 max-w-[680px] leading-relaxed">
        {subject} is a single Redis Search query over ~45M Hacker News posts and
        comments. No separate search cluster, no extra service to run, just the
        Redis you already have. See exactly how it works:
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] font-semibold">
        <OutboundLink
          destination="upstash"
          location={location}
          href="https://upstash.com/docs/redis/search"
          className="inline-flex items-center gap-1 rounded bg-[color:var(--hn-orange)] px-3 py-1.5 text-white shadow-sm hover:brightness-95"
        >
          Read the Upstash Redis Search docs
          <span aria-hidden className="leading-none">
            →
          </span>
        </OutboundLink>
        <OutboundLink
          destination="github"
          location={location}
          href="https://github.com/upstash/hacker-trends"
          className="inline-flex items-center gap-1 text-[color:var(--hn-orange)] hover:underline"
        >
          View the source on GitHub
          <span aria-hidden className="leading-none">
            →
          </span>
        </OutboundLink>
      </div>
    </aside>
  );
}
