"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  aggregate,
  searchPosts,
  type AggResponse,
  type HnDoc,
  type SortMode,
} from "@/lib/hn-search";
import { buildShareSearch, type ShareState } from "@/lib/share-url";
import type { ExamplesData } from "@/lib/examples-data";
import { EXAMPLE_GROUPS, COMPARISONS } from "@/lib/examples";
import { sortByCoolness } from "@/lib/coolness";
import { TrendChart, type Range, type Series } from "./components/TrendChart";
import { Results } from "./components/Results";
import { CodePanel } from "./components/CodePanel";
import { MiniTrend } from "./components/MiniTrend";
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

type Q = { id: string; text: string };

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

export function HackerTrends({
  initial,
  examplesData,
}: {
  initial: ShareState;
  examplesData: ExamplesData;
}) {
  // All the knobs below are seeded from the URL (parsed server-side and handed
  // in as `initial`), then mirrored back into the URL by the sync effect so the
  // address bar always reproduces the current view.
  const [queries, setQueries] = useState<Q[]>(() =>
    initial.terms.map((text, i) => ({ id: `q${i}`, text })),
  );
  const [aggs, setAggs] = useState<Record<string, AggResponse>>({});
  // True while the date-histograms for the current terms are in flight, so the
  // chart can show a loading state on first paint instead of the empty prompt.
  const [aggsLoading, setAggsLoading] = useState(true);

  const [sort, setSort] = useState<SortMode>(initial.sort);
  const [range, setRange] = useState<Range | null>(
    initial.from !== undefined && initial.to !== undefined
      ? { fromMs: initial.from, toMs: initial.to }
      : null,
  );
  // Result filters: a single author, comments-only, and "only show from <term>"
  // when comparing several terms (else the list is all terms merged).
  const [byAuthor, setByAuthor] = useState<string | null>(initial.author ?? null);
  const [commentsOnly, setCommentsOnly] = useState<boolean>(
    initial.type === "comment",
  );
  const [termFilter, setTermFilter] = useState<string | null>(
    initial.only ?? null,
  );

  const [docs, setDocs] = useState<MergedDoc[]>([]);
  const [authors, setAuthors] = useState<{ key: string; docCount: number }[]>([]);
  // The term-set the current `docs` belong to; lets the results effect tell a
  // genuinely new comparison (blank + reload) from a same-terms refetch.
  const lastTermsKey = useRef("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the result list is expanded past the first PREVIEW_ROWS.
  const [expanded, setExpanded] = useState(false);

  const colorById = useMemo(
    () => Object.fromEntries(queries.map((q, i) => [q.id, PALETTE[i % PALETTE.length]])),
    [queries],
  );

  /* ---- which terms feed the result list ---------------------------- */
  const allTerms = useMemo(
    () => queries.map((q) => q.text.trim()).filter(Boolean),
    [queries],
  );
  // The "only show from <term>" filter only applies while that term is actually
  // one of the compared terms; otherwise it's stale and we show everything.
  const filterActive =
    !!termFilter &&
    allTerms.some((t) => t.toLowerCase() === termFilter.toLowerCase());
  const activeTerms = filterActive
    ? allTerms.filter((t) => t.toLowerCase() === termFilter!.toLowerCase())
    : allTerms;
  // Stable string key for the effects (avoids re-firing on array identity).
  const termsKey = activeTerms.join("|");

  const fromIso = range ? new Date(range.fromMs).toISOString() : undefined;
  const toIso = range ? new Date(range.toMs).toISOString() : undefined;
  // The single term whose live SDK snippet the code panel shows.
  const codeTerm = activeTerms[0] ?? "";

  /* ---- keep the URL in sync so the view is shareable --------------- */
  useEffect(() => {
    const search = buildShareSearch({
      terms: allTerms,
      sort,
      from: range?.fromMs,
      to: range?.toMs,
      author: byAuthor ?? undefined,
      type: commentsOnly ? "comment" : undefined,
      only: filterActive ? termFilter! : undefined,
      active: 0,
    });
    const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
    // replaceState (not the Next router): update the address bar without a
    // navigation/refetch or piling a history entry on every keystroke.
    window.history.replaceState(null, "", url);
  }, [allTerms, sort, range, byAuthor, commentsOnly, termFilter, filterActive]);

  /* ---- aggregations: one date-histogram per non-empty term --------- */
  useEffect(() => {
    const ctrl = new AbortController();
    const active = queries.filter((q) => q.text.trim());
    if (active.length === 0) {
      setAggs({});
      setAggsLoading(false);
      return;
    }
    setAggsLoading(true);
    const t = setTimeout(async () => {
      try {
        const results = await Promise.all(
          active.map((q) => aggregate({ q: q.text, signal: ctrl.signal })),
        );
        if (ctrl.signal.aborted) return;
        const map: Record<string, AggResponse> = {};
        active.forEach((q, i) => {
          map[q.id] = results[i];
        });
        setAggs(map);
        setAggsLoading(false);
        setError(null);
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setError((e as Error).message);
          setAggsLoading(false);
        }
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [queries]);

  /* ---- merged results across the active terms, scoped to filters --- */
  useEffect(() => {
    const terms = termsKey ? termsKey.split("|") : [];
    if (terms.length === 0) {
      setDocs([]);
      setSearching(false);
      lastTermsKey.current = "";
      return;
    }
    // A genuinely new term-set → drop old docs so the list shows its loading
    // state and collapses back to the preview. Sort / filter changes keep the
    // old docs visible to avoid flicker mid-refetch.
    if (lastTermsKey.current !== termsKey) {
      setDocs([]);
      setExpanded(false);
      lastTermsKey.current = termsKey;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      Promise.all(
        terms.map((term) =>
          searchPosts({
            q: term,
            sort,
            limit: 30,
            from: fromIso,
            to: toIso,
            by: byAuthor ?? undefined,
            type: commentsOnly ? "comment" : undefined,
            signal: ctrl.signal,
          }).then((s) => s.docs.map((d) => ({ ...d, _term: term }) as MergedDoc)),
        ),
      )
        .then((lists) => {
          if (ctrl.signal.aborted) return;
          setDocs(mergeDocs(lists, sort));
          setSearching(false);
        })
        .catch((e) => {
          if (!ctrl.signal.aborted && e?.name !== "AbortError") {
            setError((e as Error).message);
            setSearching(false);
          }
        });
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [termsKey, sort, fromIso, toIso, byAuthor, commentsOnly]);

  /* ---- top authors across the active terms, scoped to the range ---- */
  useEffect(() => {
    const terms = termsKey ? termsKey.split("|") : [];
    if (terms.length === 0) {
      setAuthors([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      Promise.all(
        terms.map((term) =>
          aggregate({ q: term, from: fromIso, to: toIso, signal: ctrl.signal }),
        ),
      )
        .then((list) => {
          if (ctrl.signal.aborted) return;
          // Sum each author's matches across the compared terms.
          const sum = new Map<string, number>();
          for (const a of list)
            for (const au of a.topAuthors)
              sum.set(au.key, (sum.get(au.key) ?? 0) + au.docCount);
          setAuthors(
            [...sum.entries()]
              .map(([key, docCount]) => ({ key, docCount }))
              .sort((a, b) => b.docCount - a.docCount)
              .slice(0, 6),
          );
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [termsKey, fromIso, toIso]);

  /* ---- chart series ------------------------------------------------ */
  const series: Series[] = useMemo(
    () =>
      queries
        .filter((q) => q.text.trim())
        .map((q) => ({
          id: q.id,
          text: q.text.trim(),
          color: colorById[q.id],
          buckets: aggs[q.id]?.buckets ?? [],
        })),
    [queries, aggs, colorById],
  );

  /* ---- input row mutations ----------------------------------------- */
  const updateQuery = (id: string, text: string) =>
    setQueries((qs) => qs.map((q) => (q.id === id ? { ...q, text } : q)));
  const removeQuery = (id: string) =>
    setQueries((qs) => (qs.length > 1 ? qs.filter((q) => q.id !== id) : qs));
  const addQuery = (text = "") =>
    setQueries((qs) =>
      qs.length >= MAX_QUERIES ? qs : [...qs, { id: newId(), text }],
    );

  // Load a gallery example's term(s) in place and jump back to the top, clearing
  // any active filters/range so the fresh comparison shows from scratch.
  const pickTerms = (terms: string[]) => {
    setQueries(terms.slice(0, MAX_QUERIES).map((text, i) => ({ id: `q${i}`, text })));
    setTermFilter(null);
    setByAuthor(null);
    setCommentsOnly(false);
    setRange(null);
    setExpanded(false);
    // Drop the old results and the old chart right away so the loading state
    // shows immediately on click, instead of the previous comparison lingering
    // until the new queries resolve. Clearing `aggs` (not just flipping the
    // loading flag) empties the chart's series so it shows "loading…" exactly
    // like the initial load, rather than the old lines. (Resetting lastTermsKey
    // makes the results effect treat this as a fresh term-set too.)
    setDocs([]);
    setSearching(true);
    setAggs({});
    setAggsLoading(true);
    lastTermsKey.current = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // "newest first" doesn't make sense once you've scoped to a window, so its tab
  // is disabled while a range is set. If it happened to be the active sort when
  // the range is picked, fall back to relevance so we never sit on a sort whose
  // tab is greyed out.
  const selectRange = (r: Range | null) => {
    setRange(r);
    if (r && sort === "recent") setSort("relevance");
  };

  // Comments carry no upvote score and no descendant count of their own (HN
  // doesn't expose either — see scripts/ingest.ts), so "most upvoted" and "most
  // discussed" both sort comments by all-zeros. Disable them while comments-only
  // is on, and if one was the active sort, fall back to relevance.
  const toggleCommentsOnly = () =>
    setCommentsOnly((v) => {
      const next = !v;
      if (next && (sort === "score" || sort === "discussed")) setSort("relevance");
      return next;
    });

  // Clicking a result's timestamp scopes the view to that post's calendar month
  // (UTC, to match the month-aligned histogram buckets).
  const pickMonth = (iso: string) => {
    const d = new Date(iso);
    const fromMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const toMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    selectRange({ fromMs, toMs });
  };

  // The gallery's comparisons, ranked by the internal "coolness" metric.
  const comparisons = useMemo(
    () => sortByCoolness(COMPARISONS, examplesData.terms),
    [examplesData],
  );
  const bucketsFor = (term: string) => examplesData.terms[term] ?? [];

  const visibleDocs = expanded ? docs : docs.slice(0, PREVIEW_ROWS);
  const hiddenCount = docs.length - PREVIEW_ROWS;

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      {/* Header bar -------------------------------------------------- */}
      <div className="hn-header flex items-center gap-2 px-2 py-[3px]">
        <span className="hn-logo">T</span>
        <Link href="/" className="font-bold text-[12px]">
          Hacker Trends
        </Link>
        <span className="text-[10px] opacity-80 hidden sm:inline">
          | see how any topic, tool, or person trended across 18 years of
          Hacker News
        </span>
        <div className="ml-auto">
          <ShareButton />
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
            href="https://upstash.com/docs/redis/search"
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--hn-orange)] whitespace-nowrap"
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
          lines, filterable by term or author.
        </p>
      </div>

      {/* Compare input row (doubles as the chart legend) ------------- */}
      <div className="bg-[color:var(--hn-bg)] px-2 pt-3">
        <div className="flex flex-wrap items-stretch gap-2">
          {queries.map((q) => (
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
                onChange={(e) => updateQuery(q.id, e.target.value)}
              />
              {queries.length > 1 && (
                <button
                  className="trend-x"
                  title="remove"
                  onClick={() => removeQuery(q.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {queries.length < MAX_QUERIES && (
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
          loading={aggsLoading}
        />
      </div>

      {/* Live SDK code behind the current view ----------------------- */}
      <div className="px-2 pt-2">
        <CodePanel
          q={codeTerm}
          sort={sort}
          from={fromIso}
          to={toIso}
          by={byAuthor ?? undefined}
          type={commentsOnly ? "comment" : undefined}
          termCount={activeTerms.length}
        />
      </div>

      {/* ---- everything below the chart is about the results ---- */}

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
                  onClick={() => setSort(k)}
                >
                  {label}
                </button>
              );
            })}
            {/* "only comments" rides the same tab strip — it's a filter, not a
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
          {!searching && docs.length > 0 && (
            // a fun "scale" footnote — desktop-only so it doesn't crowd a phone.
            <span className="ml-auto hidden sm:inline whitespace-nowrap text-[10px] text-[color:var(--hn-subtle)]">
              {CORPUS} keys queried
            </span>
          )}
        </div>
      </div>

      {/* filters: narrow the merged list — by term, by author. (comments-only
          lives in the sort-tab strip above now.) */}
      {(series.length > 1 || authors.length > 0) && (
        <div className="px-2 pt-1">
          <div className="filters-row">
            {series.length > 1 && (
              <>
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
                        setTermFilter((cur) =>
                          cur && cur.toLowerCase() === s.text.toLowerCase()
                            ? null
                            : s.text,
                        )
                      }
                    >
                      <span className="trend-dot" style={{ background: s.color }} />
                      {s.text}
                    </button>
                  );
                })}
              </>
            )}
            {authors.length > 0 && (
              <span className="filters-authors">
                <span className="filters-label">from</span>
                {authors.map((a) => (
                  <button
                    key={a.key}
                    className="facet-pick"
                    data-active={byAuthor === a.key}
                    title={`only show posts from ${a.key}`}
                    onClick={() =>
                      setByAuthor((cur) => (cur === a.key ? null : a.key))
                    }
                  >
                    {a.key}
                    <span className="text-[color:var(--hn-subtle)]">
                      {" "}
                      ({a.docCount.toLocaleString()})
                    </span>
                  </button>
                ))}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Results ----------------------------------------------------- */}
      <div className="bg-[color:var(--hn-bg)] px-2 pb-6">
        {error ? (
          <div className="text-red-600 text-sm py-3">{error}</div>
        ) : searching && docs.length === 0 ? (
          <div className="px-3 py-6 text-[color:var(--hn-subtle)] text-sm">
            searching…
          </div>
        ) : (
          <>
            <Results
              docs={visibleDocs}
              query={codeTerm}
              matchOf={(d) => (d as MergedDoc)._term}
              onPickMonth={pickMonth}
            />
            {!expanded && hiddenCount > 0 && (
              <button className="lot-more" onClick={() => setExpanded(true)}>
                Show more ↓
              </button>
            )}
          </>
        )}
      </div>

      {/* Example queries: the trend gallery, now an in-page picker ---- */}
      <section className="gallery-section px-3 pt-4">
        <div className="flex items-baseline gap-2 border-b border-[color:var(--hn-subtle)] pb-1 mb-3">
          <h2 className="text-[13px] font-bold">example queries</h2>
          <span className="text-[10px] text-[color:var(--hn-subtle)]">
            click any chart to load it above
          </span>
        </div>
        <div className="mini-grid mini-grid--wide">
          {comparisons.map((c) => (
            <MiniTrend
              key={c.terms.join("|")}
              series={c.terms.map((term, i) => ({
                term,
                color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                buckets: bucketsFor(term),
              }))}
              story={c.story}
              onPick={pickTerms}
            />
          ))}
        </div>
      </section>

      {EXAMPLE_GROUPS.map((g, gi) => (
        <section
          key={g.id}
          id={g.id}
          className={`gallery-section px-3 pt-10${gi === EXAMPLE_GROUPS.length - 1 ? " pb-12" : ""}`}
        >
          <div className="flex items-baseline gap-2 border-b border-[color:var(--hn-subtle)] pb-1 mb-3">
            <h2 className="text-[13px] font-bold lowercase">{g.title}</h2>
            <span className="text-[10px] text-[color:var(--hn-subtle)]">{g.blurb}</span>
          </div>
          <div className="mini-grid">
            {g.terms.map((term) => (
              <MiniTrend
                key={term}
                series={[{ term, color: SINGLE_COLOR, buckets: bucketsFor(term) }]}
                onPick={pickTerms}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// Copies the current address bar, which the sync effect keeps pointed at the
// exact view, so it can be pasted to share these terms + filters with someone.
function ShareButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
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
