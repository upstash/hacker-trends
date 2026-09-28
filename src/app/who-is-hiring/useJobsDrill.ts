"use client";

/**
 * The chart <-> drill-down wiring shared by the hub and the landing charts.
 *
 * Hover previews a segment's postings (debounced in the chart); a click PINS
 * it, so hovering other bars no longer replaces the panel; clicking the pinned
 * segment again unpins. The pin belongs to the comparison it was made in: a
 * new set of terms (chips, gallery card) drops it, since its series index would
 * point at a different band.
 *
 * On load, once the first comparison resolves, the panel is prefetched with the
 * dominant band's latest month so it is never empty (T10) - at most once, and
 * never after the user has drilled in themselves.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultDrillSegment, monthKey, type SeriesData } from "@/lib/jobs-trends";
import { QUERYING_DISABLED } from "@/lib/maintenance";
import type { LatchKey, SegmentHit } from "./JobsStackedBars";
import { useJobComments } from "./useJobComments";

export function useJobsDrill(series: SeriesData[], loading: boolean, termsKey: string) {
  const { state, load, loadMore, retry } = useJobComments();
  const [pin, setPin] = useState<{ key: string; latch: LatchKey } | null>(null);
  const latched = pin && pin.key === termsKey ? pin.latch : null;

  // True once the USER has driven the drill-down, so the one-time prefetch
  // never yanks a posting out from under them.
  const userDrilled = useRef(false);
  const prefetched = useRef(false);

  const show = useCallback(
    (hit: SegmentHit) => {
      if (QUERYING_DISABLED) return; // drill-down needs live queries
      userDrilled.current = true;
      load({
        label: hit.series.label,
        color: hit.series.color,
        fromMs: hit.fromMs,
        toMs: hit.toMs,
        year: hit.year,
        month: hit.month,
        value: hit.value,
      });
    },
    [load],
  );

  /** Hover: preview a segment, but never while one is pinned. */
  const onHover = useCallback(
    (hit: SegmentHit) => {
      if (!latched) show(hit);
    },
    [show, latched],
  );

  /** Click: pin this segment; click it again to unpin. */
  const onSelect = useCallback(
    (hit: SegmentHit) => {
      setPin((prev) =>
        prev &&
        prev.key === termsKey &&
        prev.latch.seriesIndex === hit.seriesIndex &&
        prev.latch.year === hit.year &&
        prev.latch.month === hit.month
          ? null
          : {
              key: termsKey,
              latch: { seriesIndex: hit.seriesIndex, year: hit.year, month: hit.month },
            },
      );
      show(hit);
    },
    [show, termsKey],
  );

  useEffect(() => {
    if (QUERYING_DISABLED) return;
    if (prefetched.current || userDrilled.current) return;
    if (loading) return; // wait for the real series, not the placeholders
    const seg = defaultDrillSegment(series);
    if (!seg) return;
    prefetched.current = true;
    const s = series[seg.seriesIndex];
    load({
      label: s.label,
      color: s.color,
      fromMs: seg.fromMs,
      toMs: seg.toMs,
      year: seg.year,
      month: seg.month,
      value: s.byMonth.get(monthKey(seg.year, seg.month)) ?? 0,
    });
  }, [loading, series, load]);

  return { comments: state, loadMore, retry, latched, onHover, onSelect };
}
