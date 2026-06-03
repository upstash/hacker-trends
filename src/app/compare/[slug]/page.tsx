/**
 * Programmatic SEO landing page: `/compare/[slug]` (e.g. `openai-vs-anthropic`).
 *
 * One page per curated comparison from the catalog (and any ad-hoc `a-vs-b`
 * slug): overlaid mention-over-time lines, the narrative of how the lead
 * changes hands, per-term stats, and a link straight into the interactive
 * overlay. Targets the high-intent "X vs Y" long-tail.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  abs,
  comparisonSlug,
  comparisonBySlug,
  allComparisonSlugs,
  slugToTerm,
  HISTORY_FROM_YEAR,
  HISTORY_TO_YEAR,
} from "@/lib/site";
import { getComparisonLanding } from "@/lib/landing-data";
import { StaticTrend } from "@/app/components/StaticTrend";
import { JsonLd } from "@/app/components/JsonLd";
import { LandingHeader, LandingFooter } from "@/app/components/LandingChrome";

export const revalidate = 86400;
export const dynamicParams = true;

const COMPARE_COLORS = ["#1f6feb", "#ff6600", "#1a7f37", "#cf222e", "#8250df"];

export function generateStaticParams() {
  return allComparisonSlugs().map((slug) => ({ slug }));
}

/** Resolve a slug to its ordered term list: a curated comparison if known, else
 *  split an ad-hoc `a-vs-b-vs-c` slug and de-slug each part. */
function termsForSlug(slug: string): string[] {
  const curated = comparisonBySlug(slug);
  if (curated) return curated.terms;
  return slug
    .split("-vs-")
    .map((p) => slugToTerm(p))
    .filter(Boolean);
}

function joinTerms(terms: string[]): string {
  return terms.join(" vs ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const terms = termsForSlug(slug);
  if (terms.length < 2) return {};
  const known = !!comparisonBySlug(slug);
  const label = joinTerms(terms);
  const title = `${label} on Hacker News — popularity over time, compared`;
  const description = `${label}: how each trended across ${HISTORY_FROM_YEAR}–${HISTORY_TO_YEAR} of Hacker News mentions, overlaid on one chart. See when the lead changed hands. Powered by Upstash Redis Search.`;
  const path = `/compare/${comparisonSlug(terms)}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: known ? undefined : { index: false, follow: true },
    openGraph: { title: `${label} — Hacker News trends`, description, url: path, type: "article" },
    twitter: { title: `${label} — Hacker News trends`, description },
  };
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const terms = termsForSlug(slug);
  if (terms.length < 2) notFound();

  const curated = comparisonBySlug(slug);
  const { series } = await getComparisonLanding(terms);

  const total = series.reduce((n, s) => n + s.stats.total, 0);
  if (total === 0) notFound();

  const colored = series.map((s, i) => ({
    ...s,
    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
  }));
  const label = joinTerms(terms);
  const path = `/compare/${comparisonSlug(terms)}`;
  const compareHref = `/?${terms.map((t) => `q=${encodeURIComponent(t)}`).join("&")}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Hacker Trends", item: abs("/") },
      { "@type": "ListItem", position: 2, name: label, item: abs(path) },
    ],
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      <JsonLd data={jsonLd} />
      <LandingHeader crumb={`${label} on Hacker News`} />

      <div className="px-3 pt-4">
        <p className="text-[11px] text-[color:var(--hn-subtle)] mb-1">
          <Link href="/">Hacker Trends</Link> › <span>{label}</span>
        </p>
        <h1 className="text-[20px] font-bold leading-tight">
          {colored.map((s, i) => (
            <span key={s.term}>
              {i > 0 && (
                <span className="text-[color:var(--hn-subtle)] font-normal">
                  {" "}
                  vs{" "}
                </span>
              )}
              <span style={{ color: s.color }}>{s.term}</span>
            </span>
          ))}
          <span className="font-normal"> on Hacker News</span>
        </h1>
        <p className="text-[12px] text-[color:var(--hn-subtle)] mt-1 max-w-[760px] leading-relaxed">
          Mention-over-time for {label}, overlaid across {HISTORY_FROM_YEAR}–
          {HISTORY_TO_YEAR} of Hacker News. Each line is a live date-histogram
          over ~45M posts and comments, computed with{" "}
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

      {/* legend */}
      <div className="px-3 pt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
        {colored.map((s) => (
          <span key={s.term} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm flex-none"
              style={{ background: s.color }}
            />
            <span className="font-semibold">{s.term}</span>
            <span className="text-[color:var(--hn-subtle)]">
              {s.stats.total.toLocaleString()} mentions
              {s.stats.peakLabel ? `, peak ${s.stats.peakLabel}` : ""}
            </span>
          </span>
        ))}
      </div>

      {/* chart */}
      <div className="px-3 pt-4">
        <div className="border border-[color:var(--hn-subtle)]/30 rounded bg-white p-2">
          <StaticTrend series={colored} />
        </div>
        <div className="mt-2">
          <Link
            href={compareHref}
            className="inline-block text-[12px] font-semibold text-[color:var(--hn-orange)]"
          >
            Open this comparison in the interactive tool — zoom to any date range
            and read the stories behind each spike →
          </Link>
        </div>
      </div>

      {/* the story */}
      {curated?.story && (
        <div className="px-3 pt-6">
          <h2 className="text-[14px] font-bold">How the lead changed hands</h2>
          <p className="text-[13px] mt-1 max-w-[760px] leading-relaxed">
            {curated.story}
          </p>
        </div>
      )}

      {/* per-term deep links */}
      <div className="px-3 pt-6">
        <h2 className="text-[14px] font-bold">Each term on its own</h2>
        <ul className="mt-2 space-y-1 text-[13px]">
          {colored.map((s) => (
            <li key={s.term}>
              <Link
                href={`/trends/${comparisonSlug([s.term])}`}
                style={{ color: s.color }}
                className="font-semibold"
              >
                How “{s.term}” trended on Hacker News →
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-3 pt-6">
        <p className="text-[12px]">
          <Link href="/" className="text-[color:var(--hn-orange)]">
            Build your own comparison
          </Link>{" "}
          on the main chart, or read{" "}
          <Link href="/how-it-works">how Hacker Trends works</Link>.
        </p>
      </div>

      <LandingFooter />
    </div>
  );
}
