/**
 * Programmatic SEO landing page: `/trends/[term]`.
 *
 * One server-rendered page per curated catalog term (and any ad-hoc term),
 * showing the real Hacker-News mention histogram, the peak month, headline
 * stats, and the top stories behind the line — all crawlable, no client JS
 * required — then a clear path into the interactive tool. These long-tail pages
 * are the bulk of the site's organic-search surface.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  SITE_NAME,
  abs,
  allTrendTerms,
  termToSlug,
  slugToTerm,
  isKnownTermSlug,
  HISTORY_FROM_YEAR,
  HISTORY_TO_YEAR,
  HISTORY_SPAN_YEARS,
} from "@/lib/site";
import { getTermLanding } from "@/lib/landing-data";
import { StaticTrend } from "@/app/components/StaticTrend";
import { JsonLd } from "@/app/components/JsonLd";
import { LandingHeader, LandingFooter } from "@/app/components/LandingChrome";

// ISR: built once, refreshed daily. Catalog terms are prebuilt; anything else
// renders on demand and is then cached.
export const revalidate = 86400;
export const dynamicParams = true;

export function generateStaticParams() {
  return allTrendTerms().map((term) => ({ term: termToSlug(term) }));
}

function titleCase(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ term: string }>;
}): Promise<Metadata> {
  const { term: slug } = await params;
  const term = slugToTerm(slug);
  const display = titleCase(term);
  const title = `“${term}” on Hacker News — ${HISTORY_SPAN_YEARS} years of mentions, charted`;
  const description = `How often "${term}" came up on Hacker News from ${HISTORY_FROM_YEAR} to ${HISTORY_TO_YEAR}: a live mention-over-time chart, the peak month, and the top stories — powered by Upstash Redis Search.`;
  const path = `/trends/${termToSlug(term)}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: isKnownTermSlug(slug) ? undefined : { index: false, follow: true },
    openGraph: {
      title: `${display} — Hacker News trend`,
      description,
      url: path,
      type: "article",
    },
    twitter: { title: `${display} — Hacker News trend`, description },
  };
}

export default async function TrendPage({
  params,
}: {
  params: Promise<{ term: string }>;
}) {
  const { term: slug } = await params;
  const term = slugToTerm(slug);
  const { buckets, stats, stories } = await getTermLanding(term);

  // An off-catalog term with literally no mentions isn't worth an indexable
  // page; send it to the live tool instead of rendering an empty chart.
  if (stats.total === 0 && !isKnownTermSlug(slug)) notFound();

  const display = titleCase(term);
  const path = `/trends/${termToSlug(term)}`;
  const compareHref = `/?q=${encodeURIComponent(term)}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Hacker Trends", item: abs("/") },
          { "@type": "ListItem", position: 2, name: display, item: abs(path) },
        ],
      },
      {
        "@type": "Dataset",
        name: `"${term}" mentions on Hacker News over time`,
        description: `Monthly count of Hacker News posts and comments mentioning "${term}", ${HISTORY_FROM_YEAR}–${HISTORY_TO_YEAR}.`,
        url: abs(path),
        creator: { "@type": "Organization", name: "Upstash", url: "https://upstash.com" },
        temporalCoverage: `${HISTORY_FROM_YEAR}/${HISTORY_TO_YEAR}`,
        isAccessibleForFree: true,
      },
    ],
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      <JsonLd data={jsonLd} />
      <LandingHeader crumb={`“${term}” on Hacker News`} />

      <div className="px-3 pt-4">
        <p className="text-[11px] text-[color:var(--hn-subtle)] mb-1">
          <Link href="/">Hacker Trends</Link> ›{" "}
          <span>“{term}” trend</span>
        </p>
        <h1 className="text-[20px] font-bold leading-tight">
          How “{term}” trended on Hacker News
        </h1>
        <p className="text-[12px] text-[color:var(--hn-subtle)] mt-1 max-w-[760px] leading-relaxed">
          Every month from {HISTORY_FROM_YEAR} to {HISTORY_TO_YEAR}, counting how
          often “{term}” appears in Hacker News stories and comments. Each point
          is a live date-histogram over ~45M items, computed with{" "}
          <a
            href="https://upstash.com/docs/redis/search"
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--hn-orange)]"
          >
            Upstash Redis Search
          </a>
          .
        </p>
      </div>

      {/* stat strip */}
      <div className="px-3 pt-4 flex flex-wrap gap-x-8 gap-y-2 text-[12px]">
        <Stat label="Total mentions" value={stats.total.toLocaleString()} />
        {stats.peakLabel && (
          <Stat
            label="Peak month"
            value={`${stats.peakLabel} (${stats.peakCount.toLocaleString()})`}
          />
        )}
        {stats.firstYear && (
          <Stat label="First seen" value={String(stats.firstYear)} />
        )}
      </div>

      {/* chart */}
      <div className="px-3 pt-4">
        <div className="border border-[color:var(--hn-subtle)]/30 rounded bg-white p-2">
          <StaticTrend series={[{ term, color: "#ff6600", buckets }]} />
        </div>
        <div className="mt-2">
          <Link
            href={compareHref}
            className="inline-block text-[12px] font-semibold text-[color:var(--hn-orange)]"
          >
            Explore “{term}” in the interactive tool — filter by date, sort, and
            compare against other terms →
          </Link>
        </div>
      </div>

      {/* top stories */}
      {stories.length > 0 && (
        <div className="px-3 pt-6">
          <h2 className="text-[14px] font-bold">
            Top Hacker News stories about “{term}”
          </h2>
          <ol className="mt-2 space-y-2">
            {stories.map((s, i) => {
              const hnUrl = `https://news.ycombinator.com/item?id=${s.id}`;
              const year = s.time ? new Date(s.time).getUTCFullYear() : "";
              return (
                <li key={s.id} className="text-[13px] leading-snug flex gap-2">
                  <span className="text-[color:var(--hn-subtle)] tabular-nums w-5 flex-none text-right">
                    {i + 1}.
                  </span>
                  <span>
                    <a
                      href={s.url || hnUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium"
                    >
                      {s.title}
                    </a>{" "}
                    <span className="text-[color:var(--hn-subtle)] text-[11px]">
                      {s.score.toLocaleString()} points · {Number(s.ndesc || 0).toLocaleString()} comments · {year} ·{" "}
                      <a href={hnUrl} target="_blank" rel="noreferrer" className="subtle">
                        discuss on HN
                      </a>
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* related */}
      <div className="px-3 pt-6">
        <h2 className="text-[14px] font-bold">More to explore</h2>
        <p className="text-[12px] mt-1">
          <Link href="/" className="text-[color:var(--hn-orange)]">
            Compare “{term}” with anything else
          </Link>{" "}
          on the main chart, or see{" "}
          <Link href="/how-it-works">how Hacker Trends works</Link>.
        </p>
      </div>

      <LandingFooter />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[color:var(--hn-subtle)]">
        {label}
      </div>
      <div className="text-[15px] font-bold tabular-nums">{value}</div>
    </div>
  );
}
