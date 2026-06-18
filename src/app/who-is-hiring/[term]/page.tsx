/**
 * Programmatic SEO landing page: `/who-is-hiring/[term]` (e.g. `/python`).
 *
 * Reframed (T18) to be GENUINELY USEFUL TO A JOB-SEEKER, and FULLY
 * SERVER-RENDERED so Google (and a no-JS visitor) indexes the real content, not
 * a client-only chart. Everything is fetched server-side at render/revalidate
 * time and emitted in the initial HTML:
 *
 *   - a server-static trend chart (`JobsStaticStacked`, plain SVG, the SAME
 *     `jobs-trends.ts` binning the live chart uses);
 *   - quick stats a job-seeker cares about (total postings mentioning the skill,
 *     the latest month's count, the peak month, the remote share);
 *   - a sample of the REAL recent job postings that mention the skill - the
 *     posting text snippet, the poster handle, a link to the HN post and to the
 *     in-app `/archived/<thread>` view (`JobsPostingSample`);
 *   - the curated keyword-led analysis from `jobs-seo.ts`;
 *   - dense internal links into the hub, sibling skills and the comparisons.
 *
 * Curated terms (bespoke copy in `jobs-seo.ts`) are prebuilt + indexed + in the
 * sitemap; any other term renders via the keyword-led template but is
 * noindex,follow (crawlable, kept out of the sitemap).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { abs, termToSlug, comparisonSlug, slugToTerm } from "@/lib/site";
import { jobsTermSeo, hasCuratedJobsTerm } from "@/lib/jobs-seo";
import {
  allGalleryTerms,
  jobsSiblingTerms,
  jobsComparisonsForTerm,
} from "@/lib/jobs-gallery";
import { getJobsTermLanding } from "@/lib/jobs-landing-data";
import { JobsStaticStacked } from "../_seo/JobsStaticStacked";
import { JobsPostingSample } from "../_seo/JobsPostingSample";
import { JobsLandingChart } from "../JobsLandingChart";
import { JobsLandingHeader, JobsLandingFooter } from "../JobsLandingChrome";
import { JsonLd } from "@/app/components/JsonLd";

// Rendered on demand from live Upstash Redis Search (via the `@upstash/redis`
// SDK), then CDN-cached - we don't prerender at build time (the index refreshes
// out of band, and prerendering every term would fan out hundreds of SDK queries
// during the build). Matches the prior `fetch(..., {cache:"no-store"})` behavior
// that already kept this route dynamic.
export const dynamic = "force-dynamic";
export const dynamicParams = true;

export function generateStaticParams() {
  return allGalleryTerms().map((term) => ({ term: termToSlug(term) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ term: string }>;
}): Promise<Metadata> {
  const { term: slug } = await params;
  const term = slugToTerm(slug);
  const seo = jobsTermSeo(term);
  const path = `/who-is-hiring/${termToSlug(term)}`;
  return {
    title: { absolute: seo.title },
    description: seo.description,
    alternates: { canonical: abs(path) },
    robots: hasCuratedJobsTerm(term) ? undefined : { index: false, follow: true },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: abs(path),
      type: "article",
    },
    twitter: { title: seo.title, description: seo.description },
  };
}

/** "Apr 2011" -> readable; pct formatting for the remote share. */
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default async function WhoIsHiringTermPage({
  params,
}: {
  params: Promise<{ term: string }>;
}) {
  const { term: slug } = await params;
  const term = slugToTerm(slug);
  if (!term) notFound();

  const seo = jobsTermSeo(term);
  const path = `/who-is-hiring/${termToSlug(term)}`;

  // All the page's data, server-side, at render/revalidate time.
  const { series, stats, postings, remote } = await getJobsTermLanding(term);

  const siblings = jobsSiblingTerms(term, 8);
  const relatedComparisons = jobsComparisonsForTerm(term);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Who Is Hiring? Search", item: abs("/who-is-hiring") },
          { "@type": "ListItem", position: 2, name: `${term} jobs`, item: abs(path) },
        ],
      },
      {
        "@type": "Dataset",
        name: `"${term}" mentions in Hacker News 'Who is hiring?' postings`,
        description: `Monthly count of how often "${term}" appears in Hacker News 'Who is hiring?' job postings, 2011 onward, with a sample of the real postings.`,
        url: abs(path),
        creator: { "@type": "Organization", name: "Upstash", url: "https://upstash.com" },
        temporalCoverage: "2011/2026",
        isAccessibleForFree: true,
      },
    ],
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      <JsonLd data={jsonLd} />
      <JobsLandingHeader crumb={`“${term}” in job postings`} />

      <div className="px-3 pt-4">
        <p className="text-[11px] text-[color:var(--hn-subtle)] mb-1">
          <Link href="/who-is-hiring">Who Is Hiring? Search</Link> ›{" "}
          <span>“{term}”</span>
        </p>
        <h1 className="text-[20px] font-bold leading-tight">
          “{term}” jobs on Hacker News - who is hiring, and how demand trends
        </h1>
        {/* Lead with the description copy a featured snippet can lift verbatim. */}
        <p className="text-[14px] mt-2 max-w-[760px] leading-relaxed font-medium">
          {seo.description}
        </p>
      </div>

      {/* stat strip - the quick numbers a job-seeker scans first */}
      <div className="px-3 pt-4 flex flex-wrap gap-x-8 gap-y-2 text-[12px]">
        <Stat
          label="Postings mentioning it"
          value={stats.total.toLocaleString()}
        />
        {stats.latestLabel && (
          <Stat
            label={`This month (${stats.latestLabel})`}
            value={stats.latestCount.toLocaleString()}
          />
        )}
        {stats.peakLabel && (
          <Stat
            label="Peak month"
            value={`${stats.peakLabel} (${stats.peakCount.toLocaleString()})`}
          />
        )}
        {remote != null && (
          <Stat label="Mention remote" value={pct(remote)} />
        )}
      </div>

      {/* server-static trend chart - real SVG in the initial HTML so it's
          indexable; the interactive version follows below */}
      <div className="px-3 pt-4">
        <div className="border border-[color:var(--hn-subtle)]/30 rounded bg-white p-2">
          <JobsStaticStacked series={series} />
        </div>
        <p className="text-[11px] text-[color:var(--hn-subtle)] mt-1">
          Monthly job postings mentioning “{term}” in the Hacker News “Who is
          hiring?” thread, one bar per calendar month since 2011.
        </p>
      </div>

      {/* sample of the REAL postings - the indexable content a job-seeker
          actually wants; server-rendered, not the client drill-down */}
      <JobsPostingSample
        postings={postings}
        term={term}
        heading={`Recent “${term}” job postings on Hacker News`}
      />

      {/* custom analysis - the unique, non-templated content */}
      {seo.analysis.length > 0 && (
        <div className="px-3 pt-6">
          <h2 className="text-[14px] font-bold">
            What the “{term}” hiring trend shows
          </h2>
          <div className="mt-1 max-w-[760px] space-y-2">
            {seo.analysis.map((p, i) => (
              <p key={i} className="text-[13px] leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* interactive chart - explore other months/terms without leaving. Below
          the fold and below the server content, so it's an enhancement, not the
          indexable surface. */}
      <div className="px-3 pt-6">
        <h2 className="text-[14px] font-bold">
          Explore “{term}” - filter by month and compare
        </h2>
        <p className="text-[12px] text-[color:var(--hn-subtle)] mt-1 max-w-[760px] leading-relaxed">
          Switch between share-of-voice and raw counts, narrow the window, add
          another skill, and click any month to read the postings behind the bar.
        </p>
        <div className="pt-3">
          <JobsLandingChart initialTerms={[term]} />
        </div>
      </div>

      {/* internal links - wire this page into the link graph */}
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
                    href={`/who-is-hiring/compare/${comparisonSlug(c.terms)}`}
                    className="text-[color:var(--hn-orange)]"
                  >
                    {c.title} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {siblings.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--hn-subtle)]">
              Related skills
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {siblings.map((t) => (
                <li key={t}>
                  <Link
                    href={`/who-is-hiring/${termToSlug(t)}`}
                    className="text-[color:var(--hn-orange)]"
                  >
                    {t} jobs
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[12px] mt-4">
          <Link href="/who-is-hiring" className="text-[color:var(--hn-orange)]">
            Compare “{term}” with anything else
          </Link>{" "}
          on the full Who Is Hiring? chart, or see{" "}
          <Link href="/">how every term trends across all of Hacker News</Link>.
        </p>
      </div>

      <JobsLandingFooter />
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
