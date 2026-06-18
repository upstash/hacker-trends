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
 *
 * The fetch lives at MODULE scope (a shared promise), not inside the effect.
 * That's deliberate: the previous per-instance `useRef` guard plus an
 * abort-on-unmount cleanup could leave the gallery permanently blank - mount,
 * the cleanup aborts the in-flight fetch, and on a fast client-side navigation
 * back the new instance's fetch could race/abort again, so the bottom graphs
 * showed only on a hard reload. A module-level promise is fetched at most once,
 * is never aborted by a component unmounting, and re-serves its resolved result
 * SYNCHRONOUSLY to every later mount - so returning to /who-is-hiring always
 * renders the gallery, no reload needed.
 */

import { useEffect, useMemo, useState } from "react";
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

/** The decoded dataset once it has resolved (null = fetched but unavailable). */
let cachedTerms: Record<string, MonthCount[]> | null = null;
/** Set once the shared fetch has settled, so a remount can skip straight to
 *  ready with the cached value instead of re-fetching. */
let settled = false;
/** The single in-flight (or resolved) fetch promise, shared across every mount
 *  and never tied to a component's lifetime. */
let inflight: Promise<void> | null = null;

function loadGalleryDataset(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch("/who-is-hiring/examples.json");
      if (!r.ok) throw new Error(`examples.json -> ${r.status}`);
      const wire = (await r.json()) as JobsGalleryWire;
      if ((wire as { error?: string }).error) throw new Error("dataset error");
      cachedTerms = decodeJobsGalleryWire(wire);
    } catch {
      // Leave cachedTerms null; cards fall back to live aggregates.
      cachedTerms = null;
    } finally {
      settled = true;
    }
  })();
  return inflight;
}

export function useJobsGallery(): GalleryDataset {
  // Seed from the module cache so a navigation BACK to the page paints the
  // gallery on the FIRST render (no fetch, no blank flash) when the dataset has
  // already loaded earlier this session.
  const [terms, setTerms] = useState<Record<string, MonthCount[]> | null>(
    () => cachedTerms,
  );
  const [ready, setReady] = useState(settled);

  useEffect(() => {
    let alive = true;
    // `loadGalleryDataset()` returns the shared promise - already-resolved when
    // the dataset loaded earlier - so this `.then` runs once as a microtask and
    // re-affirms the (already-seeded) state on a remount, or lands the fetch on
    // the first mount. Driving state only from this async callback (never
    // synchronously in the effect body) keeps the remount path a no-op render.
    loadGalleryDataset().then(() => {
      if (!alive) return;
      setTerms(cachedTerms);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(
    () => ({
      lookupPart: (part: string) => terms?.[part],
      ready,
    }),
    [terms, ready],
  );
}
