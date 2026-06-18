/**
 * Shared header + footer for the "Who is hiring?" programmatic landing routes
 * (`/who-is-hiring/[term]` and `/who-is-hiring/compare/[slug]`).
 *
 * Mirrors the hub's orange HN header (the "W" wordmark linking back to the hub)
 * so the crawlable landing pages feel like the same product, and cross-links the
 * hub + the main all-of-HN tool in the footer (good for users and internal-link
 * SEO). Pure server component - no client JS.
 */

import Link from "next/link";

export function JobsLandingHeader({ crumb }: { crumb?: string }) {
  return (
    <div className="hn-header flex items-center gap-2 px-2 py-[3px]">
      <span className="hn-logo">W</span>
      <Link href="/who-is-hiring" className="font-bold text-[12px]">
        Who Is Hiring? Search
      </Link>
      {crumb && (
        <span className="text-[10px] opacity-80 hidden sm:inline">| {crumb}</span>
      )}
      <div className="ml-auto flex items-center gap-3 text-[11px]">
        <Link href="/who-is-hiring" className="font-semibold whitespace-nowrap">
          open the tool →
        </Link>
      </div>
    </div>
  );
}

/**
 * A big, hard-to-miss call-to-action that drops the reader into the interactive
 * `/who-is-hiring` search tool. The landing pages are mostly read-only SEO copy,
 * so this is the clear "go play with it yourself" affordance - a real button,
 * not a faint header link.
 */
export function JobsToolCta({
  label = "Search & compare any skill in the Who Is Hiring? tool",
}: {
  label?: string;
}) {
  return (
    <div className="px-3 pt-4">
      <Link
        href="/who-is-hiring"
        className="inline-flex items-center gap-2 rounded bg-[color:var(--hn-orange)] px-4 py-2.5 text-[13px] font-bold text-white shadow-sm hover:brightness-95"
      >
        {label}
        <span aria-hidden className="text-[15px] leading-none">
          →
        </span>
      </Link>
    </div>
  );
}

export function JobsLandingFooter() {
  return (
    <footer className="px-3 py-6 mt-8 border-t border-[color:var(--hn-subtle)]/30 text-[11px] text-[color:var(--hn-subtle)]">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/who-is-hiring">Who Is Hiring? Search</Link>
        <Link href="/">Search all of Hacker News</Link>
        <a
          href="https://news.ycombinator.com/submitted?id=whoishiring"
          target="_blank"
          rel="noreferrer"
        >
          The “Who is hiring?” threads
        </a>
      </div>
      <p className="mt-2">
        Charts how often any skill, tool or work-style appears in the monthly
        Hacker News “Who is hiring?” thread (2011 onward). A demo built on Upstash
        Redis Search.
      </p>
    </footer>
  );
}
