"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  aggregate,
  friendlyError,
  searchPosts,
  ApiError,
  type HnDoc,
  type SortMode,
} from "@/lib/hn-search";
import { buildShareSearch, parseShareState, type ShareState } from "@/lib/share-url";
import { decodeExamplesWire, type ExamplesWire } from "@/lib/examples-wire";
import { EXAMPLE_GROUPS, COMPARISONS, allExampleTerms } from "@/lib/examples";
import { SLOTS, lastSlotOf, slotOf, slotRange } from "@/lib/trend-time";
import { sortByCoolness } from "@/lib/coolness";
import { outboundUrl, track, trackError, trackOutbound } from "@/lib/analytics";
import { QUERYING_DISABLED, QUERYING_DISABLED_LABEL } from "@/lib/maintenance";
import { TrendChart, type Range, type Series } from "./components/TrendChart";
import { Results } from "./components/Results";
import { CodePanel } from "./components/CodePanel";
import { MiniTrend } from "./components/MiniTrend";
import { DataFreshness } from "./components/DataFreshness";
import { UpstashMark } from "./components/code-bits";

// First series leads with HN orange; the rest are picked for contrast on the
// off-white HN background. Color is assigned by a term's slot in the input row
// so it stays put when other terms are added/removed.
const PALETTE = ["#ff6600", "#1f6feb", "#1a7f37", "#cf222e", "#8250df"];
const MAX_QUERIES = PALETTE.length; // kept in sync with MAX_TERMS in share-url

// Size of the Redis search index (DBSIZE: one hash per HN post/comment).
const CORPUS = "45M";

// Gallery colors: single-term mini-charts are HN orange; comparison charts
// assign these in order (blue first) so the earliest-peaking term reads blue.
const SINGLE_COLOR = "#ff6600";
const COMPARE_COLORS = ["#1f6feb", "#ff6600", "#1a7f37", "#cf222e", "#8250df"];

// How many result rows show before the "Show more" expander.
const PREVIEW_ROWS = 8;

// Typing pause before a term set is committed (queried, put in the URL).
const COMMIT_MS = 500;
// Automatic retries per term for a transiently failed chart aggregate.
const MAX_AGG_RETRIES = 3;

// Terms whose histogram ships in `/examples.json` (lowercase, like the index).
const GALLERY_TERMS = new Set(allExampleTerms());

type Q = { id: string; text: string };
type ChartBucket = { key: number; docCount: number };
const qsKey = (qs: Q[]) => qs.map((q) => `${q.id}:${q.text.trim()}`).join("|");

// A failed call's copy, and whether it's the neutral kill-switch notice.
const errorNote = (e: unknown) => ({
  text: friendlyError(e),
  muted: e instanceof ApiError && e.code === "disabled",
});

// A result doc tagged with the compared term whose query it matched, so the
// merged list can highlight each row by its own term and (when filtered) we know
// which term a row belongs to.
type MergedDoc = HnDoc & { _term: string };

// Terms added after mount get a random id. Initial terms are keyed by index
// instead (see useState below) so SSR and the client agree on hydration. A
// module counter won't do: it resets on HMR while React preserves the queries
// state across the reload, so the next id collides with a live one.
const newId = () => `q-${crypto.randomUUID()}`;

const SORTS: [SortMode, string][] = [
  ["relevance", "relevance"],
  ["score", "most upvoted"],
  ["discussed", "most discussed"],
  ["recent", "newest first"],
];

/**
 * Merge each compared term's result list into one. For "relevance" we round-
 * robin so every term's top hits surface near the top; for the numeric sorts we
 * concatenate and re-sort by the relevant field. Either way we dedupe by id (a
 * post can match several terms), keeping the first occurrence.
 */
function mergeDocs(lists: MergedDoc[][], sort: SortMode): MergedDoc[] {
  let combined: MergedDoc[];
  if (sort === "relevance") {
    combined = [];
    const max = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < max; i++)
      for (const l of lists) if (i < l.length) combined.push(l[i]);
  } else {
    combined = lists.flat();
    const cmp =
      sort === "score"
        ? (a: MergedDoc, b: MergedDoc) => b.score - a.score
        : sort === "discussed"
          ? (a: MergedDoc, b: MergedDoc) => b.ndesc - a.ndesc
          : (a: MergedDoc, b: MergedDoc) =>
              new Date(b.time).getTime() - new Date(a.time).getTime();
    combined.sort(cmp);
  }
  const seen = new Set<number>();
  const out: MergedDoc[] = [];
  for (const d of combined)
    if (!seen.has(d.id)) {
      seen.add(d.id);
      out.push(d);
    }
  return out;
}

export function HackerTrends({ initial }: { initial: ShareState }) {
  // The gallery histograms are fetched AFTER first paint from the CDN-cached
  // `/examples.json` (see that route + page.tsx) rather than blocking the server
  // render. Until they arrive the gallery still renders its full structure -
  // titles, links, stories from the static catalog - with flat sparklines; only
  // the line shapes fill in once this resolves. They also feed the main chart
  // for any catalog term (see `dataFor`).
  const [examplesData, setExamplesData] = useState<ExamplesWire | null>(null);
  const [examplesFailed, setExamplesFailed] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/examples.json", { signal: ctrl.signal })
      .then((r) => {
        if (r.ok) return r.json();
        track("load_error", { scope: "gallery", code: `http_${r.status}` });
        return null;
      })
      .then((d: ExamplesWire | null) => {
        if (d?.terms) setExamplesData(d);
        else setExamplesFailed(true);
      })
      .catch((e) => {
        // sparklines stay flat; catalog terms fall back to live aggregates
        if (ctrl.signal.aborted) return;
        setExamplesFailed(true);
        trackError("gallery", e);
      });
    return () => ctrl.abort();
  }, []);
  const galleryReady = !!examplesData || examplesFailed;

  // All the knobs below are seeded from the URL (parsed server-side and handed
  // in as `initial`), then mirrored back into the URL by the sync effect so the
  // address bar always reproduces the current view.
  const [queries, setQueries] = useState<Q[]>(() =>
    initial.terms.map((text, i) => ({ id: `q${i}`, text })),
  );
  // The term set the chart, results and URL follow: `queries` as typed,
  // committed after a COMMIT_MS pause (or at once on Enter / blur / remove /
  // pick). Every query is a Search DB miss that an abort doesn't cancel, so
  // typing "kubernetes" must be one query, not one per prefix.
  const [committed, setCommitted] = useState<Q[]>(queries);
  // Live histograms, keyed by lowercased term, plus the failure per term
  // (dropped when the term leaves the committed set, see `commit`).
  const [live, setLive] = useState<Record<string, ChartBucket[]>>({});
  const [aggErrs, setAggErrs] = useState<Record<string, unknown>>({});
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commit = useCallback((next: Q[], delay = 0) => {
    clearTimeout(commitTimer.current);
    const apply = () => {
      setCommitted((prev) => (qsKey(prev) === qsKey(next) ? prev : next));
      // Forget failures for terms that left the set, so bringing one back
      // retries it.
      const keep = new Set(next.map((q) => q.text.trim().toLowerCase()));
      setAggErrs((m) => {
        const kept = Object.fromEntries(Object.entries(m).filter(([t]) => keep.has(t)));
        return Object.keys(kept).length === Object.keys(m).length ? m : kept;
      });
    };
    if (delay) commitTimer.current = setTimeout(apply, delay);
    else apply();
  }, []);

  const [sort, setSort] = useState<SortMode>(initial.sort);
  const [range, setRange] = useState<Range | null>(
    initial.from !== undefined && initial.to !== undefined
      ? { fromMs: initial.from, toMs: initial.to }
      : null,
  );
  // Result filters: comments-only, and "only show from <term>" when comparing
  // several terms (else the list is all terms merged).
  const [commentsOnly, setCommentsOnly] = useState<boolean>(
    initial.type === "comment",
  );
  const [termFilter, setTermFilter] = useState<string | null>(
    initial.only ?? null,
  );

  const inflight = useRef(new Set<string>());

  // Latest merged results, tagged with the request they answer; older results
  // stay on screen (dimmed) while a new request is in flight.
  const [results, setResults] = useState<{ key: string; docs: MergedDoc[] } | null>(null);
  const [searchErr, setSearchErr] = useState<{ key: string; e: unknown } | null>(null);
  // The first results run is the URL-seeded load (default terms or a shared
  // link), not a user-initiated search - skip logging it so the GA `search`
  // event counts what people actually look up, not every page open.
  const firstSearch = useRef(true);
  const lastAnalyticsTermsKey = useRef("");
  // The term set whose result list is expanded past the first PREVIEW_ROWS; a
  // new term set collapses back to the preview.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);

  const colorById = useMemo(
    () => Object.fromEntries(queries.map((q, i) => [q.id, PALETTE[i % PALETTE.length]])),
    [queries],
  );

  // The gallery histograms, rebuilt from the compact wire form once, and the
  // slot that was in progress when that cache was built (lines end there).
  const termBuckets = useMemo(
    () => (examplesData ? decodeExamplesWire(examplesData) : {}),
    [examplesData],
  );
  const galleryEnd = useMemo(() => lastSlotOf(termBuckets), [termBuckets]);
  // `/examples.json` falls back to an old baked snapshot on a cache miss; only
  // trust it for the main chart while it reaches the last slot or two.
  const galleryFresh = galleryEnd >= SLOTS - 2;

  /* ---- which terms feed the chart and the result list -------------- */
  const allTerms = useMemo(
    () => committed.map((q) => q.text.trim()).filter(Boolean),
    [committed],
  );
  // The "only show from <term>" filter only applies while that term is actually
  // one of the compared terms; otherwise it's stale and we show everything.
  const filterActive =
    !!termFilter &&
    allTerms.some((t) => t.toLowerCase() === termFilter.toLowerCase());
  const activeTerms = filterActive
    ? allTerms.filter((t) => t.toLowerCase() === termFilter!.toLowerCase())
    : allTerms;
  // Stable string keys for the effects (avoids re-firing on array identity).
  const termsKey = activeTerms.join("|");
  const queryTermsKey = allTerms.join("|");
  const chartKey = allTerms.map((t) => t.toLowerCase()).join("|");

  const fromIso = range ? new Date(range.fromMs).toISOString() : undefined;
  const toIso = range ? new Date(range.toMs).toISOString() : undefined;
  const searchKey = [termsKey, sort, fromIso, toIso, commentsOnly].join("\n");
  // The single term whose live SDK snippet the code panel shows.
  const codeTerm = activeTerms[0] ?? "";

  /* ---- keep the URL in sync so the view is shareable --------------- */
  useEffect(() => {
    const next = buildShareSearch({
      terms: allTerms,
      sort,
      from: range?.fromMs,
      to: range?.toMs,
      type: commentsOnly ? "comment" : undefined,
      only: filterActive ? termFilter! : undefined,
    });
    // GA counts every history change as a page_view, so write only when the
    // address bar doesn't already encode this view (the first render, or a bare
    // "/" still showing the default terms), and let rapid clicks settle first.
    const cur = buildShareSearch(
      parseShareState(new URLSearchParams(window.location.search)),
    );
    if (next === cur) return;
    const t = setTimeout(() => {
      // replaceState (not the Next router): no navigation/refetch, no history entry.
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${next ? `?${next}` : ""}`,
      );
    }, COMMIT_MS);
    return () => clearTimeout(t);
  }, [allTerms, sort, range, commentsOnly, termFilter, filterActive]);

  /* ---- chart data: gallery histograms first, live aggregates else -- */
  // A catalog term's histogram is already in `/examples.json` (the same
  // aggregate, refreshed daily), so it never costs a live query: the default
  // openai/anthropic view was ~49% of launch traffic. A stale gallery (the
  // snapshot fallback) still backs up a failed aggregate, or disabled mode.
  const dataFor = useCallback(
    (term: string): { buckets: ChartBucket[]; endSlot?: number } | null => {
      const k = term.toLowerCase();
      const cached = termBuckets[k]?.length ? { buckets: termBuckets[k], endSlot: galleryEnd } : null;
      if (cached && galleryFresh) return cached;
      if (live[k]) return { buckets: live[k] };
      return cached && (k in aggErrs || QUERYING_DISABLED) ? cached : null;
    },
    [termBuckets, galleryEnd, galleryFresh, live, aggErrs],
  );

  useEffect(() => {
    // Querying disabled: the chart reads cached `termBuckets` only.
    if (QUERYING_DISABLED) return;
    for (const t of chartKey ? chartKey.split("|") : []) {
      if (dataFor(t) || inflight.current.has(t) || t in aggErrs) continue;
      // Catalog term: wait for the gallery rather than racing it with a query.
      if (GALLERY_TERMS.has(t) && !galleryReady) continue;
      inflight.current.add(t);
      // No abort: the server runs the query regardless, so keep the result.
      // Busy / rate-limited answers are load shedding, so re-ask a few times
      // with backoff. The error (and any stale gallery fallback) stays on
      // screen meanwhile; a success replaces it via `live`.
      const run = (n: number): Promise<void> =>
        aggregate({ q: t })
          .then((r) => setLive((m) => ({ ...m, [t]: r.buckets })))
          .catch((e) => {
            setAggErrs((m) => ({ ...m, [t]: e }));
            trackError("chart", e, n);
            const shed = e instanceof ApiError && (e.code === "busy" || e.code === "rate_limited");
            if (shed && n < MAX_AGG_RETRIES) {
              return new Promise<void>((r) => setTimeout(r, 2000 * 2 ** n + Math.random() * 1000)).then(
                () => run(n + 1),
              );
            }
          });
      run(0).finally(() => inflight.current.delete(t));
    }
  }, [chartKey, dataFor, galleryReady, aggErrs]);

  /* ---- merged results across the active terms, scoped to filters --- */
  useEffect(() => {
    if (QUERYING_DISABLED) return; // no live result drill-down while disabled
    const terms = termsKey ? termsKey.split("|") : [];
    if (terms.length === 0) return;

    const queryTerms = queryTermsKey ? queryTermsKey.split("|") : [];
    let shouldTrack = false;
    if (firstSearch.current) {
      firstSearch.current = false;
      lastAnalyticsTermsKey.current = queryTermsKey;
    } else {
      shouldTrack =
        queryTerms.length > 0 && lastAnalyticsTermsKey.current !== queryTermsKey;
    }

    const key = [termsKey, sort, fromIso, toIso, commentsOnly].join("\n");
    const ctrl = new AbortController();
    Promise.all(
      terms.map((term) =>
        searchPosts({
          q: term,
          sort,
          limit: 30,
          from: fromIso,
          to: toIso,
          type: commentsOnly ? "comment" : undefined,
          signal: ctrl.signal,
        }).then((s) => s.docs.map((d) => ({ ...d, _term: term }) as MergedDoc)),
      ),
    )
      .then((lists) => {
        if (ctrl.signal.aborted) return;
        const merged = mergeDocs(lists, sort);
        setResults({ key, docs: merged });
        // Only the current request can land here (older ones are aborted), so
        // any error on screen is stale now.
        setSearchErr(null);
        if (shouldTrack) {
          const label = queryTerms.join(" vs ");
          track("search", { terms: label, term_count: queryTerms.length, sort });
          if (queryTerms.length > 1) {
            track("compare", { terms: label, term_count: queryTerms.length });
          }
          if (merged.length === 0) track("zero_results", { terms: label, sort });
          lastAnalyticsTermsKey.current = queryTermsKey;
        }
      })
      .catch((e) => {
        if (ctrl.signal.aborted || e?.name === "AbortError") return;
        setSearchErr({ key, e });
        trackError("results", e);
      });
    return () => ctrl.abort();
  }, [termsKey, queryTermsKey, sort, fromIso, toIso, commentsOnly]);

  const hasTerms = activeTerms.length > 0;
  const searchError = hasTerms && searchErr?.key === searchKey ? searchErr.e : null;
  const searching =
    hasTerms && !QUERYING_DISABLED && results?.key !== searchKey && !searchError;
  const docs = hasTerms ? results?.docs ?? [] : [];
  const expanded = expandedFor === termsKey;

  /* ---- chart series ------------------------------------------------ */
  const series: Series[] = useMemo(
    () =>
      committed
        .filter((q) => q.text.trim())
        .map((q, i) => {
          const d = dataFor(q.text.trim());
          return {
            id: q.id,
            text: q.text.trim(),
            color: colorById[q.id] ?? PALETTE[i % PALETTE.length],
            buckets: d?.buckets ?? [],
            endSlot: d?.endSlot,
          };
        }),
    [committed, dataFor, colorById],
  );
  const failedTerm = allTerms.find(
    (t) => !dataFor(t) && t.toLowerCase() in aggErrs,
  );
  const chartError = failedTerm ? aggErrs[failedTerm.toLowerCase()] : null;
  const chartLoading = allTerms.some((t) => {
    const k = t.toLowerCase();
    if (dataFor(t) || k in aggErrs) return false;
    // Disabled: only the gallery can still arrive.
    return QUERYING_DISABLED ? GALLERY_TERMS.has(k) && !galleryReady : true;
  });

  /* ---- input row mutations ----------------------------------------- */
  const updateQuery = (id: string, text: string) => {
    const next = queries.map((q) => (q.id === id ? { ...q, text } : q));
    setQueries(next);
    commit(next, COMMIT_MS);
  };
  const removeQuery = (id: string) => {
    if (queries.length <= 1) return;
    const next = queries.filter((q) => q.id !== id);
    setQueries(next);
    commit(next);
  };
  const addQuery = (text = "") => {
    if (queries.length >= MAX_QUERIES) return;
    setQueries([...queries, { id: newId(), text }]);
  };

  // Load a gallery example's term(s) in place and jump back to the top, clearing
  // any active filters/range so the fresh comparison shows from scratch.
  // useCallback (only setters, refs and the stable `commit` inside) keeps this
  // identity fixed across renders so the React.memo'd sparklines that receive it
  // as `onPick` don't all re-render when an unrelated bit of state changes.
  const pickTerms = useCallback(
    (terms: string[]) => {
      const picked = terms
        .slice(0, MAX_QUERIES)
        .map((text, i) => ({ id: `q${i}`, text }));
      track("example_pick", {
        terms: terms.slice(0, MAX_QUERIES).join(" vs "),
        term_count: picked.length,
      });
      setQueries(picked);
      commit(picked);
      setTermFilter(null);
      setCommentsOnly(false);
      setRange(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [commit],
  );

  // "newest first" doesn't make sense once you've scoped to a window, so its tab
  // is disabled while a range is set. If it happened to be the active sort when
  // the range is picked, fall back to relevance so we never sit on a sort whose
  // tab is greyed out.
  const selectRange = (r: Range | null) => {
    setRange(r);
    if (r && sort === "recent") setSort("relevance");
  };

  // Comments carry no upvote score and no descendant count of their own (HN
  // doesn't expose either - see scripts/ingest.ts), so "most upvoted" and "most
  // discussed" both sort comments by all-zeros. Disable them while comments-only
  // is on, and if one was the active sort, fall back to relevance.
  const toggleCommentsOnly = () =>
    setCommentsOnly((v) => {
      const next = !v;
      if (next && (sort === "score" || sort === "discussed")) setSort("relevance");
      track("filter_toggle", {
        kind: "comments_only",
        value: "comments",
        active: next,
      });
      return next;
    });

  // Clicking a result's timestamp scopes the view to the chart slot (30d
  // histogram bucket) that contains the post, i.e. the bar it was counted in.
  const pickMonth = (iso: string) => selectRange(slotRange(slotOf(new Date(iso).getTime())));

  // The gallery's comparisons, ranked by the internal "coolness" metric, with
  // the vercel-vs-cloudflare matchup pinned to the front regardless of score.
  const comparisons = useMemo(() => {
    // Before the histograms load, every coolness score is 0 so this is a no-op
    // (stable sort keeps the curated order); it re-ranks once data arrives.
    const ranked = sortByCoolness(COMPARISONS, termBuckets);
    const pinnedKey = "vercel|cloudflare";
    const pinned = ranked.filter((c) => c.terms.join("|") === pinnedKey);
    const rest = ranked.filter((c) => c.terms.join("|") !== pinnedKey);
    return [...pinned, ...rest];
  }, [termBuckets]);

  // Precompute the gallery's per-card MiniSeries ONCE per data change. The
  // sparklines are React.memo'd, so as long as their `series` prop keeps a
  // stable identity between renders they skip re-rendering (and re-densifying)
  // entirely - that's what takes the comparison-click interaction from ~400ms
  // (re-pathing all ~190 charts) down to a cheap parent re-render.
  const comparisonItems = useMemo(
    () =>
      comparisons.map((c) => ({
        key: c.terms.join("|"),
        story: c.story,
        series: c.terms.map((term, i) => ({
          term,
          color: COMPARE_COLORS[i % COMPARE_COLORS.length],
          buckets: termBuckets[term] ?? [],
          endSlot: galleryEnd,
        })),
      })),
    [comparisons, termBuckets, galleryEnd],
  );
  const groupItems = useMemo(
    () =>
      EXAMPLE_GROUPS.map((g) => ({
        id: g.id,
        title: g.title,
        blurb: g.blurb,
        items: g.terms.map((term) => ({
          term,
          series: [
            { term, color: SINGLE_COLOR, buckets: termBuckets[term] ?? [], endSlot: galleryEnd },
          ],
        })),
      })),
    [termBuckets, galleryEnd],
  );

  const visibleDocs = expanded ? docs : docs.slice(0, PREVIEW_ROWS);
  const hiddenCount = docs.length - PREVIEW_ROWS;

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      {/* The page's primary heading. Kept sr-only so the compact wordmark in the
          header carries the visual brand, while crawlers and screen readers still
          get a single, keyword-rich <h1> for the page. */}
      <h1 className="sr-only">
        Hacker Trends - see how any topic, tool, or person trended across 18
        years of Hacker News
      </h1>
      {/* Header bar -------------------------------------------------- */}
      <div className="hn-header flex items-center gap-2 px-2 py-[3px]">
        <span className="hn-logo">T</span>
        <Link href="/" className="font-bold text-[12px] whitespace-nowrap shrink-0">
          Hacker Trends
        </Link>
        <span className="text-[10px] opacity-80 hidden sm:block min-w-0 truncate">
          | see how any topic, tool, or person trended across 18 years of
          Hacker News
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a
            href={outboundUrl("https://upstash.com/docs/redis/search", "header")}
            target="_blank"
            rel="noopener"
            className="hidden md:inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap hover:underline"
            onClick={() => trackOutbound("upstash", "header")}
          >
            <UpstashMark />
            Built on Upstash Redis Search ↗
          </a>
          <Link
            href="/who-is-hiring"
            className="text-[11px] font-semibold whitespace-nowrap hover:underline"
            title="Trends in the monthly Hacker News “Who is hiring?” threads"
          >
            Who&apos;s hiring? →
          </Link>
          <DataFreshness />
          <ShareButton terms={allTerms} />
        </div>
      </div>

      {/* One-paragraph pitch ----------------------------------------- */}
      <div className="px-3 pt-3">
        <p className="text-[11px] text-[color:var(--hn-subtle)] max-w-[760px] leading-relaxed">
          Charts how often any topic, tool, or person has come up on Hacker
          News. Overlay a few terms to watch their traction rise and fall.
          Each line is a live date-histogram over 45M posts and comments,
          built on{" "}
          <a
            href={outboundUrl("https://upstash.com/docs/redis/search", "pitch")}
            target="_blank"
            rel="noopener"
            className="text-[color:var(--hn-orange)] font-semibold whitespace-nowrap"
            onClick={() => trackOutbound("upstash", "pitch")}
          >
            <span
              className="inline-block mr-1"
              style={{ verticalAlign: "-0.18em" }}
            >
              <UpstashMark />
            </span>
            Upstash Redis Search
          </a>
          . Below the chart sit the actual stories and comments behind the
          lines, filterable by term.{" "}
          {/* Crawlable internal link, but visually hidden (sr-only): it stays
              in the HTML for SEO/screen readers without surfacing the page to
              regular visitors. */}
          <Link href="/how-it-works" className="sr-only">
            How Hacker Trends works
          </Link>
        </p>
      </div>

      {/* Compare input row (doubles as the chart legend) ------------- */}
      <div className="bg-[color:var(--hn-bg)] px-2 pt-3">
        <div className="flex flex-wrap items-stretch gap-2">
          {queries.map((q, i) => (
            <div
              key={q.id}
              className="trend-chip"
              style={{ borderColor: colorById[q.id] }}
            >
              <span
                className="trend-dot"
                style={{ background: colorById[q.id] }}
              />
              <input
                value={q.text}
                placeholder="add a term…"
                aria-label={`term ${i + 1}`}
                // Disabled: the chips become a read-only legend for the picked
                // example; free-text search is off while the DB is down.
                readOnly={QUERYING_DISABLED}
                onChange={(e) => updateQuery(q.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(queries);
                }}
                onBlur={() => commit(queries)}
              />
              {!QUERYING_DISABLED && queries.length > 1 && (
                <button
                  className="trend-x"
                  title="remove term"
                  aria-label="remove term"
                  onClick={() => removeQuery(q.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {!QUERYING_DISABLED && queries.length < MAX_QUERIES && (
            <button className="trend-add" onClick={() => addQuery()}>
              + add term
            </button>
          )}
        </div>
      </div>

      {/* Trend chart ------------------------------------------------- */}
      <div className="px-2 pt-2">
        <TrendChart
          series={series}
          range={range}
          onSelectRange={selectRange}
          loading={chartLoading}
          note={chartError ? errorNote(chartError) : null}
        />
      </div>

      {/* Live SDK code behind the current view ----------------------- */}
      <div className="px-2 pt-2">
        <CodePanel
          q={codeTerm}
          sort={sort}
          from={fromIso}
          to={toIso}
          type={commentsOnly ? "comment" : undefined}
        />
      </div>

      {/* ---- everything below the chart is about the results ---- */}
      {QUERYING_DISABLED ? (
        // DB down: no live drill-down. A plain gray note (NOT an error) where the
        // results would be; the chart above still works off the cached gallery.
        <div className="px-3 pt-3 pb-8 text-[12px] text-[color:var(--hn-subtle)]">
          {QUERYING_DISABLED_LABEL}
        </div>
      ) : (
        <>
      {/* sort tabs + the "scale" footnote */}
      <div className="px-2 pt-2">
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 py-1">
          <div className="hn-tabs flex items-center flex-wrap gap-1">
            {SORTS.map(([k, label]) => {
              // "newest first" is meaningless once a date range scopes the view;
              // "most upvoted" / "most discussed" are meaningless for comments,
              // which carry no score and no comment-count of their own.
              const disabledByRange = k === "recent" && range !== null;
              const disabledByComments =
                commentsOnly && (k === "score" || k === "discussed");
              const disabled = disabledByRange || disabledByComments;
              const title = disabledByComments
                ? k === "score"
                  ? "Hacker News keeps comment scores private, so there's nothing to rank comments by"
                  : "Comments don't carry a comment-count of their own, so there's nothing to rank them by"
                : disabledByRange
                  ? "clear the date range to sort by newest"
                  : undefined;
              return (
                <button
                  key={k}
                  className={sort === k ? "active" : ""}
                  disabled={disabled}
                  title={title}
                  onClick={() => {
                    setSort(k);
                    track("sort_change", { sort: k });
                  }}
                >
                  {label}
                </button>
              );
            })}
            {/* "only comments" rides the same tab strip - it's a filter, not a
                sort, so a divider sets it apart from the four sort tabs. */}
            <span className="tab-divider" aria-hidden="true" />
            <button
              className={commentsOnly ? "active" : ""}
              title="show only comments (hide stories)"
              onClick={toggleCommentsOnly}
            >
              only comments
            </button>
          </div>
          {searchError ? (
            // a failed search: one line in this always-present row, so nothing
            // below shifts; the previous results (if any) stay listed.
            <span
              className={`ml-auto truncate text-[10px] ${
                errorNote(searchError).muted ? "text-[color:var(--hn-subtle)]" : "text-red-600"
              }`}
            >
              {errorNote(searchError).text}
            </span>
          ) : (
            !searching &&
            docs.length > 0 && (
              // a fun "scale" footnote - desktop-only so it doesn't crowd a phone.
              <span className="ml-auto hidden sm:inline whitespace-nowrap text-[10px] text-[color:var(--hn-subtle)]">
                {CORPUS} keys queried
              </span>
            )
          )}
        </div>
      </div>

      {/* filters: narrow the merged list by term (comments-only lives in the
          sort-tab strip above). Only shown when comparing several terms - a
          single term has nothing to filter down to. */}
      {series.length > 1 && (
        <div className="px-2 pt-1">
          <div className="filters-row">
            <span className="filters-label">show</span>
            {series.map((s) => {
              const on = filterActive && termFilter!.toLowerCase() === s.text.toLowerCase();
              return (
                <button
                  key={s.id}
                  className="filter-toggle"
                  data-active={on}
                  style={{ borderColor: s.color }}
                  title={on ? "show all terms again" : `only show posts matching “${s.text}”`}
                  onClick={() =>
                    setTermFilter((cur) => {
                      const next =
                        cur && cur.toLowerCase() === s.text.toLowerCase()
                          ? null
                          : s.text;
                      track("filter_toggle", {
                        kind: "term",
                        value: s.text,
                        active: next !== null,
                      });
                      return next;
                    })
                  }
                >
                  <span className="trend-dot" style={{ background: s.color }} />
                  {s.text}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Results ----------------------------------------------------- */}
      {/* Reserve roughly a preview's worth of height so the list growing from
          empty → "searching…" → ~8 rows doesn't shove the gallery below it
          down on load (that growth was the bulk of the page's CLS). */}
      <div
        className="bg-[color:var(--hn-bg)] px-2 pb-6"
        style={{ minHeight: allTerms.length > 0 ? 300 : 0 }}
      >
        {searching && docs.length === 0 ? (
          <div className="px-3 py-6 text-[color:var(--hn-subtle)] text-sm">
            searching…
          </div>
        ) : searchError && docs.length === 0 ? null : (
          // The previous list stays (dimmed) while a new search is in flight or
          // after it failed, instead of blanking the page.
          <div style={{ opacity: results && results.key !== searchKey ? 0.5 : 1 }}>
            <Results
              docs={visibleDocs}
              query={codeTerm}
              matchOf={(d) => (d as MergedDoc)._term}
              onPickMonth={pickMonth}
            />
            {!expanded && hiddenCount > 0 && (
              <button className="lot-more" onClick={() => setExpandedFor(termsKey)}>
                Show more ↓
              </button>
            )}
          </div>
        )}
      </div>
        </>
      )}

      {/* Popular Comparisons: the trend gallery, now an in-page picker ---- */}
      <section className="gallery-section px-3 pt-4">
        <div className="flex items-baseline gap-2 border-b border-[color:var(--hn-subtle)] pb-1 mb-3">
          <h2 className="text-[13px] font-bold">Popular Comparisons</h2>
          <span className="text-[10px] text-[color:var(--hn-subtle)]">
            click to load above
          </span>
        </div>
        <div className="mini-grid mini-grid--wide">
          {comparisonItems.map((c) => (
            <MiniTrend
              key={c.key}
              series={c.series}
              story={c.story}
              onPick={pickTerms}
            />
          ))}
        </div>
      </section>

      {groupItems.map((g, gi) => (
        <section
          key={g.id}
          id={g.id}
          className={`gallery-section px-3 pt-10${gi === groupItems.length - 1 ? " pb-12" : ""}`}
        >
          <div className="flex items-baseline gap-2 border-b border-[color:var(--hn-subtle)] pb-1 mb-3">
            <h2 className="text-[13px] font-bold lowercase">{g.title}</h2>
            <span className="text-[10px] text-[color:var(--hn-subtle)]">{g.blurb}</span>
          </div>
          <div className="mini-grid">
            {g.items.map((it) => (
              <MiniTrend key={it.term} series={it.series} onPick={pickTerms} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// Copies the current address bar, which the sync effect keeps pointed at the
// exact view, so it can be pasted to share these terms + filters with someone.
// The copy carries UTM params so visits from shared links show up as their own
// source in GA instead of blending into direct traffic; the sync effect leaves
// them in place on landing (it only rewrites when the view itself differs).
function ShareButton({ terms }: { terms: string[] }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    track("share", { terms: terms.join(" vs "), term_count: terms.length });
    const url = new URL(window.location.href);
    url.searchParams.set("utm_source", "share");
    url.searchParams.set("utm_medium", "link");
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (insecure context / denied), leave the URL for the
      // user to copy from the address bar manually.
    }
  };
  return (
    <button
      className="share-link"
      data-copied={copied}
      onClick={copy}
      aria-label="copy a link to this view"
      title={copied ? "link copied" : "copy a link to this view"}
    >
      {copied ? (
        // checkmark, for a beat of "copied" feedback
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        // chain-link icon, the conventional "copy link / share" glyph
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
      <span>{copied ? "copied" : "share"}</span>
    </button>
  );
}
