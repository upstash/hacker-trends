"use client";

/**
 * Imperative data hook for the comment drill-down (T09).
 *
 * Given a segment (a term in one calendar month, from the chart), this loads
 * that series' actual job postings for that month, date-ranged to the month on
 * the jobs index. On `hnjobs` the server already ranks by
 * `relevance + log(1 + replies)` (`scoreFunc`, see `rankKey` in jobs-trends.ts),
 * so a single-part series keeps the server order; an OR-group merges its parts'
 * pages by that same `_score`.
 *
 * The LAST hover/click stays on screen until the next one replaces it: a stale
 * response can never overwrite a newer one (guarded by a monotonic request id),
 * but we never clear on mouse-leave - that would make the panel flicker as the
 * cursor crosses the dense bars.
 *
 * PAGINATION: "Load more" asks each part for its NEXT page (`offset`), and
 * appends, so every page is its own deterministic, cacheable `/api/hn` URL. A
 * failed page keeps the postings already on screen.
 *
 * CACHING: an in-memory `resultCache` holds each segment's accumulated postings
 * (first page plus any loaded-more pages), served SYNCHRONOUSLY on a repeat
 * hover/click (0ms, no `loading` flash). In-flight first pages are deduped by
 * key, and a started fetch warms the cache even if its consumer has moved on.
 */

import { useCallback, useRef, useState } from "react";
import { searchPosts, friendlyError, type HnDoc } from "@/lib/hn-search";
import { trackError } from "@/lib/analytics";
import { currentMonthIndex, monthIndex, parseParts } from "@/lib/jobs-trends";
import { drillIndex } from "@/lib/jobs-index";
import { QUERYING_DISABLED } from "@/lib/maintenance";

/** Initial number of postings a drill-down loads (per OR-group part). */
const PAGE = 12;
/** How many more the "Load more" button pulls in each press (per part). */
const PAGE_STEP = 16;
/** Hard cap so a dense month can't be paged forever. */
const PAGE_MAX = 80;

/** One segment's accumulated result: the merged postings, each part's next
 *  offset, and whether any part may have more. */
type Accum = {
  docs: HnDoc[];
  offsets: Record<string, number>;
  more: Record<string, boolean>;
};

const resultCache = new Map<string, Accum>();
const inflight = new Map<string, Promise<Accum>>();

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
  /** human label for the month, e.g. "Apr 2021" (+ "so far" when in progress). */
  periodLabel: string;
  year: number;
  /** 0-based month. */
  month: number;
  /** the segment's posting count from the chart, when known. */
  value?: number;
};

export type CommentsState = {
  status: "idle" | "loading" | "done" | "error";
  load: CommentLoad | null;
  docs: HnDoc[];
  /** true when some part may have more postings (and we're under `PAGE_MAX`). */
  hasMore: boolean;
  /** true while a "Load more" fetch is in flight (the current docs stay visible). */
  loadingMore: boolean;
  /** friendly message for a failed first page (status "error") or load-more. */
  error: string | null;
};

const IDLE: CommentsState = {
  status: "idle",
  load: null,
  docs: [],
  hasMore: false,
  loadingMore: false,
  error: null,
};

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
  /** the segment's count, shown in the panel header. */
  value?: number;
};

function hasMoreOf(a: Accum): boolean {
  return a.docs.length < PAGE_MAX && Object.values(a.more).some(Boolean);
}

/** Merge new docs after `prev`, de-duped by id. Several parts' pages are
 *  interleaved by `_score` (the server's reply-aware relevance). */
function mergeDocs(prev: HnDoc[], lists: HnDoc[][]): HnDoc[] {
  const seen = new Set(prev.map((d) => d.id));
  const fresh: HnDoc[] = [];
  for (const list of lists)
    for (const d of list)
      if (!seen.has(d.id)) {
        seen.add(d.id);
        fresh.push(d);
      }
  if (lists.length > 1) fresh.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
  return [...prev, ...fresh];
}

type Seg = {
  args: LoadArgs;
  meta: CommentLoad;
  parts: string[];
  key: string;
  from: string;
  to: string;
};

/** Fetch one page per part (only the parts that may have more), starting at
 *  each part's offset, and fold it into `prev`. */
async function fetchPage(seg: Seg, prev: Accum | null, limit: number): Promise<Accum> {
  const { index, scope } = drillIndex();
  const base: Accum = prev ?? { docs: [], offsets: {}, more: {} };
  const parts = prev ? seg.parts.filter((p) => base.more[p]) : seg.parts;
  const lists = await Promise.all(
    parts.map((p) =>
      searchPosts({
        q: p,
        scope,
        index,
        from: seg.from,
        to: seg.to,
        sort: "relevance",
        limit,
        offset: base.offsets[p] ?? 0,
      }).then((r) => r.docs),
    ),
  );
  const offsets = { ...base.offsets };
  const more = { ...base.more };
  parts.forEach((p, i) => {
    offsets[p] = (offsets[p] ?? 0) + lists[i].length;
    more[p] = lists[i].length >= limit;
  });
  const docs = mergeDocs(base.docs, lists).slice(0, PAGE_MAX);
  // A page that added nothing new (e.g. an endpoint that ignores `offset`)
  // means we're done, whatever the page size said.
  if (prev && docs.length === base.docs.length) for (const p of parts) more[p] = false;
  return { docs, offsets, more };
}

export function useJobComments() {
  const [state, setState] = useState<CommentsState>(IDLE);
  // A monotonic id stamps each load; only the result of the LATEST id may land.
  // Shared in-flight jobs outlive a single consumer (they still warm the cache
  // for the next hover), so staleness is handled here, not by aborting.
  const reqId = useRef(0);
  // The segment currently shown, for "Load more" / retry.
  const current = useRef<Seg | null>(null);

  const load = useCallback((args: LoadArgs) => {
    // Querying disabled: no live posting fetch. Stay idle; the panel renders a
    // plain gray "querying is disabled" note (see JobsComments `disabled`).
    if (QUERYING_DISABLED) return;
    const parts = parseParts(args.label);
    if (parts.length === 0) return;

    const partial = monthIndex(args.year, args.month) === currentMonthIndex();
    const meta: CommentLoad = {
      label: args.label,
      parts,
      color: args.color,
      periodLabel: `${MONTH_ABBR[args.month]} ${args.year}${partial ? " (so far)" : ""}`,
      year: args.year,
      month: args.month,
      value: args.value,
    };
    const from = new Date(args.fromMs).toISOString();
    const to = new Date(args.toMs).toISOString();
    const { index, scope } = drillIndex();
    const seg: Seg = { args, meta, parts, key: cacheKey(index, scope, parts, from, to), from, to };
    current.current = seg;

    const settle = (a: Accum) =>
      setState({
        status: "done",
        load: meta,
        docs: a.docs,
        hasMore: hasMoreOf(a),
        loadingMore: false,
        error: null,
      });

    // FAST PATH: this segment is already loaded (with any extra pages). Show it
    // synchronously; bump the id so an older in-flight load can't clobber it.
    const cached = resultCache.get(seg.key);
    if (cached) {
      reqId.current++;
      settle(cached);
      return;
    }

    const id = ++reqId.current;
    setState({ ...IDLE, status: "loading", load: meta });

    let job = inflight.get(seg.key);
    if (!job) {
      job = fetchPage(seg, null, PAGE)
        .then((a) => {
          resultCache.set(seg.key, a);
          return a;
        })
        .finally(() => inflight.delete(seg.key));
      inflight.set(seg.key, job);
    }
    job
      .then((a) => {
        if (id === reqId.current) settle(a);
      })
      .catch((e) => {
        if (id !== reqId.current) return;
        setState({ ...IDLE, status: "error", load: meta, error: friendlyError(e) });
        trackError("jobs_comments", e);
      });
  }, []);

  /** Pull the next page of postings for the segment already on screen. */
  const loadMore = useCallback(() => {
    const seg = current.current;
    const prev = seg ? resultCache.get(seg.key) : undefined;
    if (!seg || !prev || !hasMoreOf(prev)) return;
    const id = ++reqId.current;
    setState((s) => ({ ...s, loadingMore: true, error: null }));
    fetchPage(seg, prev, PAGE_STEP)
      .then((a) => {
        resultCache.set(seg.key, a);
        if (id !== reqId.current) return;
        setState((s) => ({ ...s, docs: a.docs, hasMore: hasMoreOf(a), loadingMore: false }));
      })
      .catch((e) => {
        if (id !== reqId.current) return;
        // Keep the postings already on screen; just surface the failure.
        setState((s) => ({ ...s, loadingMore: false, error: friendlyError(e) }));
        trackError("jobs_comments", e);
      });
  }, []);

  /** Re-run whatever failed: the first page, or the last "Load more". */
  const retry = useCallback(() => {
    const seg = current.current;
    if (!seg) return;
    if (resultCache.has(seg.key)) loadMore();
    else load(seg.args);
  }, [load, loadMore]);

  return { state, load, loadMore, retry };
}
