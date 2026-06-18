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
 * top-level series/window/normalization state. The chart centerpiece (T05/T06)
 * is live; the compare chips (T08) and comment drill-down (T09) are now wired in
 * too - hovering or clicking a bar segment streams that term's postings for that
 * month into the panel. The galleries (T12) are still reserved-height
 * placeholders so wiring them in later causes no layout shift.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TERMS,
  defaultDrillSegment,
  monthKey,
  type WindowKey,
} from "@/lib/jobs-trends";
import { JobsStackedBars, type SegmentHit, type LatchKey } from "./JobsStackedBars";
import { JobsCompareChips } from "./JobsCompareChips";
import { JobsComments } from "./JobsComments";
import { JobsGalleries } from "./JobsGalleries";
import { useJobSeries } from "./useJobSeries";
import { useJobComments } from "./useJobComments";

export function WhoIsHiringSearch() {
  // Top-level state the chart + chips drive. Held here so a click on a gallery
  // card (T12) can swap the whole comparison.
  const [terms, setTerms] = useState<string[]>(DEFAULT_TERMS);
  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const [normalized, setNormalized] = useState(true);

  // Live job-scoped, per-month series for the current comparison.
  const { series, loading } = useJobSeries(terms);

  // The hover/click drill-down (T09).
  const { state: commentsState, load: loadComments } = useJobComments();

  // The segment behind the current drill-down: its raw count + calendar month.
  // `useJobComments`'s `CommentLoad` doesn't carry these, so we track them here
  // and hand them to the panel header (the count readout + the month->thread
  // link mapping). Kept in sync with every `loadComments` call below.
  const [drillMeta, setDrillMeta] = useState<{
    value: number;
    year: number;
    /** 0-based month. */
    month: number;
  } | null>(null);

  // True once the USER has driven the drill-down (a real hover or click). The
  // one-time prefetch below only fires while this is false, so we never yank a
  // posting the user is reading out from under them to re-show the default.
  const userDrilled = useRef(false);
  // Guards the prefetch to the FIRST default comparison only: once it has run we
  // never auto-load again, so swapping the comparison (chips / gallery card)
  // leaves the panel as-is until the user hovers the new chart.
  const prefetched = useRef(false);

  // Each series' all-time total, keyed by its label, for the compare chips.
  const totalByLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of series) m.set(s.label, s.total);
    return m;
  }, [series]);

  /** Load a gallery card's terms into the big chart (a card click). The
   *  drill-down panel intentionally stays as-is until the user hovers the new
   *  chart - the prefetch guard above only ever fires for the first default. */
  const pickCard = useCallback((next: string[]) => {
    setTerms(next);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  // The segment PINNED by a click. While one is pinned, hovering other bars must
  // NOT change the drill-down (a click should stay put); clicking the pinned bar
  // again unpins it and resumes hover-to-preview. A ref mirror lets the debounced
  // hover handler read the current pin without being recreated (so the chart's
  // memoized callbacks stay stable).
  const [latched, setLatched] = useState<LatchKey | null>(null);
  const latchedRef = useRef<LatchKey | null>(null);
  latchedRef.current = latched;

  /** Stream the postings behind a segment into the panel. */
  const showSegment = useCallback(
    (hit: SegmentHit) => {
      userDrilled.current = true;
      setDrillMeta({ value: hit.value, year: hit.year, month: hit.month });
      loadComments({
        label: hit.series.label,
        color: hit.series.color,
        fromMs: hit.fromMs,
        toMs: hit.toMs,
        year: hit.year,
        month: hit.month,
      });
    },
    [loadComments],
  );

  /** Hover: preview a segment, but never while one is pinned. */
  const onHoverSegment = useCallback(
    (hit: SegmentHit) => {
      if (latchedRef.current) return;
      showSegment(hit);
    },
    [showSegment],
  );

  /** Click: pin this segment so hover stops changing it; click it again to unpin. */
  const onSelectSegment = useCallback(
    (hit: SegmentHit) => {
      setLatched((prev) =>
        prev &&
        prev.seriesIndex === hit.seriesIndex &&
        prev.year === hit.year &&
        prev.month === hit.month
          ? null
          : { seriesIndex: hit.seriesIndex, year: hit.year, month: hit.month },
      );
      showSegment(hit);
    },
    [showSegment],
  );

  // Prefetch the default comparison's drill-down on load (T10): once the default
  // series resolves, populate the panel with the dominant band's latest month so
  // it is never empty on first paint. Fires at most once and only if the user
  // has not already drilled in (a fast hover before the aggregate returns wins).
  useEffect(() => {
    if (prefetched.current || userDrilled.current) return;
    if (loading) return; // wait for the real series, not the zero placeholders
    const seg = defaultDrillSegment(series);
    if (!seg) return;
    prefetched.current = true;
    const s = series[seg.seriesIndex];
    // The segment's raw count for the header readout (defaultDrillSegment only
    // returns the coordinates, so look the value up in the series' month map).
    const value = s.byMonth.get(monthKey(seg.year, seg.month)) ?? 0;
    setDrillMeta({ value, year: seg.year, month: seg.month });
    loadComments({
      label: s.label,
      color: s.color,
      fromMs: seg.fromMs,
      toMs: seg.toMs,
      year: seg.year,
      month: seg.month,
    });
  }, [loading, series, loadComments]);

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
          read on what the tech job market actually asks for.
        </p>
      </div>

      {/* Custom compare chips (T08) ---------------------------------- */}
      <div className="px-3 pt-4">
        <JobsCompareChips
          terms={terms}
          setTerms={setTerms}
          totalFor={(t) => totalByLabel.get(t)}
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
          onHover={onHoverSegment}
          onSelect={onSelectSegment}
          selected={latched}
          loading={loading}
        />
      </div>

      {/* Comment drill-down (T09) ------------------------------------ */}
      <div className="px-3 pt-4 min-h-[240px]">
        <JobsComments state={commentsState} segment={drillMeta} />
      </div>

      {/* Galleries (T12) --------------------------------------------- */}
      <JobsGalleries onPick={pickCard} />
    </div>
  );
}
