"use client";

/**
 * One gallery card: a title + relative stacked-bar mini chart over LIVE
 * jobs-scoped data for that card's terms, plus a one-line story.
 *
 * Data path (perf): the card prefers the shared, CDN-cached dataset
 * (`useJobsGallery` -> `/who-is-hiring/examples.json`), assembling each series
 * from its OR-group parts with `sumByMonth`. If that dataset is unavailable (the
 * route 502'd, or a part isn't in it), the card LAZILY aggregates its terms live
 * via an IntersectionObserver so the gallery never fans out dozens of cold
 * aggregates on load - only cards scrolled near the viewport fetch.
 *
 * Interactions (the prototype's `JobsMiniCard` + `MiniStacked`): hovering the
 * chart zooms the card a touch and shows a term / Mon YYYY / count readout in the
 * card's TOP-RIGHT corner; clicking the title or chart loads the card's terms
 * into the big chart above (`onPick`).
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { aggregate } from "@/lib/hn-search";
import { drillIndex } from "@/lib/jobs-index";
import { QUERYING_DISABLED } from "@/lib/maintenance";
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
      if (!m) return null; // a part is missing -> caller falls back to live
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
  const ref = useRef<HTMLDivElement | null>(null);
  // Only the LIVE fallback writes this; the CDN-dataset path is derived (memo),
  // so the effect never sets state synchronously.
  const [liveSeries, setLiveSeries] = useState<SeriesData[] | null>(null);
  const [hover, setHover] = useState<MiniHover | null>(null);

  // Memoize the terms key so the effect doesn't re-run on every render.
  const termsKey = card.terms.join("§");

  // 1) Prefer the shared CDN dataset: assemble synchronously once it's ready.
  const fromDataset = useMemo(() => {
    if (!dataset.ready) return undefined; // not settled yet
    return assembleSeries(card.terms, (part) => {
      const points = dataset.lookupPart(part);
      if (!points) return undefined;
      return binMonths(points as RawBucket[]);
    });
    // termsKey stands in for card.terms; dataset identity changes when ready flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, termsKey]);

  // 2) Live fallback: only when the dataset is ready but didn't cover this card,
  //    and only once the card scrolls near the viewport (IntersectionObserver).
  //    All state writes here happen in async callbacks, never synchronously.
  useEffect(() => {
    // Dataset path covered it (or hasn't settled yet) -> no live fetch needed.
    if (fromDataset || !dataset.ready) return;
    // Querying disabled: no live fallback. Cards not in the cached dataset just
    // stay as their flat placeholder rather than hitting the dead route.
    if (QUERYING_DISABLED) return;
    const ctrl = new AbortController();
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      // Same gate the chart + drill-down use: the dedicated `hnjobs` index when
      // ready (no scope arm, ~3x faster), else the shared `hn` index scope=jobs.
      const { index, scope } = drillIndex();
      Promise.all(
        card.terms.map(async (label, i) => {
          const parts = parseParts(label);
          const perPart = await Promise.all(
            parts.map(async (p) => {
              const { buckets } = await aggregate({
                q: p,
                scope,
                index,
                signal: ctrl.signal,
              });
              return binMonths(buckets as RawBucket[]);
            }),
          );
          const byMonth = sumByMonth(perPart);
          return {
            label,
            parts,
            color: colorAt(i),
            byMonth,
            total: monthTotal(byMonth),
          } satisfies SeriesData;
        }),
      )
        .then((s) => {
          if (!ctrl.signal.aborted) setLiveSeries(s);
        })
        .catch(() => {});
    };

    const el = ref.current;
    if (!el) {
      run();
      return () => ctrl.abort();
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run();
          io.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDataset, dataset.ready, termsKey]);

  // Prefer the CDN dataset, then the live fallback, then a zero-height
  // placeholder so the card keeps its colors/labels/height (no layout shift)
  // while the first data resolves.
  const display: SeriesData[] = useMemo(
    () =>
      fromDataset ??
      liveSeries ??
      card.terms.map((label, i) => ({
        label,
        parts: parseParts(label),
        color: colorAt(i),
        byMonth: new Map<string, number>(),
        total: 0,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromDataset, liveSeries, termsKey],
  );

  return (
    <div
      ref={ref}
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
