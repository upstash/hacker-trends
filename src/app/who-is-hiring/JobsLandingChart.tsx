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
 * The server page hands down the series it already built (`initialSeries`, from
 * the primed gallery data), so the seeded chart paints with no client fetch;
 * editing the chips switches to live aggregates like the hub.
 */

import { useState } from "react";
import type { SeriesData } from "@/lib/jobs-trends";
import { QUERYING_DISABLED } from "@/lib/maintenance";
import { JobsStackedBars, useChartWindow } from "./JobsStackedBars";
import { JobsCompareChips } from "./JobsCompareChips";
import { JobsComments } from "./JobsComments";
import { useJobSeries } from "./useJobSeries";
import { useJobsDrill } from "./useJobsDrill";

export function JobsLandingChart({
  initialTerms,
  initialSeries,
  renderedAt,
}: {
  initialTerms: string[];
  initialSeries?: SeriesData[];
  /** server render time; anchors the in-progress month so hydration matches. */
  renderedAt?: number;
}) {
  const [terms, setTerms] = useState<string[]>(initialTerms);
  const [windowKey, setWindowKey] = useChartWindow();
  // Landing pages open on raw COUNTS, not share-of-voice: a single-skill page is
  // always a flat 100% band in share mode, and even a 2-way comparison reads more
  // honestly as counts here (the user can still flip to share% when there are 2+
  // terms). A single term hides the toggle entirely (`hideShareToggle` below).
  const [normalized, setNormalized] = useState(false);

  const { series, loading, error, retry } = useJobSeries(terms, initialSeries);
  const isSingle = series.length <= 1;
  const termsKey = series.map((s) => s.label).join("§");
  const drill = useJobsDrill(series, loading, termsKey);

  return (
    <div>
      {/* Compare chips: seeded with this page's term(s), but still editable so a
          visitor can branch the comparison without leaving the page. */}
      <JobsCompareChips
        terms={terms}
        setTerms={setTerms}
        totalAt={(i) => series[i]?.total}
      />

      <div className="pt-3">
        <JobsStackedBars
          series={series}
          windowKey={windowKey}
          onWindow={setWindowKey}
          normalized={isSingle ? false : normalized}
          onToggleNormalized={setNormalized}
          hideShareToggle={isSingle}
          onHover={drill.onHover}
          onSelect={drill.onSelect}
          selected={drill.latched}
          loading={loading}
          error={error}
          onRetry={retry}
          nowMs={renderedAt}
        />
      </div>

      {/* Reserve the drill-down height so hydration causes no layout shift. */}
      <div className="pt-4 min-h-[240px]">
        <JobsComments
          state={drill.comments}
          onLoadMore={drill.loadMore}
          onRetry={drill.retry}
          disabled={QUERYING_DISABLED}
        />
      </div>
    </div>
  );
}
