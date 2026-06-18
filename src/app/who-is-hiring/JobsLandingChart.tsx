"use client";

/**
 * The interactive chart widget embedded in the programmatic SEO landing routes
 * `/who-is-hiring/[term]` and `/who-is-hiring/compare/[slug]` (T17).
 *
 * It is the SAME centerpiece the hub page (`WhoIsHiringSearch`) renders - the
 * per-month relative stacked-bar chart, the compare chips, and the comment
 * drill-down - but seeded with THIS page's term(s) instead of the default
 * comparison, and WITHOUT the galleries (the landing page carries its own SEO
 * copy + internal links instead). Reusing the same hooks/components keeps a
 * single source of truth for the chart behavior; only the seed terms differ.
 *
 * Like the hub it fetches live job-scoped data on the client AFTER paint, so the
 * server-rendered SEO body (h1, summary, analysis, links) is what crawlers see
 * and what paints first - the chart hydrates in over the reserved height with no
 * layout shift.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultDrillSegment, type WindowKey } from "@/lib/jobs-trends";
import { JobsStackedBars, type SegmentHit } from "./JobsStackedBars";
import { JobsCompareChips } from "./JobsCompareChips";
import { JobsComments } from "./JobsComments";
import { useJobSeries } from "./useJobSeries";
import { useJobComments } from "./useJobComments";

export function JobsLandingChart({ initialTerms }: { initialTerms: string[] }) {
  const [terms, setTerms] = useState<string[]>(initialTerms);
  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const [normalized, setNormalized] = useState(true);

  const { series, loading } = useJobSeries(terms);
  const { state: commentsState, load: loadComments } = useJobComments();

  // Guard the one-time prefetch of the seed comparison's drill-down, and never
  // yank a posting the user is actively reading.
  const userDrilled = useRef(false);
  const prefetched = useRef(false);

  const totalByLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of series) m.set(s.label, s.total);
    return m;
  }, [series]);

  const drill = useCallback(
    (hit: SegmentHit) => {
      userDrilled.current = true;
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

  // Prefetch this page's comparison drill-down once the series resolve, so the
  // panel is never empty for a crawler-visible page (and matches the hub's UX).
  useEffect(() => {
    if (prefetched.current || userDrilled.current) return;
    if (loading) return;
    const seg = defaultDrillSegment(series);
    if (!seg) return;
    prefetched.current = true;
    const s = series[seg.seriesIndex];
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
    <div>
      {/* Compare chips: seeded with this page's term(s), but still editable so a
          visitor can branch the comparison without leaving the page. */}
      <JobsCompareChips
        terms={terms}
        setTerms={setTerms}
        totalFor={(t) => totalByLabel.get(t)}
      />

      <div className="pt-3">
        <JobsStackedBars
          series={series}
          windowKey={windowKey}
          onWindow={setWindowKey}
          normalized={normalized}
          onToggleNormalized={setNormalized}
          onHover={drill}
          onSelect={drill}
          loading={loading}
        />
      </div>

      {/* Reserve the drill-down height so hydration causes no layout shift. */}
      <div className="pt-4 min-h-[240px]">
        <JobsComments state={commentsState} />
      </div>
    </div>
  );
}
