/**
 * Compact wire format for shipping the examples-gallery histograms to the
 * browser.
 *
 * The server cache (examples-data.ts) holds each term's points as
 * `{ key: epochMs, docCount }` objects — fine on the server, but serializing
 * ~64k of them into the homepage's RSC flight payload ballooned the HTML past
 * 8 MB (the property names `"key"`/`"docCount"` and 13-digit timestamps, all
 * string-escaped, dominate the bytes).
 *
 * Nothing on the client needs the exact epoch — every consumer (the MiniTrend
 * sparklines, the coolness ranking) immediately collapses `key` to a month slot
 * via `slotOf`. So we transmit a flat `[slot, count, slot, count, …]` array per
 * term (slots are 0–~240, no property names) and rebuild the `{key, docCount}`
 * shape on arrival. This is ~10× smaller and keeps the client contract intact.
 *
 * This module is client-safe: it only touches the slot math in trend-time.ts,
 * never the Upstash token, so it can be imported from "use client" files.
 */

import { MIN_MS, MONTH_MS, slotOf } from "./trend-time";

export type MonthCount = { key: number; docCount: number };

export type ExamplesWire = {
  version: string;
  /** term -> flat [slot0, count0, slot1, count1, …] */
  terms: Record<string, number[]>;
};

/** Server-side: collapse epoch-ms histograms to slot/count pairs. */
export function encodeExamplesWire(data: {
  version: string;
  terms: Record<string, MonthCount[]>;
}): ExamplesWire {
  const terms: Record<string, number[]> = {};
  for (const [term, points] of Object.entries(data.terms)) {
    const flat = new Array<number>(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      flat[i * 2] = slotOf(points[i].key);
      flat[i * 2 + 1] = points[i].docCount;
    }
    terms[term] = flat;
  }
  return { version: data.version, terms };
}

/** Client-side: rebuild the `{key, docCount}[]` map every consumer expects.
 *  `key` is the slot's canonical month start, which round-trips through `slotOf`
 *  to the same slot — exactly what densify/coolness key off of. */
export function decodeExamplesWire(
  wire: ExamplesWire,
): Record<string, MonthCount[]> {
  const out: Record<string, MonthCount[]> = {};
  for (const [term, flat] of Object.entries(wire.terms)) {
    const points: MonthCount[] = new Array(flat.length >> 1);
    for (let i = 0; i + 1 < flat.length; i += 2) {
      points[i >> 1] = { key: MIN_MS + flat[i] * MONTH_MS, docCount: flat[i + 1] };
    }
    out[term] = points;
  }
  return out;
}
