/**
 * Compact wire format for shipping the jobs-gallery histograms to the browser.
 *
 * The server cache (jobs-gallery-data.ts) holds each part's points as
 * `{ key: epochMs, docCount }` objects. Serializing the raw objects for ~120
 * distinct parts (13-digit timestamps + the `"key"`/`"docCount"` property names,
 * all string-escaped) dominates the payload bytes, exactly as it did for the
 * main page (see examples-wire.ts).
 *
 * Unlike the main page, the jobs mini charts re-bin into TRUE calendar months
 * (`binMonths` in jobs-trends.ts keys off `getUTCMonth()`, not the 30d slot
 * grid). So we cannot collapse to the 30d `slotOf` grid - that would drift a
 * bucket into the wrong calendar month. Instead we fold each part's points into
 * calendar months here and transmit a flat `[globalMonthIndex, count, ...]`
 * array per part (a global month index is `year*12 + monthIndex`, a small
 * integer, no property names). On arrival each pair is rebuilt as a single
 * `{ key, docCount }` whose `key` is that month's 1st-of-month UTC epoch - which
 * `binMonths` re-bins to the SAME calendar month, so the round trip is exact.
 *
 * Client-safe: only calendar arithmetic (Date.UTC), never the Upstash token, so
 * it can be imported from "use client" files.
 */

import { monthIndex, fromMonthIndex, binMonths, type RawBucket } from "./jobs-trends";

export type MonthCount = { key: number; docCount: number };

export type JobsGalleryWire = {
  version: string;
  /** part -> flat [monthIdx0, count0, monthIdx1, count1, ...] (calendar months) */
  terms: Record<string, number[]>;
};

/** Server-side: fold each part's epoch-ms points into calendar months, then to
 *  the flat [globalMonthIndex, count, ...] pairs. Months are emitted in
 *  ascending index order (deterministic payload, friendlier to gzip). */
export function encodeJobsGalleryWire(data: {
  version: string;
  terms: Record<string, MonthCount[]>;
}): JobsGalleryWire {
  const terms: Record<string, number[]> = {};
  for (const [part, points] of Object.entries(data.terms)) {
    const byMonth = binMonths(points as RawBucket[]);
    const idxCounts: [number, number][] = [];
    for (const [k, v] of byMonth) {
      const [y, m] = k.split("-").map(Number);
      idxCounts.push([monthIndex(y, m), v]);
    }
    idxCounts.sort((a, b) => a[0] - b[0]);
    const flat = new Array<number>(idxCounts.length * 2);
    for (let i = 0; i < idxCounts.length; i++) {
      flat[i * 2] = idxCounts[i][0];
      flat[i * 2 + 1] = idxCounts[i][1];
    }
    terms[part] = flat;
  }
  return { version: data.version, terms };
}

/** Client-side: rebuild the `{ key, docCount }[]` points every consumer expects.
 *  `key` is the calendar month's 1st-of-month UTC epoch, which `binMonths`
 *  re-bins to the same month - so the mini chart sees the exact same series. */
export function decodeJobsGalleryWire(
  wire: JobsGalleryWire,
): Record<string, MonthCount[]> {
  const out: Record<string, MonthCount[]> = {};
  for (const [part, flat] of Object.entries(wire.terms)) {
    const points: MonthCount[] = new Array(flat.length >> 1);
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const { year, month } = fromMonthIndex(flat[i]);
      points[i >> 1] = { key: Date.UTC(year, month, 1), docCount: flat[i + 1] };
    }
    out[part] = points;
  }
  return out;
}
