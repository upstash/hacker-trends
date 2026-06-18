/**
 * Programmatic SEO landing page: `/who-is-hiring/compare/[slug]`
 * (e.g. `javascript-vs-typescript`).
 *
 * Reframed (T18) into a QUESTION-STYLE, FULLY SERVER-RENDERED page: one per
 * head-to-head gallery story, titled with the high-intent question people search
 * ("React vs Vue vs Angular: which is most in demand in HN job posts?"). The
 * chart (a server-static relative-stacked SVG), the analysis, the per-side stats
 * AND a sample of the real postings behind each side are all emitted in the
 * initial HTML, so Google indexes the actual content rather than a client-only
 * chart that hydrates after paint.
 *
 * The slug carries OR-group series too (an `ai|ml|llm` part is slugged with its
 * `|` collapsed); we resolve the slug back to its term list from the curated
 * comparison set when it's one of ours, else split an ad-hoc `a-vs-b` slug.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { abs, comparisonSlug, slugToTerm, termToSlug } from "@/lib/site";
import {
  jobsComparisonSeo,
  jobsComparisonQuestionSeo,
  hasCuratedJobsComparison,
} from "@/lib/jobs-seo";
import { comparisonTermSets, COMPARISONS } from "@/lib/jobs-gallery";
import { getJobsComparisonLanding } from "@/lib/jobs-landing-data";
import { JobsStaticStacked } from "../../_seo/JobsStaticStacked";
import { JobsLandingChart } from "../../JobsLandingChart";
import { JobsLandingHeader, JobsLandingFooter } from "../../JobsLandingChrome";
import { JsonLd } from "@/app/components/JsonLd";
import { colorAt } from "@/lib/jobs-trends";

// Rendered on demand from live Upstash Redis Search (via the `@upstash/redis`
// SDK), then CDN-cached - we don't prerender at build time (the index refreshes
// out of band, and prerendering every slug would fan out hundreds of SDK queries
// during the build). Matches the prior `fetch(..., {cache:"no-store"})` behavior
// that already kept this route dynamic.
export const dynamic = "force-dynamic";
export const dynamicParams = true;

export function generateStaticParams() {
  return comparisonTermSets().map((terms) => ({ slug: comparisonSlug(terms) }));
}

/** Resolve a slug to its ordered series list: a curated comparison if a gallery
 *  story matches, else split an ad-hoc `a-vs-b-vs-c` slug and de-slug each part. */
function termsForSlug(slug: string): string[] {
  const curated = COMPARISONS.find((c) => comparisonSlug(c.terms) === slug);
  if (curated) return curated.terms;
  return slug
    .split("-vs-")
    .map((p) => slugToTerm(p))
    .filter(Boolean);
}

/** Display label for one series string: collapse an OR-group to its parts joined
 *  with " / " for prose ("ai|ml|llm" reads "ai / ml / llm"). */
function seriesLabel(s: string): string {
  return s.includes("|") ? s.split("|").map((p) => p.trim()).join(" / ") : s;
}

/** The SEO copy for a slug: the question copy when this is a curated gallery
 *  comparison, else the keyword-led "X vs Y" template. */
function seoFor(slug: string, terms: string[]) {
  const card = COMPARISONS.find((c) => comparisonSlug(c.terms) === slug);
  return card ? jobsComparisonQuestionSeo(card) : jobsComparisonSeo(terms);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const terms = termsForSlug(slug);
  if (terms.length < 2) return {};
  const seo = seoFor(slug, terms);
  const path = `/who-is-hiring/compare/${comparisonSlug(terms)}`;
  const card = COMPARISONS.find((c) => comparisonSlug(c.terms) === slug);
  return {
    title: { absolute: seo.title },
    description: seo.description,
    alternates: { canonical: abs(path) },
    // Every gallery comparison is curated (question copy); ad-hoc slugs that fall
    // through to the template are noindex,follow.
    robots:
      card || hasCuratedJobsComparison(slug)
        ? undefined
        : { index: false, follow: true },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: abs(path),
      type: "article",
    },
    twitter: { title: seo.title, description: seo.description },
  };
}

export default async function WhoIsHiringComparePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const terms = termsForSlug(slug);
  if (terms.length < 2) notFound();

  const seo = seoFor(slug, terms);
  const path = `/who-is-hiring/compare/${comparisonSlug(terms)}`;
  const curated = COMPARISONS.find((c) => comparisonSlug(c.terms) === slug);
  const labels = terms.map(seriesLabel);
  const vs = labels.join(" vs ");

  // All page data, server-side.
  const { series, perSeries } = await getJobsComparisonLanding(terms, 3);

  // Cross-links to a few other comparison stories (skip this one).
  const otherComparisons = COMPARISONS.filter(
    (c) => comparisonSlug(c.terms) !== slug,
  ).slice(0, 6);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Who Is Hiring? Search", item: abs("/who-is-hiring") },
      { "@type": "ListItem", position: 2, name: seo.title, item: abs(path) },
    ],
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      <JsonLd data={jsonLd} />
      <JobsLandingHeader crumb={`${vs} in job postings`} />

      <div className="px-3 pt-4">
        <p className="text-[11px] text-[color:var(--hn-subtle)] mb-1">
          <Link href="/who-is-hiring">Who Is Hiring? Search</Link> ›{" "}
          <span>{vs}</span>
        </p>
        {/* The h1 IS the searchable question (matches <title>). */}
        <h1 className="text-[20px] font-bold leading-tight">{seo.title}</h1>
        <p className="text-[14px] mt-2 max-w-[760px] leading-relaxed font-medium">
          {seo.description}
        </p>
      </div>

      {/* legend */}
      <div className="px-3 pt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
        {labels.map((label, i) => (
          <span key={terms[i]} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm flex-none"
              style={{ background: colorAt(i) }}
            />
            <span className="font-semibold">{label}</span>
          </span>
        ))}
      </div>

      {/* server-static relative-stacked chart - real SVG in the initial HTML */}
      <div className="px-3 pt-3">
        <div className="border border-[color:var(--hn-subtle)]/30 rounded bg-white p-2">
          <JobsStaticStacked series={series} />
        </div>
        <p className="text-[11px] text-[color:var(--hn-subtle)] mt-1">
          Each calendar month since 2011 as one stacked bar, normalized to 100%
          so the bands show each side’s share of the “Who is hiring?” postings.
        </p>
      </div>

      {/* custom analysis */}
      {seo.analysis.length > 0 && (
        <div className="px-3 pt-6">
          <h2 className="text-[14px] font-bold">How the lead changes hands</h2>
          <div className="mt-1 max-w-[760px] space-y-2">
            {seo.analysis.map((p, i) => (
              <p key={i} className="text-[13px] leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* per-side stats + real postings: makes the page concrete, not just a
          chart. One block per series, in legend order/color. */}
      <div className="px-3 pt-6">
        <h2 className="text-[14px] font-bold">The real postings behind each</h2>
        <div className="mt-2 space-y-6">
          {perSeries.map((ps, i) => (
            <div key={ps.term}>
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <span
                  className="inline-block w-3 h-3 rounded-sm flex-none"
                  style={{ background: colorAt(i) }}
                />
                <span>{seriesLabel(ps.term)}</span>
                <span className="text-[11px] font-normal text-[color:var(--hn-subtle)]">
                  {ps.stats.total.toLocaleString()} postings
                  {ps.stats.peakLabel
                    ? ` · peak ${ps.stats.peakLabel}`
                    : ""}
                </span>
              </div>
              <JobsPostingSampleInline postings={ps.postings} />
            </div>
          ))}
        </div>
      </div>

      {/* interactive chart - explore without leaving (below the indexable copy) */}
      <div className="px-3 pt-6">
        <h2 className="text-[14px] font-bold">Explore this comparison</h2>
        <p className="text-[12px] text-[color:var(--hn-subtle)] mt-1 max-w-[760px] leading-relaxed">
          Switch between share-of-voice and raw counts, narrow the window, and
          click any month to read the postings behind the bar.
        </p>
        <div className="pt-3">
          <JobsLandingChart initialTerms={terms} />
        </div>
      </div>

      {/* curated one-line story (when this is a gallery comparison) */}
      {curated?.story && (
        <div className="px-3 pt-4">
          <p className="text-[13px] leading-relaxed max-w-[760px] text-[color:var(--hn-subtle)]">
            {curated.story}
          </p>
        </div>
      )}

      {/* per-term deep links - send the reader to each side's own page */}
      <div className="px-3 pt-6">
        <h2 className="text-[14px] font-bold">Each on its own</h2>
        <ul className="mt-2 space-y-1 text-[13px]">
          {terms.map((s, i) => {
            const first = s.includes("|") ? s.split("|")[0].trim() : s;
            return (
              <li key={s}>
                <Link
                  href={`/who-is-hiring/${termToSlug(first)}`}
                  style={{ color: colorAt(i) }}
                  className="font-semibold"
                >
                  “{seriesLabel(s)}” jobs on Hacker News →
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* cross-links to other comparisons */}
      {otherComparisons.length > 0 && (
        <div className="px-3 pt-6">
          <h2 className="text-[14px] font-bold">More comparisons</h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {otherComparisons.map((c) => (
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

/** The postings list without its own heading (the per-side block supplies the
 *  heading via the colored term row above it). Thin wrapper over
 *  JobsPostingSample so the comparison page can label each side itself. */
function JobsPostingSampleInline({
  postings,
}: {
  postings: import("@/lib/jobs-landing-data").JobPosting[];
}) {
  if (postings.length === 0) {
    return (
      <p className="text-[12px] text-[color:var(--hn-subtle)] mt-1">
        no sample postings available for this term
      </p>
    );
  }
  // Reuse the shared sample component but with an empty visual heading by
  // wrapping it so the page controls the label. JobsPostingSample renders its
  // own <h2>, so here we render a compact inline variant instead.
  return (
    <ol className="mt-1 flex flex-col gap-2">
      {postings.map((p) => {
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
            </div>
            <p>{p.snippet}</p>
          </li>
        );
      })}
    </ol>
  );
}
