/**
 * Programmatic SEO landing page: `/who-is-hiring/top/[slug]`
 * (e.g. `top-8-languages`).
 *
 * The category counterpart to the comparison pages (T18): one server-rendered
 * page per "Top N <category>" gallery card, titled with the high-intent question
 * a job-seeker actually searches ("Which programming languages are most in
 * demand on Hacker News?"). Like the comparison pages it is FULLY SERVER-RENDERED
 * - the relative-stacked chart (server-static SVG), the analysis, a per-term
 * leaderboard with all-time totals, AND a sample of the real top postings behind
 * the category are all in the initial HTML, so Google indexes the actual content.
 *
 * The slug maps 1:1 to a curated category card, so these are always indexed +
 * in the sitemap; an unknown slug 404s.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { abs, termToSlug } from "@/lib/site";
import {
  jobsCategorySeo,
  categoryCardBySlug,
  allJobsCategorySlugs,
  jobsDisplayTerm,
} from "@/lib/jobs-seo";
import { getJobsComparisonLanding } from "@/lib/jobs-landing-data";
import { JobsLandingChart } from "../../JobsLandingChart";
import {
  JobsLandingHeader,
  JobsLandingFooter,
  JobsToolCta,
} from "../../JobsLandingChrome";
import { JsonLd } from "@/app/components/JsonLd";
import { colorAt } from "@/lib/jobs-trends";

// Rendered on demand from live Upstash Redis Search (via the `@upstash/redis`
// SDK), then CDN-cached - we don't prerender at build time (the index refreshes
// out of band, and prerendering every slug would fan out hundreds of SDK queries
// during the build). `dynamicParams = false` still restricts to the known slugs.
export const dynamic = "force-dynamic";
export const dynamicParams = false;

export function generateStaticParams() {
  return allJobsCategorySlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = categoryCardBySlug(slug);
  if (!card) return {};
  const seo = jobsCategorySeo(card);
  const path = `/who-is-hiring/top/${slug}`;
  return {
    title: { absolute: seo.title },
    description: seo.description,
    alternates: { canonical: abs(path) },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: abs(path),
      type: "article",
    },
    twitter: { title: seo.title, description: seo.description },
  };
}

export default async function WhoIsHiringTopPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const card = categoryCardBySlug(slug);
  if (!card) notFound();

  const seo = jobsCategorySeo(card);
  const path = `/who-is-hiring/top/${slug}`;
  const terms = card.terms;

  // Per-term stats + a sample of postings per term, server-side.
  const { perSeries } = await getJobsComparisonLanding(terms, 2);

  // The leaderboard: terms ranked by all-time postings, the page's core answer.
  const ranked = [...perSeries].sort((a, b) => b.stats.total - a.stats.total);
  // Index-of-term -> color, so the leaderboard dots match the chart bands.
  const colorOf = new Map(terms.map((t, i) => [t, colorAt(i)]));

  // The single richest term's postings (the category leader) as the concrete
  // "what these jobs look like" sample.
  const leader = ranked[0];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Who Is Hiring? Search", item: abs("/who-is-hiring") },
          { "@type": "ListItem", position: 2, name: seo.title, item: abs(path) },
        ],
      },
      {
        "@type": "ItemList",
        name: seo.title,
        itemListElement: ranked.map((ps, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: ps.term,
        })),
      },
    ],
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      <JsonLd data={jsonLd} />
      <JobsLandingHeader crumb={card.title} />

      <div className="px-3 pt-4">
        <p className="text-[11px] text-[color:var(--hn-subtle)] mb-1">
          <Link href="/who-is-hiring">Who Is Hiring? Search</Link> ›{" "}
          <span>{card.title}</span>
        </p>
        <h1 className="text-[20px] font-bold leading-tight">{seo.title}</h1>
        <p className="text-[14px] mt-2 max-w-[760px] leading-relaxed font-medium">
          {seo.description}
        </p>
      </div>

      {/* Big, obvious path into the interactive tool. */}
      <JobsToolCta label={`Explore ${card.title} in the Who Is Hiring? tool`} />

      {/* leaderboard - the direct, scannable answer to the question */}
      <div className="px-3 pt-4">
        <h2 className="text-[14px] font-bold">Ranked by demand (all-time)</h2>
        <ol className="mt-2 space-y-1">
          {ranked.map((ps, i) => (
            <li
              key={ps.term}
              className="flex items-center gap-2 text-[13px]"
            >
              <span className="text-[color:var(--hn-subtle)] tabular-nums w-5 flex-none text-right">
                {i + 1}.
              </span>
              <span
                className="inline-block w-3 h-3 rounded-sm flex-none"
                style={{ background: colorOf.get(ps.term) }}
              />
              <Link
                href={`/who-is-hiring/${termToSlug(ps.term)}`}
                className="font-semibold"
              >
                {jobsDisplayTerm(ps.term)}
              </Link>
              <span className="text-[11px] text-[color:var(--hn-subtle)] tabular-nums">
                {ps.stats.total.toLocaleString()} postings
                {ps.stats.peakLabel ? ` · peak ${ps.stats.peakLabel}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* The main interactive chart - the same one the hub renders, seeded with
          this category. Opens on raw counts; flip to share % to stack the bands
          to 100% and see each one's slice, or click a month for the postings. */}
      <div className="px-3 pt-4">
        <JobsLandingChart initialTerms={terms} />
        <p className="text-[11px] text-[color:var(--hn-subtle)] mt-2 max-w-[760px] leading-relaxed">
          Each calendar month since 2011 as one bar. Switch to share % to stack
          the bands to 100% and see each one&rsquo;s slice of the category&rsquo;s
          postings, narrow the window, or click a month to read the postings
          behind the bar.
        </p>
      </div>

      {/* custom analysis */}
      {seo.analysis.length > 0 && (
        <div className="px-3 pt-6">
          <h2 className="text-[14px] font-bold">What the chart shows</h2>
          <div className="mt-1 max-w-[760px] space-y-2">
            {seo.analysis.map((p, i) => (
              <p key={i} className="text-[13px] leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* real postings behind the category leader */}
      {leader && leader.postings.length > 0 && (
        <div className="px-3 pt-6">
          <h2 className="text-[14px] font-bold">
            Popular {jobsDisplayTerm(leader.term)} postings (the category leader)
          </h2>
          <ol className="mt-2 flex flex-col gap-3">
            {leader.postings.map((p) => {
              const hnUrl = `https://news.ycombinator.com/item?id=${p.id}`;
              return (
                <li key={p.id} className="text-[12.5px] leading-[1.5]">
                  <div className="text-[11px] text-[color:var(--hn-subtle)] mb-0.5">
                    <a
                      href={hnUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-semibold"
                    >
                      {p.by}
                    </a>
                    {p.parent != null && (
                      <>
                        {" · "}
                        <Link href={`/archived/${p.parent}`} className="subtle">
                          read the thread
                        </Link>
                      </>
                    )}
                    {" · "}
                    <a href={hnUrl} target="_blank" rel="noreferrer noopener" className="subtle">
                      view on HN
                    </a>
                  </div>
                  <p>{p.snippet}</p>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* per-term deep links */}
      <div className="px-3 pt-6">
        <h2 className="text-[14px] font-bold">Each skill on its own</h2>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {terms.map((t, i) => (
            <li key={t}>
              <Link
                href={`/who-is-hiring/${termToSlug(t)}`}
                style={{ color: colorAt(i) }}
                className="font-semibold"
              >
                {jobsDisplayTerm(t)} jobs →
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-3 pt-6">
        <p className="text-[12px]">
          <Link href="/who-is-hiring" className="text-[color:var(--hn-orange)]">
            Build your own comparison
          </Link>{" "}
          on the full Who Is Hiring? chart, or see{" "}
          <Link href="/">how these terms trend across all of Hacker News</Link>.
        </p>
      </div>

      <JobsLandingFooter />
    </div>
  );
}
