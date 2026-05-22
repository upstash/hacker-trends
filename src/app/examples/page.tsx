/**
 * /examples — the full trend gallery.
 *
 * A categorized wall of clickable mini-histograms (one per catalog term) plus
 * the curated "A vs B" comparisons. Data comes from `getExamplesData()`, which
 * serves all ~150 histograms from a single cached Redis key (see
 * examples-data.ts) — so this page is one cache read, not 150 live queries.
 *
 * Every mini-chart links back to the main page: click the title to compare the
 * term(s) over full history, or click a month to land with that month selected.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { getExamplesData } from "@/lib/examples-data";
import { EXAMPLE_GROUPS, COMPARISONS } from "@/lib/examples";
import { MiniTrend } from "../components/MiniTrend";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore examples · Hacker Trends",
  description:
    "A gallery of Hacker News trend lines — people, AI, dev tools, JS frameworks, startups, security, crypto and the industry zeitgeist — plus curated comparisons.",
};

// Single-term gallery charts are HN orange. Comparison charts assign these in
// order — blue first, so the earliest-peaking term (listed first) reads blue —
// and the title paints each term in its own color so you can tell them apart.
const SINGLE_COLOR = "#ff6600";
const COMPARE_COLORS = ["#1f6feb", "#ff6600", "#1a7f37", "#cf222e", "#8250df"];

export default async function ExamplesPage() {
  const data = await getExamplesData();
  const bucketsFor = (term: string) => data.terms[term] ?? [];

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      {/* Header */}
      <div className="hn-header flex items-center gap-2 px-2 py-[3px]">
        <span className="hn-logo">T</span>
        <span className="font-bold text-[12px]">Hacker Trends</span>
        <span className="text-[10px] opacity-80">/ explore examples</span>
        <Link href="/" className="share-link ml-auto">
          ← back to compare
        </Link>
      </div>

      <div className="px-3 pt-3">
        <h1 className="text-[15px] font-bold">Explore examples</h1>
        <p className="text-[11px] text-[color:var(--hn-subtle)] max-w-[680px] pt-1">
          Every term below is a live-ish date-histogram over 18 years of Hacker
          News, vetted for tall, distinct spikes. Click a title to chart it on
          the main page, or click any month to jump straight to that month&apos;s
          posts.
        </p>

        {/* Table of contents */}
        <nav className="toc flex flex-wrap gap-x-3 gap-y-1 pt-3 text-[11px]">
          <span className="text-[color:var(--hn-subtle)]">jump to:</span>
          {EXAMPLE_GROUPS.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="toc-link">
              {g.title}
            </a>
          ))}
          <a href="#comparisons" className="toc-link font-bold">
            comparisons
          </a>
        </nav>
      </div>

      {/* One section per category */}
      {EXAMPLE_GROUPS.map((g) => (
        <section key={g.id} id={g.id} className="gallery-section px-3 pt-6">
          <div className="flex items-baseline gap-2 border-b border-[color:var(--hn-subtle)] pb-1 mb-3">
            <h2 className="text-[13px] font-bold">{g.title}</h2>
            <span className="text-[10px] text-[color:var(--hn-subtle)]">{g.blurb}</span>
            <a href="#top" className="toc-link ml-auto text-[10px]">↑ top</a>
          </div>
          <div className="mini-grid">
            {g.terms.map((term) => (
              <MiniTrend
                key={term}
                series={[{ term, color: SINGLE_COLOR, buckets: bucketsFor(term) }]}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Comparisons — 2-to-4 related terms overlaid, lead changing hands */}
      <section id="comparisons" className="gallery-section px-3 pt-6 pb-12">
        <div className="flex items-baseline gap-2 border-b border-[color:var(--hn-subtle)] pb-1 mb-3">
          <h2 className="text-[13px] font-bold">Comparisons</h2>
          <span className="text-[10px] text-[color:var(--hn-subtle)]">
            Related terms overlaid — watch the lead change hands over time.
          </span>
          <a href="#top" className="toc-link ml-auto text-[10px]">↑ top</a>
        </div>
        <div className="mini-grid mini-grid--wide">
          {COMPARISONS.map((c) => (
            <MiniTrend
              key={c.terms.join("|")}
              series={c.terms.map((term, i) => ({
                term,
                color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                buckets: bucketsFor(term),
              }))}
              story={c.story}
            />
          ))}
        </div>
      </section>

      <footer className="text-center text-[10px] text-[color:var(--hn-subtle)] pb-8">
        all {Object.keys(data.terms).length} histograms served from one cached
        Redis key · generated {new Date(data.generatedAt).toISOString().slice(0, 10)}
      </footer>
    </div>
  );
}
