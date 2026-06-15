/**
 * `/how-it-works` - the long-form explainer page.
 *
 * Exists for two reasons: (1) give humans the "what is this / how do I use it"
 * context the single-page tool doesn't dwell on, and (2) give search engines a
 * crawlable block of keyword-rich prose + a FAQPage rich result, plus a dense
 * set of internal links into the programmatic landing pages.
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  abs,
  comparisonSlug,
  termToSlug,
  HISTORY_FROM_YEAR,
  HISTORY_TO_YEAR,
  HISTORY_SPAN_YEARS,
} from "@/lib/site";
import { COMPARISONS } from "@/lib/examples";
import { JsonLd } from "@/app/components/JsonLd";
import { LandingHeader, LandingFooter } from "@/app/components/LandingChrome";
import { OutboundLink } from "@/app/components/OutboundLink";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Hacker Trends charts 18 years of Hacker News: where the data comes from, how mention-over-time is measured, and how Upstash Redis Search powers the live date-histograms and search behind every chart.",
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    title: "How Hacker Trends works",
    description:
      "Where the data comes from and how Upstash Redis Search powers the live charts behind Hacker Trends.",
    url: "/how-it-works",
    type: "article",
  },
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Hacker Trends?",
    a: "Hacker Trends is a Google-Trends-style explorer for Hacker News. You type any topic, tool, company, or person and it charts how often that term has appeared in Hacker News posts and comments each month, so you can see when interest rose, peaked, and faded. You can overlay several terms on one chart to compare them.",
  },
  {
    q: "Where does the data come from?",
    a: `It indexes roughly 45 million Hacker News items - stories and comments - spanning ${HISTORY_FROM_YEAR} to ${HISTORY_TO_YEAR}. Each item's title, text, author, type, timestamp, score, and comment count are stored as a Redis hash and indexed for full-text search.`,
  },
  {
    q: "How far back does the data go?",
    a: `The index covers Hacker News from ${HISTORY_FROM_YEAR} through ${HISTORY_TO_YEAR} - about 18 years of the front page and its comment threads.`,
  },
  {
    q: "How often is the data refreshed?",
    a: "The index is re-ingested daily from the public HuggingFace Hacker News Parquet dump, which itself tracks the site in near-real-time, so the data stays current to within about a day. The 'synced' badge in the header shows exactly how recent the newest indexed item is.",
  },
  {
    q: "How is a term's popularity measured?",
    a: "Each point on the line is the number of Hacker News posts and comments in that month whose title or body mentions the term - an honest, exact mention count, not a fuzzy or weighted score. The chart is a live date-histogram computed at query time.",
  },
  {
    q: "What powers Hacker Trends?",
    a: "It is built on Upstash Redis Search. The trend lines come from SEARCH.AGGREGATE date-histogram queries, and the list of stories behind each line comes from SEARCH.QUERY full-text search - both running directly against Upstash Redis with no separate analytics database.",
  },
  {
    q: "How are the top stories ranked?",
    a: "Relevance ranking blends the text-match (BM25) score with the story's upvotes and comment count, so genuinely discussed and upvoted threads surface ahead of incidental mentions. You can also sort purely by points, by comment count, or by recency.",
  },
  {
    q: "Is Hacker Trends free to use?",
    a: "Yes. It is a free, public demo built to show what Upstash Redis Search can do on a real, large dataset.",
  },
];

export default function HowItWorksPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Hacker Trends", item: abs("/") },
      { "@type": "ListItem", position: 2, name: "How it works", item: abs("/how-it-works") },
    ],
  };

  const featured = COMPARISONS.slice(0, 8);

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      <JsonLd data={faqJsonLd} />
      <JsonLd data={breadcrumb} />
      <LandingHeader crumb="how it works" />

      <article className="px-3 pt-4 text-[13px] leading-relaxed max-w-[760px]">
        <h1 className="text-[22px] font-bold leading-tight">
          How Hacker Trends works
        </h1>
        <p className="text-[color:var(--hn-subtle)] mt-1">
          A Google-Trends-style explorer for {HISTORY_SPAN_YEARS} years of Hacker
          News, built on Upstash Redis Search.
        </p>

        <h2 className="text-[16px] font-bold mt-6">What it does</h2>
        <p className="mt-1">
          Type any topic, tool, company, or person and Hacker Trends charts how
          often it has come up on Hacker News, month by month, since{" "}
          {HISTORY_FROM_YEAR}. Overlay several terms to watch their traction rise
          and fall against each other - the same way you would compare search
          interest on Google Trends, but for the stories and comments that shaped
          the tech industry’s conversation.{" "}
          <Link href="/" className="text-[color:var(--hn-orange)]">
            Open the tool →
          </Link>
        </p>

        <h2 className="text-[16px] font-bold mt-6">How to use it</h2>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>
            <strong>Search</strong> a single term to see its mention-over-time
            line and the top stories behind it.
          </li>
          <li>
            <strong>Compare</strong> up to five terms at once - each gets its own
            colored line on a shared axis.
          </li>
          <li>
            <strong>Zoom to a date range</strong> by selecting months on the
            chart to drill into a specific spike.
          </li>
          <li>
            <strong>Filter</strong> the results by author or by type (story vs
            comment), and sort by relevance, points, comments, or recency.
          </li>
          <li>
            <strong>Share</strong> any view - the full state lives in the URL, so
            a link reproduces the exact chart and filters.
          </li>
        </ul>

        <h2 className="text-[16px] font-bold mt-6">What’s under the hood</h2>
        <p className="mt-1">
          About 45 million Hacker News items from {HISTORY_FROM_YEAR}–
          {HISTORY_TO_YEAR} are stored as plain Redis hashes and indexed with{" "}
          <OutboundLink
            destination="upstash"
            location="how_it_works"
            href="https://upstash.com/docs/redis/search"
            className="text-[color:var(--hn-orange)]"
          >
            Upstash Redis Search
          </OutboundLink>
          . Every chart is computed live, with no separate analytics warehouse:
        </p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>
            The <strong>trend line</strong> is a <code>SEARCH.AGGREGATE</code>{" "}
            date-histogram - one monthly bucket per point - filtered to items
            that actually mention the term.
          </li>
          <li>
            The <strong>stories list</strong> is a <code>SEARCH.QUERY</code>{" "}
            full-text search, ranked by a blend of BM25 relevance plus upvotes
            and comment count so the genuinely-discussed threads rise to the top.
          </li>
        </ul>

        <h2 className="text-[16px] font-bold mt-6">Popular comparisons</h2>
        <p className="mt-1">
          Some of the rivalries and successions the data tells best:
        </p>
        <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {featured.map((c) => (
            <li key={c.terms.join("-")}>
              <Link
                href={`/compare/${comparisonSlug(c.terms)}`}
                className="text-[color:var(--hn-orange)]"
              >
                {c.terms.join(" vs ")}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[color:var(--hn-subtle)]">
          Or jump straight to a single term, e.g.{" "}
          {["chatgpt", "rust", "bitcoin", "kubernetes"].map((t, i) => (
            <span key={t}>
              {i > 0 && ", "}
              <Link href={`/trends/${termToSlug(t)}`} className="text-[color:var(--hn-orange)]">
                {t}
              </Link>
            </span>
          ))}
          .
        </p>

        <h2 className="text-[16px] font-bold mt-6">Frequently asked questions</h2>
        <div className="mt-2 space-y-3">
          {FAQ.map((f) => (
            <div key={f.q}>
              <h3 className="font-bold">{f.q}</h3>
              <p className="mt-0.5">{f.a}</p>
            </div>
          ))}
        </div>
      </article>

      <LandingFooter />
    </div>
  );
}
