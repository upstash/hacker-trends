/**
 * Shared header + footer for the static content/landing pages (`/how-it-works`,
 * `/trends/[term]`, `/compare/[slug]`). Mirrors the app's HN header bar so these
 * crawlable pages feel like the same product, and the footer cross-links them
 * (good for both users and internal-link SEO).
 */

import Link from "next/link";
import { OutboundLink } from "./OutboundLink";

export function LandingHeader({ crumb }: { crumb?: string }) {
  return (
    <div className="hn-header flex items-center gap-2 px-2 py-[3px]">
      <span className="hn-logo">T</span>
      <Link href="/" className="font-bold text-[12px]">
        Hacker Trends
      </Link>
      {crumb && (
        <span className="text-[10px] opacity-80 hidden sm:inline">| {crumb}</span>
      )}
      <div className="ml-auto flex items-center gap-3 text-[11px]">
        <Link href="/how-it-works">how it works</Link>
        <Link href="/" className="font-semibold">
          open the tool →
        </Link>
      </div>
    </div>
  );
}

export function LandingFooter() {
  return (
    <footer className="px-3 py-6 mt-8 border-t border-[color:var(--hn-subtle)]/30 text-[11px] text-[color:var(--hn-subtle)]">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/">Search &amp; compare</Link>
        <Link href="/how-it-works">How it works</Link>
        <OutboundLink
          destination="upstash"
          location="landing_footer"
          href="https://upstash.com/docs/redis/search"
        >
          Upstash Redis Search
        </OutboundLink>
        <a href="https://news.ycombinator.com" target="_blank" rel="noreferrer">
          Hacker News
        </a>
      </div>
      <p className="mt-2">
        Hacker Trends charts how often any term appears across ~45M Hacker News
        posts and comments (2007–2026). A demo built on Upstash Redis Search.
      </p>
    </footer>
  );
}
