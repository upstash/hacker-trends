"use client";

/**
 * Shared gallery-dataset provider for the mini cards.
 *
 * Fetches the CDN-cached `/who-is-hiring/examples.json` ONCE for the whole page
 * (after the shell paints), decodes the compact wire form into a per-part
 * `{ key, docCount }[]` map, and hands cards a `lookupPart(part)`. Every card
 * shares this single fetch instead of each firing its own aggregate fan-out.
 *
 * The fetch is best-effort: if the JSON route 502s or is missing, `lookupPart`
 * returns `undefined` and the card falls back to a live per-card aggregate
 * (useJobSeries-style). So the gallery still works with no precomputed dataset,
 * just slower on the first paint.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  decodeJobsGalleryWire,
  type JobsGalleryWire,
  type MonthCount,
} from "@/lib/jobs-gallery-wire";

export type GalleryDataset = {
  /** the per-part histogram, or `undefined` if the dataset is unavailable / the
   *  part is absent (the card then aggregates that part live). */
  lookupPart: (part: string) => MonthCount[] | undefined;
  /** true once the JSON fetch has settled (ok or failed); cards wait for this so
   *  a missing part means "not in dataset" rather than "still loading". */
  ready: boolean;
};

export function useJobsGallery(): GalleryDataset {
  const [terms, setTerms] = useState<Record<string, MonthCount[]> | null>(null);
  const [ready, setReady] = useState(false);
  // Avoid a double-fetch under React 18 StrictMode's dev double-mount.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch("/who-is-hiring/examples.json", {
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`examples.json -> ${r.status}`);
        const wire = (await r.json()) as JobsGalleryWire;
        if ((wire as { error?: string }).error) throw new Error("dataset error");
        setTerms(decodeJobsGalleryWire(wire));
      } catch {
        // Leave `terms` null; cards fall back to live aggregates.
      } finally {
        if (!ctrl.signal.aborted) setReady(true);
      }
    })();
    return () => ctrl.abort();
  }, []);

  return useMemo(
    () => ({
      lookupPart: (part: string) => terms?.[part],
      ready,
    }),
    [terms, ready],
  );
}
