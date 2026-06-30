/**
 * Programmatic SEO landing page: `/who-is-hiring/[term]` (e.g. `/python`).
 *
 * Reframed (T18) to be GENUINELY USEFUL TO A JOB-SEEKER. The server-rendered
 * body carries the indexable content (Google and a no-JS visitor see the real
 * copy, stats and postings); the trend chart itself is the live interactive
 * `JobsLandingChart` (the same centerpiece the hub renders), which hydrates over
 * its reserved height after paint. What's emitted server-side:
 *
 *   - quick stats a job-seeker cares about (total postings mentioning the skill,
 *     the latest month's count, the peak month, the remote share);
 *   - the REAL postings: this month's, then the most-discussed - poster handle,
 *     text snippet, per-posting HN + `/archived/<thread>` links
 *     (`JobsPostingSample`, fed by `getJobsTermLanding`);
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
import { jobsTermSeo, hasCuratedJobsTerm, jobsDisplayTerm } from "@/lib/jobs-seo";
import {
  allGalleryTerms,
  jobsSiblingTerms,
  jobsComparisonsForTerm,
} from "@/lib/jobs-gallery";
import { getJobsTermLanding } from "@/lib/jobs-landing-data";
import { JobsPostingSample } from "../_seo/JobsPostingSample";
import { JobsLandingChart } from "../JobsLandingChart";
import {
  JobsLandingHeader,
  JobsLandingFooter,
  JobsToolCta,
} from "../JobsLandingChrome";
import { JsonLd } from "@/app/components/JsonLd";
import { RedisSearchCTA } from "@/app/components/RedisSearchCTA";

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
  const display = jobsDisplayTerm(term);
  const path = `/who-is-hiring/${termToSlug(term)}`;

  // All the page's data, server-side, at render/revalidate time.
  const { stats, postings, remote } = await getJobsTermLanding(term);

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
      <JobsLandingHeader crumb={`${display} in job postings`} />

      <div className="px-3 pt-4">
        <p className="text-[11px] text-[color:var(--hn-subtle)] mb-1">
          <Link href="/who-is-hiring">Who Is Hiring? Search</Link> ›{" "}
          <span>{display}</span>
        </p>
        <h1 className="text-[20px] font-bold leading-tight">
          {display} jobs on Hacker News - Who is hiring, and how demand trends
        </h1>
        {/* Lead with the description copy a featured snippet can lift verbatim. */}
        <p className="text-[14px] mt-2 max-w-[760px] leading-relaxed font-medium">
          {seo.description}
        </p>
      </div>

      {/* Big, obvious path into the interactive tool. */}
      <JobsToolCta label={`Search & compare ${display} in the Who Is Hiring? tool`} />

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

      {/* The main interactive chart - the same one the hub renders, seeded with
          this skill. A single-skill page opens on raw monthly counts (share % is
          a meaningless flat band with one term, so that toggle is hidden); add
          another skill via the chips to unlock the share-of-voice view. */}
      <div className="px-3 pt-5">
        <JobsLandingChart initialTerms={[term]} />
        <p className="text-[11px] text-[color:var(--hn-subtle)] mt-2 max-w-[760px] leading-relaxed">
          Monthly {display} job postings in the Hacker News Who is hiring? thread,
          one bar per calendar month since 2011. Narrow the window, add another
          skill to compare, and click any month to read the postings behind the
          bar.
        </p>
      </div>

      {/* The conversion pitch: these job-trend pages are pure SEO surface, so
          give the organic reader a clear path to the Upstash docs/repo. */}
      <RedisSearchCTA location="jobs_term_page" subject="This hiring chart" />

      {/* the REAL postings, server-rendered (not the client drill-down): this
          month's, then the most-discussed. Indexable content a job-seeker wants. */}
      <JobsPostingSample
        postings={postings.month}
        term={term}
        heading={`${display} job postings for ${postings.monthLabel}`}
      />
      <JobsPostingSample
        postings={postings.popular}
        term={term}
        heading={`Some popular ${display} job postings`}
        subheading={
          postings.popularYear
            ? `The ${display} job postings that drew the most discussion in ${postings.popularYear}.`
            : `The ${display} job postings that drew the most discussion.`
        }
        showReplies
      />

      {/* custom analysis - the unique, non-templated content */}
      {seo.analysis.length > 0 && (
        <div className="px-3 pt-6">
          <h2 className="text-[14px] font-bold">
            What the {display} hiring trend shows
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

      {/* internal links - wire this page into the link graph */}
      <div className="px-3 pt-6">
        <h2 className="text-[14px] font-bold">More to explore</h2>

        {relatedComparisons.length > 0 && (
          <div className="mt-2">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--hn-subtle)]">
              {display} head-to-head
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
            Compare {display} with anything else
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
