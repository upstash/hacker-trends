/**
 * Programmatic SEO landing page: `/trends/[term]`.
 *
 * One server-rendered page per curated catalog term (and any ad-hoc term),
 * showing the real Hacker-News mention histogram, the peak month, headline
 * stats, and the top stories behind the line - all crawlable, no client JS
 * required - then a clear path into the interactive tool. These long-tail pages
 * are the bulk of the site's organic-search surface.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  abs,
  allTrendTerms,
  termToSlug,
  comparisonSlug,
  slugToTerm,
  isKnownTermSlug,
  isIndexedTermSlug,
  groupOfTerm,
  siblingTerms,
  comparisonsForTerm,
  sampleOtherTerms,
  HISTORY_FROM_YEAR,
  HISTORY_TO_YEAR,
  HISTORY_SPAN_YEARS,
} from "@/lib/site";
import { getTermLanding, trendSummary } from "@/lib/landing-data";
import { analysisForSlug } from "@/lib/trend-analysis";
import { StaticTrend } from "@/app/components/StaticTrend";
import { JsonLd } from "@/app/components/JsonLd";
import { LandingHeader, LandingFooter } from "@/app/components/LandingChrome";
import { OutboundLink } from "@/app/components/OutboundLink";

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
  const title = `“${term}” on Hacker News - ${HISTORY_SPAN_YEARS} years of mentions, charted`;
  const description = `How often "${term}" came up on Hacker News from ${HISTORY_FROM_YEAR} to ${HISTORY_TO_YEAR}: a live mention-over-time chart, the peak month, and the top stories - powered by Upstash Redis Search.`;
  const path = `/trends/${termToSlug(term)}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: isIndexedTermSlug(slug) ? undefined : { index: false, follow: true },
    openGraph: {
      title: `${display} - Hacker News trend`,
      description,
      url: path,
      type: "article",
    },
    twitter: { title: `${display} - Hacker News trend`, description },
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
  const slugForTerm = termToSlug(term);
  const path = `/trends/${slugForTerm}`;
  const compareHref = `/?q=${encodeURIComponent(term)}`;

  // Lead-with-the-answer summary + (for top terms) model-authored analysis.
  const summary = trendSummary(term, stats);
  const analysis = analysisForSlug(slugForTerm);

  // Cross-links that wire this page into the rest of the catalog: comparisons
  // it appears in, its same-category siblings, and a sample reaching elsewhere.
  const group = groupOfTerm(term);
  const relatedComparisons = comparisonsForTerm(term);
  const siblings = siblingTerms(term, 6);
  const others = sampleOtherTerms(term, 4);

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
        {/* Lead with the answer: the headline numbers in one plain sentence, the
            line a featured snippet or an AI answer can lift verbatim. */}
        <p className="text-[14px] mt-2 max-w-[760px] leading-relaxed font-medium">
          {summary}
        </p>
        <p className="text-[12px] text-[color:var(--hn-subtle)] mt-2 max-w-[760px] leading-relaxed">
          Every month from {HISTORY_FROM_YEAR} to {HISTORY_TO_YEAR}, counting how
          often “{term}” appears in Hacker News stories and comments. Each point
          is a live date-histogram over ~45M items, computed with{" "}
          <OutboundLink
            destination="upstash"
            location="trends_page"
            href="https://upstash.com/docs/redis/search"
            className="text-[color:var(--hn-orange)]"
          >
            Upstash Redis Search
          </OutboundLink>
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
            Explore “{term}” in the interactive tool - filter by date, sort, and
            compare against other terms →
          </Link>
        </div>
      </div>

      {/* analysis - model-authored prose for the top terms; the unique,
          non-templated content that makes this page worth indexing on its own */}
      {analysis && analysis.paragraphs.length > 0 && (
        <div className="px-3 pt-6">
          <h2 className="text-[14px] font-bold">What the chart shows</h2>
          <div className="mt-1 max-w-[760px] space-y-2">
            {analysis.paragraphs.map((p, i) => (
              <p key={i} className="text-[13px] leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        </div>
      )}

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

      {/* related - wire this page into the catalog's link graph: comparisons it
          appears in, same-category siblings, and a few picks from elsewhere.
          Dense internal linking is what gets these long-tail pages crawled and
          ranked, so every link is a real <a href> to a clean landing URL. */}
      <div className="px-3 pt-6">
        <h2 className="text-[14px] font-bold">More to explore</h2>

        {relatedComparisons.length > 0 && (
          <div className="mt-2">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--hn-subtle)]">
              “{term}” head-to-head
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {relatedComparisons.map((c) => (
                <li key={comparisonSlug(c.terms)}>
                  <Link
                    href={`/compare/${comparisonSlug(c.terms)}`}
                    className="text-[color:var(--hn-orange)]"
                  >
                    {c.terms.join(" vs ")} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {siblings.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--hn-subtle)]">
              {group ? `More from ${group.title}` : "Related terms"}
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {siblings.map((t) => (
                <li key={t}>
                  <Link href={`/trends/${termToSlug(t)}`} className="text-[color:var(--hn-orange)]">
                    {t}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {others.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--hn-subtle)]">
              Elsewhere on Hacker Trends
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {others.map((t) => (
                <li key={t}>
                  <Link href={`/trends/${termToSlug(t)}`} className="text-[color:var(--hn-orange)]">
                    {t}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[12px] mt-4">
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
