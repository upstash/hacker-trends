"use client";

/**
 * The "Who is hiring?" job-trends page (client root).
 *
 * Top to bottom this is the approved prototype layout:
 *   header -> one-paragraph pitch -> custom compare chips -> per-month relative
 *   stacked bar chart -> comment drill-down -> two galleries (Top categories +
 *   Popular comparisons).
 *
 * This file is the SHELL: it owns the page chrome (HN header, pitch) and the
 * top-level series/window/normalization state. The comparison lives in the URL
 * (`?q=a&q=b`, like the homepage) so a shared link opens the same chart: it is
 * read client-side (the page itself is static) and rewritten with
 * `history.replaceState` once the user changes it; the untouched default view
 * keeps the clean `/who-is-hiring` URL.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEFAULT_TERMS, MAX_SERIES, seriesSlots } from "@/lib/jobs-trends";
import { JobsStackedBars, useChartWindow } from "./JobsStackedBars";
import { JobsCompareChips } from "./JobsCompareChips";
import { JobsComments } from "./JobsComments";
import { JobsGalleries } from "./JobsGalleries";
import { useJobSeries } from "./useJobSeries";
import { useJobsDrill } from "./useJobsDrill";
import { QUERYING_DISABLED } from "@/lib/maintenance";
import { trackOutbound } from "@/lib/analytics";

/** How long the URL waits for the chips to settle before it is rewritten. */
const URL_SYNC_MS = 400;

const noSubscribe = () => () => {};

/** The `?q=` terms of the landing URL (client only; null on the server and when
 *  absent, so the server render and hydration use the defaults). */
function useUrlTerms(): string[] | null {
  const search = useSyncExternalStore(
    noSubscribe,
    () => window.location.search,
    () => null,
  );
  return useMemo(() => {
    if (search == null) return null;
    const q = new URLSearchParams(search)
      .getAll("q")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, MAX_SERIES);
    return q.length ? q : null;
  }, [search]);
}

export function WhoIsHiringSearch() {
  // The comparison: the user's own pick, else the shared link's `?q=`, else the
  // default. Held here so a click on a gallery card (T12) can swap it.
  const urlTerms = useUrlTerms();
  const [picked, setPicked] = useState<string[] | null>(null);
  const terms = picked ?? urlTerms ?? DEFAULT_TERMS;
  const [windowKey, setWindowKey] = useChartWindow();
  const [normalized, setNormalized] = useState(true);

  // Live job-scoped, per-month series for the current comparison.
  const { series, loading, error, retry } = useJobSeries(terms);
  const termsKey = series.map((s) => s.label).join("§");

  // The hover/click drill-down (T09) + its pin and one-time prefetch (T10).
  const drill = useJobsDrill(series, loading, termsKey);

  // Mirror a user-changed comparison into the URL (debounced). The default view
  // is left alone so `/who-is-hiring` stays canonical until the user acts.
  useEffect(() => {
    if (!picked) return;
    const t = setTimeout(() => {
      const next = seriesSlots(picked).series;
      const isDefault = next.join("|") === DEFAULT_TERMS.join("|");
      const sp = new URLSearchParams();
      if (!isDefault) for (const q of next) sp.append("q", q);
      const qs = sp.toString();
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", url);
    }, URL_SYNC_MS);
    return () => clearTimeout(t);
  }, [picked]);

  /** Load a gallery card's terms into the big chart (a card click). The
   *  drill-down panel intentionally stays as-is until the user hovers the new
   *  chart. */
  const pickCard = useCallback((next: string[]) => {
    setPicked(next);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  return (
    <div className="mx-auto" style={{ maxWidth: 1350 }}>
      {/* A single keyword-rich <h1>, kept sr-only so the compact header wordmark
          carries the visual brand (same pattern as the homepage). */}
      <h1 className="sr-only">
        Hacker News Who Is Hiring? - search and compare how skills trend in job
        postings since 2011
      </h1>

      {/* Header bar -------------------------------------------------- */}
      <div className="hn-header flex items-center gap-2 px-2 py-[3px]">
        <span className="hn-logo">W</span>
        <Link href="/who-is-hiring" className="font-bold text-[12px]">
          Who Is Hiring? Search
        </Link>
        <span className="text-[10px] opacity-80 hidden sm:inline">
          | how skills trend across Hacker News job postings since 2011
        </span>
        <div className="ml-auto flex items-center gap-2 text-[10px]">
          <Link href="/" className="opacity-90 hover:underline whitespace-nowrap">
            all of Hacker News →
          </Link>
        </div>
      </div>

      {/* One-paragraph pitch (NO "reviving hacker-job-trends" line) --- */}
      <div className="px-3 pt-3">
        <p className="text-[11px] text-[color:var(--hn-subtle)] max-w-[760px] leading-relaxed">
          Every month since 2011, Hacker News runs an{" "}
          <a
            href="https://news.ycombinator.com/submitted?id=whoishiring"
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--hn-orange)]"
          >
            &quot;Ask HN: Who is hiring?&quot;
          </a>{" "}
          thread where each top-level comment is one job posting. Chart how often
          a language, tool or work-style shows up across those postings - a live
          read on what the tech job market actually asks for, every bar a single{" "}
          <a
            href="https://upstash.com/docs/redis/search"
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--hn-orange)] whitespace-nowrap"
            onClick={() => trackOutbound("upstash", "jobs_hub_pitch")}
          >
            Upstash Redis Search
          </a>{" "}
          query.
        </p>
      </div>

      {/* Custom compare chips (T08) ---------------------------------- */}
      <div className="px-3 pt-4">
        <JobsCompareChips
          terms={terms}
          setTerms={setPicked}
          totalAt={(i) => series[i]?.total}
        />
      </div>

      {/* Per-month relative stacked bar chart (T05-T07) -------------- */}
      <div className="px-3 pt-3">
        <JobsStackedBars
          series={series}
          windowKey={windowKey}
          onWindow={setWindowKey}
          normalized={normalized}
          onToggleNormalized={setNormalized}
          showYearAxis
          onHover={drill.onHover}
          onSelect={drill.onSelect}
          selected={drill.latched}
          loading={loading}
          error={error}
          onRetry={retry}
        />
      </div>

      {/* Comment drill-down (T09) ------------------------------------ */}
      <div className="px-3 pt-4 min-h-[240px]">
        <JobsComments
          state={drill.comments}
          onLoadMore={drill.loadMore}
          onRetry={drill.retry}
          disabled={QUERYING_DISABLED}
        />
      </div>

      {/* Galleries (T12) --------------------------------------------- */}
      <JobsGalleries onPick={pickCard} />
    </div>
  );
}
