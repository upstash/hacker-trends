"use client";

import { useEffect, useState } from "react";
import { searchPosts } from "@/lib/hn-search";

/**
 * A tiny "synced · 6h ago" badge for the header.
 *
 * It measures how fresh the *data* is, not when we wrote it to Upstash: the
 * timestamp shown is the single most-recent Hacker News item in the index - i.e.
 * the cutoff of the last monthly Parquet we ingested. That's the honest signal,
 * because if the daily re-ingest (GitHub Action) ever stalls, this number simply
 * keeps climbing instead of falsely reporting "just refreshed".
 *
 * One cheap query gets it: an empty filter sorted newest-first, LIMIT 1. The
 * `/api/hn` edge route is CDN-cached for an hour, so this is a near-free read
 * shared across visitors. Fetched after paint so it never touches the LCP path.
 */

const FRESH_WITHIN_HOURS = 36; // green up to here, amber beyond (cron looks stale)

/** Compact relative age: "5m ago" / "6h ago" / "3d ago". */
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function DataFreshness() {
  const [newest, setNewest] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    searchPosts({ q: "", sort: "recent", limit: 1 })
      .then((r) => {
        if (alive && r.docs[0]?.time) setNewest(r.docs[0].time);
      })
      .catch(() => {
        /* best-effort: just don't show the badge */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!newest) return null;

  const ageHrs = (Date.now() - new Date(newest).getTime()) / 3_600_000;
  const fresh = ageHrs <= FRESH_WITHIN_HOURS;
  const dot = fresh ? "#1a7f37" : "#d4a72c"; // green when current, amber when stale

  return (
    <span
      className="hidden sm:inline-flex items-center gap-1 text-[10px] opacity-80 whitespace-nowrap"
      title={`Newest indexed Hacker News item: ${new Date(newest).toUTCString()}. The index is re-ingested daily from the HuggingFace Hacker News Parquet dump, so this is how current the data is.`}
    >
      <span
        className="inline-block rounded-full"
        style={{ width: 6, height: 6, background: dot }}
      />
      synced · {ago(newest)}
    </span>
  );
}
