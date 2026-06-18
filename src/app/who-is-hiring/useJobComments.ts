"use client";

/**
 * Imperative data hook for the comment drill-down (T09).
 *
 * Given a `SegmentHit` (a term in one calendar month, from the chart), this
 * loads that series' actual job postings for that month, scoped to jobs and
 * date-ranged to the month, and ranks them by `relevance + log(1 + replyCount)`
 * (`rankByDiscussion`) so the most-discussed postings surface first.
 *
 * `replyCount` is each posting's direct-children count. `drillIndex()` (T15)
 * picks the corpus: when the dedicated `hnjobs` index is ready it queries that
 * (each doc carries a real `replies` count, so the ranking bites immediately);
 * otherwise it falls back to the shared `hn` index scoped to jobs, where
 * `replies`/`ndesc` are 0 and the ranking is effectively pure relevance. The
 * code reads `replies ?? ndesc`, so the ordering tightens automatically the day
 * the dedicated index is switched on (Spec: "falls back to the `hn` scope=jobs
 * search until T15 swaps in the dedicated index").
 *
 * The LAST hover/click stays on screen until the next one replaces it: a stale
 * response can never overwrite a newer one (guarded by a monotonic request id),
 * but we never clear on mouse-leave - that would make the panel flicker as the
 * cursor crosses the dense bars.
 *
 * PERFORMANCE. The raw `hnjobs` drill query is ~190-200ms, so the only way to
 * make a REPEAT feel instant is to not re-run it. Two caches make that happen:
 *   - an in-memory `resultCache` of the final ranked top-10 keyed by the resolved
 *     segment query, served SYNCHRONOUSLY on a repeat (0ms, no `loading` flash);
 *   - the browser HTTP cache, which the deterministic per-(term,month) `/api/hn`
 *     URL now populates (the client dropped `cache: no-store`, the edge sets a
 *     `max-age`), so even a cold `resultCache` miss on a repeat skips the network.
 * In-flight loads are also deduped by key, and a started fetch warms the cache
 * even if its consumer has already moved on (free prefetch as the cursor sweeps).
 */

import { useRef, useState } from "react";
import { searchPosts, type HnDoc } from "@/lib/hn-search";
import { parseParts, rankByDiscussion } from "@/lib/jobs-trends";
import { drillIndex } from "@/lib/jobs-index";

/**
 * Module-level result cache for the drill-down, keyed by the FULLY-resolved
 * query (`index | scope | sorted-parts | from | to`). Two layers of repeat-hover
 * savings stack here:
 *
 *   1. The browser HTTP cache (the per-(term,month) `/api/hn` URL is deterministic
 *      and now served with a `max-age`, and the client no longer sends
 *      `cache: no-store`) - so even a cache MISS here is cheap on a repeat.
 *   2. This in-memory map - the FINAL ranked top-10 for a segment, so a repeat
 *      hover/click is served SYNCHRONOUSLY (0ms, no fetch, no `loading` flash, no
 *      re-rank), which is what makes the panel feel instant.
 *
 * It also dedupes IN-FLIGHT loads: a hover then an immediate click of the same
 * segment shares the one pending promise instead of firing a second query.
 *
 * The key is order-independent in the OR-group parts (parts are sorted) so
 * `backend|sre` and `sre|backend` hit the same entry. The cache lives for the
 * page's lifetime; the dataset is a periodic ingest, so within a session it
 * never goes stale enough to matter (the HTTP layer's TTL handles real refresh).
 */
const resultCache = new Map<string, HnDoc[]>();
const inflight = new Map<string, Promise<HnDoc[]>>();

function cacheKey(
  index: string,
  scope: string | undefined,
  parts: string[],
  from: string,
  to: string,
): string {
  return `${index}|${scope ?? ""}|${[...parts].sort().join("|")}|${from}|${to}`;
}

/** What the panel is currently showing: which series, which month, the docs. */
export type CommentLoad = {
  /** the raw series string (may contain `|`). */
  label: string;
  /** the OR-group parts actually searched (drives highlighting). */
  parts: string[];
  /** the series' color (the dot next to the panel title). */
  color: string;
  /** human label for the month, e.g. "Apr 2021". */
  periodLabel: string;
};

export type CommentsState = {
  status: "idle" | "loading" | "done" | "error";
  load: CommentLoad | null;
  docs: HnDoc[];
};

const IDLE: CommentsState = { status: "idle", load: null, docs: [] };

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type LoadArgs = {
  label: string;
  color: string;
  /** [from, to) ms window for the month. */
  fromMs: number;
  toMs: number;
  year: number;
  /** 0-based month. */
  month: number;
};

export function useJobComments() {
  const [state, setState] = useState<CommentsState>(IDLE);
  // A monotonic id stamps each load; only the result of the LATEST id is allowed
  // to land. This replaces signal-aborting the fetches: the shared in-flight job
  // (keyed by segment, below) must outlive a single consumer leaving so it can
  // still warm the cache for the very next hover as the cursor crosses the dense
  // bars, so we drop stale results by id rather than tearing the request down.
  const reqId = useRef(0);

  const load = (args: LoadArgs) => {
    const parts = parseParts(args.label);
    if (parts.length === 0) return;

    const periodLabel = `${MONTH_ABBR[args.month]} ${args.year}`;
    const meta: CommentLoad = {
      label: args.label,
      parts,
      color: args.color,
      periodLabel,
    };

    const from = new Date(args.fromMs).toISOString();
    const to = new Date(args.toMs).toISOString();

    // Target the dedicated `hnjobs` index when it's ready (fast + reply-ranked);
    // otherwise the shared `hn` index scoped to jobs.
    const { index, scope } = drillIndex();
    const key = cacheKey(index, scope, parts, from, to);

    // FAST PATH: we already have this segment's ranked top-10. Show it
    // synchronously - no `loading` flash, no network, no re-rank. This is the
    // repeat-hover/click case the user feels as "instant". Bump the req id so any
    // older in-flight load can't clobber it.
    const cached = resultCache.get(key);
    if (cached) {
      reqId.current++;
      setState({ status: "done", load: meta, docs: cached });
      return;
    }

    const id = ++reqId.current;
    setState({ status: "loading", load: meta, docs: [] });

    // Share a single in-flight fetch+rank per key so a hover immediately followed
    // by a click of the SAME segment doesn't fire two queries, and so the result
    // warms the cache even if this consumer has already moved on.
    let job = inflight.get(key);
    if (!job) {
      job = fetchRanked(parts, { index, scope, from, to })
        .then((ranked) => {
          resultCache.set(key, ranked);
          return ranked;
        })
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, job);
    }

    job
      .then((ranked) => {
        if (id !== reqId.current) return; // a newer load won
        setState({ status: "done", load: meta, docs: ranked });
      })
      .catch((e) => {
        if (id !== reqId.current) return;
        setState({ status: "error", load: meta, docs: [] });
      });
  };

  return { state, load };
}

/**
 * Run the OR-group's per-part searches in parallel, union by id, rank by
 * `relevance + log(1 + replyCount)`, and return the top 10. Kept signal-free so a
 * shared in-flight job isn't aborted by one consumer leaving - staleness is
 * handled by the `reqId` guard at the call site, and the completed result still
 * populates the cache for the next hover.
 */
async function fetchRanked(
  parts: string[],
  opts: { index: ReturnType<typeof drillIndex>["index"]; scope: ReturnType<typeof drillIndex>["scope"]; from: string; to: string },
): Promise<HnDoc[]> {
  const lists = await Promise.all(
    parts.map((p) =>
      searchPosts({
        q: p,
        scope: opts.scope,
        index: opts.index,
        from: opts.from,
        to: opts.to,
        sort: "relevance",
        limit: 10,
      }).then((r) => r.docs),
    ),
  );
  // Union the OR-group parts, de-duped by id (a posting matching two parts shows
  // once).
  const seen = new Set<number>();
  const merged: HnDoc[] = [];
  for (const list of lists)
    for (const d of list)
      if (!seen.has(d.id)) {
        seen.add(d.id);
        merged.push(d);
      }
  // Rank by relevance + log(1 + replyCount). `_score` is BM25 from the index;
  // `replies` is the precomputed direct-children count on `hnjobs` (and `ndesc`
  // is the equivalent 0-valued field on `hn`). Prefer `replies` when present so
  // the ranking bites on the dedicated index. Take the top 10 after the merge.
  return rankByDiscussion(
    merged.map((d) => ({
      doc: d,
      relevance: d._score ?? 0,
      replyCount: d.replies ?? d.ndesc ?? 0,
    })),
  )
    .map((x) => x.doc)
    .slice(0, 10);
}
