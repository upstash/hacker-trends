"use client";

/**
 * One gallery card: a title + relative stacked-bar mini chart over LIVE
 * jobs-scoped data for that card's terms, plus a one-line story.
 *
 * Data path (perf): the card reads ONLY the shared, CDN-cached dataset
 * (`useJobsGallery` -> `/who-is-hiring/examples.json`), assembling each series
 * from its OR-group parts with `sumByMonth`. If that dataset is unavailable (a
 * Redis blip, a not-yet-primed version, or a part missing from it) the card
 * stays flat: no per-card live aggregates, so a cold gallery can never fan out
 * dozens of queries. Clicking it still loads the terms into the big chart.
 *
 * Interactions (the prototype's `JobsMiniCard` + `MiniStacked`): hovering the
 * chart zooms the card a touch and shows a term / Mon YYYY / count readout in the
 * card's TOP-RIGHT corner; clicking the title or chart loads the card's terms
 * into the big chart above (`onPick`).
 */

import { memo, useMemo, useState } from "react";
import {
  binMonths,
  colorAt,
  monthTotal,
  parseParts,
  sumByMonth,
  type RawBucket,
  type SeriesData,
} from "@/lib/jobs-trends";
import type { GalleryCard } from "@/lib/jobs-gallery";
import type { GalleryDataset } from "./useJobsGallery";
import {
  JobsMiniStacked,
  formatMiniHover,
  type MiniHover,
} from "./JobsMiniStacked";

/** Build one card's `SeriesData[]` from a per-part month-map resolver. Each
 *  series string is split on `|`; its parts' month maps are summed into one. */
function assembleSeries(
  terms: string[],
  partMap: (part: string) => Map<string, number> | undefined,
): SeriesData[] | null {
  const out: SeriesData[] = [];
  for (let i = 0; i < terms.length; i++) {
    const parts = parseParts(terms[i]);
    const maps: Map<string, number>[] = [];
    for (const p of parts) {
      const m = partMap(p);
      if (!m) return null; // a part is missing -> the card renders flat
      maps.push(m);
    }
    const byMonth = sumByMonth(maps);
    out.push({
      label: terms[i],
      parts,
      color: colorAt(i),
      byMonth,
      total: monthTotal(byMonth),
    });
  }
  return out;
}

function JobsMiniCardInner({
  card,
  dataset,
  onPick,
}: {
  card: GalleryCard;
  dataset: GalleryDataset;
  onPick: (terms: string[]) => void;
}) {
  const [hover, setHover] = useState<MiniHover | null>(null);

  // Memoize the terms key so the memo doesn't re-run on every render.
  const termsKey = card.terms.join("§");

  // Assemble synchronously from the shared dataset once it's ready; a missing
  // part (or no dataset) leaves the zero placeholder below.
  const fromDataset = useMemo(() => {
    if (!dataset.ready) return null;
    return assembleSeries(card.terms, (part) => {
      const points = dataset.lookupPart(part);
      if (!points) return undefined;
      return binMonths(points as RawBucket[]);
    });
    // termsKey stands in for card.terms; dataset identity changes when ready flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, termsKey]);

  // The dataset, else a zero-height placeholder so the card keeps its
  // colors/labels/height (no layout shift).
  const display: SeriesData[] = useMemo(
    () =>
      fromDataset ??
      card.terms.map((label, i) => ({
        label,
        parts: parseParts(label),
        color: colorAt(i),
        byMonth: new Map<string, number>(),
        total: 0,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromDataset, termsKey],
  );

  return (
    <div
      className="mini-trend jobs-mini-card"
      onClick={() => onPick(card.terms)}
    >
      {/* title row + top-right hover readout ----------------------------- */}
      <div className="flex items-baseline gap-2 mb-0.5 min-w-0">
        <button
          className="mini-trend-title truncate min-w-0 text-left"
          onClick={(e) => {
            e.stopPropagation();
            onPick(card.terms);
          }}
        >
          {card.title}
        </button>
        <span className="ml-auto mini-trend-hover whitespace-nowrap truncate min-w-0">
          {hover ? (
            <span style={{ color: hover.color }}>{formatMiniHover(hover)}</span>
          ) : (
            ""
          )}
        </span>
      </div>

      <JobsMiniStacked series={display} onHover={setHover} />

      <p className="mini-trend-story">{card.story}</p>
    </div>
  );
}

/* Memoized: each card holds its own data/hover state, so it should re-render
 * only when its `card`/`dataset`/`onPick` props change - not every time a
 * SIBLING card's hover updates the gallery. `card` is a stable module constant
 * and `onPick` is the page's `useCallback`, so the only churn is `dataset`
 * flipping ready once; after that every card is inert unless hovered. */
export const JobsMiniCard = memo(JobsMiniCardInner);
