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
import { TrendChart, type Range, type Series } from "./components/TrendChart";
import { Results } from "./components/Results";
import { CodePanel } from "./components/CodePanel";

// First series leads with HN orange; the rest are picked for contrast on the
// off-white HN background. Color is assigned by a term's slot in the input row
// so it stays put when other terms are added/removed.
const PALETTE = ["#ff6600", "#1f6feb", "#1a7f37", "#cf222e", "#8250df"];
const MAX_QUERIES = PALETTE.length; // kept in sync with MAX_TERMS in share-url

// Size of the Redis search index (DBSIZE — one hash per HN post/comment).
const CORPUS = "45M";

// A short, curated "try:" row on the main page — each has tall, distinct spikes
// vetted by scripts/probe-trends.ts. The full categorized gallery (plus A-vs-B
// comparisons) lives on /examples, reached via the "explore examples" link.
const EXAMPLES = [
  "agi",
  "chatgpt",
  "deepseek",
  "elon musk",
  "sam altman",
  "ai bubble",
  "censorship",
  "antitrust",
  "return to office",
  "tiktok",
];

type Q = { id: string; text: string };

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

export function HackerTrends({ initial }: { initial: ShareState }) {
  // All five pieces below are seeded from the URL (parsed server-side and
  // handed in as `initial`), then mirrored back into the URL by the sync effect
  // further down — so the address bar always reproduces the current view.
  const [queries, setQueries] = useState<Q[]>(() =>
    initial.terms.map((text, i) => ({ id: `q${i}`, text })),
  );
  const [aggs, setAggs] = useState<Record<string, AggResponse>>({});
  // True while the date-histograms for the current terms are in flight, so the
  // chart can show a loading state on first paint instead of the empty prompt.
  const [aggsLoading, setAggsLoading] = useState(true);

  const [activeId, setActiveId] = useState<string | null>(
    () => queries[initial.active]?.id ?? null,
  );
  const [sort, setSort] = useState<SortMode>(initial.sort);
  const [range, setRange] = useState<Range | null>(
    initial.from !== undefined && initial.to !== undefined
      ? { fromMs: initial.from, toMs: initial.to }
      : null,
  );
  const [byAuthor, setByAuthor] = useState<string | null>(initial.author ?? null);
  const [byType, setByType] = useState<string | null>(initial.type ?? null);

  const [docs, setDocs] = useState<HnDoc[]>([]);
  // The active term the current `docs` belong to — lets the results effect tell
  // a tab switch (new term, blank + reload) from a same-term refetch (keep old).
  const lastTermRef = useRef("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Facets for the active term, scoped to the selected range. Kept separate
  // from `aggs` (which stays range-less so the chart lines show full history).
  const [activeFacets, setActiveFacets] = useState<AggResponse | null>(null);

  const colorById = useMemo(
    () => Object.fromEntries(queries.map((q, i) => [q.id, PALETTE[i % PALETTE.length]])),
    [queries],
  );

  // The query whose results + facets are shown below the chart.
  const activeQuery =
    queries.find((q) => q.id === activeId && q.text.trim()) ??
    queries.find((q) => q.text.trim()) ??
    null;

  /* ---- keep the URL in sync so the view is shareable --------------- */
  useEffect(() => {
    const terms = queries.map((q) => q.text.trim()).filter(Boolean);
    const activeTerm = activeQuery?.text.trim() ?? "";
    const active = activeTerm ? terms.indexOf(activeTerm) : 0;
    const search = buildShareSearch({
      terms,
      sort,
      from: range?.fromMs,
      to: range?.toMs,
      author: byAuthor ?? undefined,
      type: byType ?? undefined,
      active: active < 0 ? 0 : active,
    });
    const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
    // replaceState (not the Next router) — update the address bar without a
    // navigation/refetch or piling a history entry on every keystroke.
    window.history.replaceState(null, "", url);
  }, [queries, sort, range, byAuthor, byType, activeQuery]);

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

  /* ---- results for the active term, scoped to the selected range --- */
  const fromIso = range ? new Date(range.fromMs).toISOString() : undefined;
  const toIso = range ? new Date(range.toMs).toISOString() : undefined;
  const activeText = activeQuery?.text.trim() ?? "";

  useEffect(() => {
    if (!activeText) {
      setDocs([]);
      setSearching(false);
      lastTermRef.current = activeText;
      return;
    }
    // When the active *term* changes (e.g. clicking a different result tab),
    // drop the previous term's docs right away so the list shows its loading
    // state instead of lingering on stale, wrong-term results. Sort / range /
    // facet changes keep the old docs visible to avoid flicker mid-refetch.
    if (lastTermRef.current !== activeText) {
      setDocs([]);
      lastTermRef.current = activeText;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchPosts({
        q: activeText,
        sort,
        limit: 30,
        from: fromIso,
        to: toIso,
        by: byAuthor ?? undefined,
        type: byType ?? undefined,
        signal: ctrl.signal,
      })
        .then((s) => {
          if (ctrl.signal.aborted) return;
          setDocs(s.docs);
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
  }, [activeText, sort, fromIso, toIso, byAuthor, byType]);

  /* ---- range-scoped facets (top authors / by type) for active term -- */
  useEffect(() => {
    if (!activeText) {
      setActiveFacets(null);
      return;
    }
    // Fall back to the range-less batch agg while the scoped one loads.
    setActiveFacets(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      aggregate({ q: activeText, from: fromIso, to: toIso, signal: ctrl.signal })
        .then((a) => {
          if (!ctrl.signal.aborted) setActiveFacets(a);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [activeText, fromIso, toIso]);

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
  const toggleExample = (term: string) => {
    // Click toggles: if we're already comparing this term, drop it; otherwise
    // fill an empty slot, add a new one, or — when full — replace the last term
    // so a click always lands. Never stacks duplicates.
    const existing = queries.find(
      (q) => q.text.trim().toLowerCase() === term.toLowerCase(),
    );
    if (existing) {
      if (queries.length > 1) removeQuery(existing.id);
      else updateQuery(existing.id, ""); // can't drop the last input — clear it
      return;
    }
    const empty = queries.find((q) => !q.text.trim());
    if (empty) updateQuery(empty.id, term);
    else if (queries.length < MAX_QUERIES) addQuery(term);
    else updateQuery(queries[queries.length - 1].id, term);
  };

  // term (lowercased) → its line color, for marking already-added examples.
  const colorByText = useMemo(() => {
    const m: Record<string, string> = {};
    queries.forEach((q, i) => {
      const t = q.text.trim().toLowerCase();
      if (t) m[t] = PALETTE[i % PALETTE.length];
    });
    return m;
  }, [queries]);

  // Prefer range-scoped facets; fall back to the full-history batch agg until
  // the scoped request lands (or when there's no range, where they're equal).
  const activeAgg =
    activeFacets ?? (activeQuery ? aggs[activeQuery.id] : undefined);
  const showTabs = series.length > 1;

  // "newest first" doesn't make sense once you've scoped to a window, so its tab
  // is disabled while a range is set. If it happened to be the active sort when
  // the range is picked, fall back to relevance so we never sit on a sort whose
  // tab is greyed out.
  const selectRange = (r: Range | null) => {
    setRange(r);
    if (r && sort === "recent") setSort("relevance");
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      {/* Header bar -------------------------------------------------- */}
      <div className="hn-header flex items-center gap-2 px-2 py-[3px]">
        <span className="hn-logo">T</span>
        <span className="font-bold text-[12px]">Hacker Trends</span>
        <span className="text-[10px] opacity-80 hidden sm:inline">
          | see how any topic, tool, or person trended across 18 years of
          Hacker News
        </span>
        <ShareButton />
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
                onFocus={() => q.text.trim() && setActiveId(q.id)}
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

        <div className="flex items-center flex-wrap gap-1 pt-2 text-[10px] text-[color:var(--hn-subtle)]">
          <span>try:</span>
          {EXAMPLES.map((ex) => {
            const added = colorByText[ex.toLowerCase()];
            return (
              <button
                key={ex}
                className={added ? "underline px-1 font-bold" : "underline px-1"}
                style={added ? { color: added } : undefined}
                title={added ? "click to remove" : "click to compare"}
                onClick={() => toggleExample(ex)}
              >
                {ex}
              </button>
            );
          })}
          <Link href="/examples" className="explore-examples ml-1">
            explore examples ↗
          </Link>
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
          q={activeText}
          sort={sort}
          from={fromIso}
          to={toIso}
          by={byAuthor ?? undefined}
          type={byType ?? undefined}
        />
      </div>

      {/* ---- everything below the chart is about the results ---- */}

      {/* per-query result tabs */}
      {showTabs && (
        <div className="px-2 pt-1 flex flex-wrap gap-1">
          {series.map((s) => {
            const active = activeQuery?.id === s.id;
            return (
              <button
                key={s.id}
                className="query-tab"
                data-active={active}
                style={{ borderColor: s.color, color: active ? "#000" : undefined }}
                onClick={() => setActiveId(s.id)}
              >
                <span
                  className="trend-dot"
                  style={{ background: s.color }}
                />
                {s.text}
              </button>
            );
          })}
        </div>
      )}

      {/* sort tabs + active result filters */}
      <div className="px-2">
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 py-1">
          <div className="hn-tabs flex items-center flex-wrap gap-1">
            {SORTS.map(([k, label]) => {
              // "newest first" is meaningless once a date range scopes the view.
              const disabled = k === "recent" && range !== null;
              return (
                <button
                  key={k}
                  className={sort === k ? "active" : ""}
                  disabled={disabled}
                  title={
                    disabled ? "clear the date range to sort by newest" : undefined
                  }
                  onClick={() => setSort(k)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {!searching && docs.length > 0 && (
            <span className="ml-auto whitespace-nowrap text-[10px] text-[color:var(--hn-subtle)]">
              {CORPUS} keys queried
            </span>
          )}
        </div>
      </div>

      {/* author / type facets for the active term */}
      <div className="px-2 py-2 grid grid-cols-2 gap-2 text-[10px]">
        <Chip title="top authors">
          {activeAgg?.topAuthors.length ? (
            activeAgg.topAuthors.map((a) => (
              <button
                key={a.key}
                className="facet-pick mr-2"
                data-active={byAuthor === a.key}
                title={`filter results to posts by ${a.key}`}
                onClick={() =>
                  setByAuthor((cur) => (cur === a.key ? null : a.key))
                }
              >
                <strong>{a.key}</strong>
                <span className="text-[color:var(--hn-subtle)]">
                  {" "}
                  ({a.docCount.toLocaleString()})
                </span>
              </button>
            ))
          ) : (
            <em className="text-[color:var(--hn-subtle)]">—</em>
          )}
        </Chip>
        <Chip title="by type">
          {activeAgg?.byType.length ? (
            activeAgg.byType.map((a) => (
              <button
                key={a.key}
                className="facet-pick mr-2"
                data-active={byType === a.key}
                title={`filter results to ${a.key} posts`}
                onClick={() => setByType((cur) => (cur === a.key ? null : a.key))}
              >
                <strong>{a.key}</strong>
                <span className="text-[color:var(--hn-subtle)]">
                  {" "}
                  ({a.docCount.toLocaleString()})
                </span>
              </button>
            ))
          ) : (
            <em className="text-[color:var(--hn-subtle)]">—</em>
          )}
        </Chip>
      </div>

      {/* active filters — shown right above the matches so it's obvious what's
          currently scoping the result list, and each is one click to remove. */}
      {(byAuthor || byType) && (
        <div className="px-2 pt-1 flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-[color:var(--hn-subtle)]">
          <span>filtered by</span>
          {byAuthor && (
            <span>
              author <strong className="text-black">{byAuthor}</strong>
              <button
                className="ml-1 hover:text-[color:var(--hn-orange)]"
                title="remove author filter"
                onClick={() => setByAuthor(null)}
              >
                ×
              </button>
            </span>
          )}
          {byType && (
            <span>
              type <strong className="text-black">{byType}</strong>
              <button
                className="ml-1 hover:text-[color:var(--hn-orange)]"
                title="remove type filter"
                onClick={() => setByType(null)}
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}

      {/* Results ----------------------------------------------------- */}
      <div className="bg-[color:var(--hn-bg)] px-2 pb-8">
        {error ? (
          <div className="text-red-600 text-sm py-3">{error}</div>
        ) : searching && docs.length === 0 ? (
          <div className="px-3 py-6 text-[color:var(--hn-subtle)] text-sm">
            searching…
          </div>
        ) : (
          <Results docs={docs} query={activeText} />
        )}
      </div>

      <footer className="text-center text-[10px] text-[color:var(--hn-subtle)] pb-6">
        each line is a live date-histogram over {CORPUS} Hacker News posts and
        comments, served through a Vercel Edge Function running next to you, no
        caching
      </footer>
    </div>
  );
}

function Chip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[color:var(--hn-subtle)] px-2 py-1 min-w-0">
      <div className="text-[9px] uppercase tracking-wide text-[color:var(--hn-subtle)] pb-1 truncate">
        {title}
      </div>
      {/* keep facets on a single line; overflow scrolls horizontally rather
          than wrapping to a second row or truncating names with an ellipsis. */}
      <div className="whitespace-nowrap overflow-x-auto facet-row">{children}</div>
    </div>
  );
}

// Copies the current address bar — which the sync effect keeps pointed at the
// exact view — so it can be pasted to share these terms + filters with someone.
function ShareButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (insecure context / denied) — leave the URL for the
      // user to copy from the address bar manually.
    }
  };
  return (
    <button
      className="share-link ml-auto"
      data-copied={copied}
      onClick={copy}
      aria-label="copy a link to this view"
      title={copied ? "link copied" : "copy a link to this view"}
    >
      {copied ? (
        // checkmark, for a beat of "copied" feedback
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        // chain-link icon — the conventional "copy link / share" glyph
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
    </button>
  );
}
