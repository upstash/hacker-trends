"use client";

import { useEffect, useState } from "react";
import type { HnDoc } from "@/lib/hn-search";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

function domainOf(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Full local date + time for the timestamp tooltip, e.g. "Oct 13, 2013, 2:32 PM". */
function exactWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The relative-time stamp ("10 years ago"): hovering shows the exact date/time,
 *  and clicking scopes the whole view to that post's month (when `onPickMonth`
 *  is wired). Shared by story + comment rows. */
function TimeAgo({
  iso,
  onPickMonth,
}: {
  iso: string;
  onPickMonth?: (iso: string) => void;
}) {
  const label = timeAgo(iso);
  const title = `${exactWhen(iso)} — click to filter to this month`;
  if (!onPickMonth) return <span title={exactWhen(iso)}>{label}</span>;
  return (
    <button type="button" className="time-ago" title={title} onClick={() => onPickMonth(iso)}>
      {label}
    </button>
  );
}

// Resolved thread titles, cached across rows so re-renders and repeated stories
// don't refetch. Value is the story `{ id, title }` (or null once we know there
// isn't one). The edge `op=thread` walks the comment's parents in the index.
const threadCache = new Map<number, { id: number | null; title: string | null }>();

/** Look up the root story a comment belongs to, for the `on thread "<title>"`
 *  label. Lazy + cached; returns null until resolved. */
function useThread(commentId: number) {
  const [thread, setThread] = useState<
    { id: number | null; title: string | null } | null
  >(() => threadCache.get(commentId) ?? null);
  useEffect(() => {
    // Already resolved (initial state seeded it from the cache) — nothing to do.
    // Each row has a unique comment id, so the cache can't fill in behind us.
    if (threadCache.has(commentId)) return;
    let alive = true;
    fetch(`/api/hn?op=thread&id=${commentId}`)
      .then((r) => r.json())
      .then((j) => {
        const t = (j?.result ?? { id: null, title: null }) as {
          id: number | null;
          title: string | null;
        };
        threadCache.set(commentId, t);
        if (alive) setThread(t);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [commentId]);
  return thread;
}

export function Results({
  docs,
  query,
  matchOf,
  onPickMonth,
}: {
  docs: HnDoc[];
  /** Fallback highlight query (used when `matchOf` isn't given or returns ""). */
  query: string;
  /** Per-row highlight term: merged results come from several queries, so each
   *  row highlights the term it actually matched, not one global query. */
  matchOf?: (d: HnDoc) => string;
  /** Scope the whole view to a clicked row's month (wires the timestamp click). */
  onPickMonth?: (iso: string) => void;
}) {
  if (docs.length === 0) {
    // No term active, so the chart already shows the "type a term…" prompt, so
    // keep the results area blank rather than repeating a "no matches" notice.
    if (!query) return null;
    return (
      <div className="px-3 py-6 text-[color:var(--hn-subtle)] text-sm">
        no matches for &quot;{query}&quot;.
      </div>
    );
  }
  return (
    <table className="w-full border-collapse" cellPadding={0} cellSpacing={0}>
      <tbody>
        {docs.map((d, i) => {
          const rowQuery = matchOf?.(d) || query;
          return d.type === "comment" ? (
            <CommentRow
              key={d.id}
              doc={d}
              rank={i + 1}
              query={rowQuery}
              onPickMonth={onPickMonth}
            />
          ) : (
            <StoryRow
              key={d.id}
              doc={d}
              rank={i + 1}
              query={rowQuery}
              onPickMonth={onPickMonth}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function StoryRow({
  doc: d,
  rank,
  query,
  onPickMonth,
}: {
  doc: HnDoc;
  rank: number;
  query: string;
  onPickMonth?: (iso: string) => void;
}) {
  const href =
    d.url && d.url.length > 0
      ? d.url
      : `https://news.ycombinator.com/item?id=${d.id}`;
  const domain = domainOf(d.url);
  // If the title doesn't contain the query but the body text does, show a
  // short snippet so the user can see WHY this story matched.
  const titleHasMatch = queryMatches(d.title, query);
  const snippet =
    !titleHasMatch && d.text ? bestSnippet(d.text, query, 220) : null;
  return (
    <tr className="align-top">
      <td className="story-rank pt-1">{rank}.</td>
      <td className="story-vote select-none text-[color:var(--hn-subtle)] pt-1 pr-1 text-[10px]">
        ▲
      </td>
      <td className="py-1">
        <span>
          <a href={href} target="_blank" rel="noreferrer noopener">
            {highlight(d.title, query)}
          </a>
          {domain ? <span className="story-domain"> ({domain})</span> : null}
        </span>
        {snippet ? (
          <div className="text-[9pt] text-black/80 leading-[1.35] pt-[1px]">
            {highlight(snippet, query)}
          </div>
        ) : null}
        <div className="story-sub">
          {d.type !== "story" ? (
            <span className="uppercase mr-1 text-[7pt]">[{d.type}] </span>
          ) : null}
          {d.score.toLocaleString()} points by{" "}
          <a
            className="subtle"
            href={`https://news.ycombinator.com/user?id=${d.by}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {d.by}
          </a>{" "}
          <TimeAgo iso={d.time} onPickMonth={onPickMonth} /> |{" "}
          <a
            className="subtle"
            href={`https://news.ycombinator.com/item?id=${d.id}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {d.ndesc.toLocaleString()} comments
          </a>
        </div>
      </td>
    </tr>
  );
}

function CommentRow({
  doc: d,
  rank,
  query,
  onPickMonth,
}: {
  doc: HnDoc;
  rank: number;
  query: string;
  onPickMonth?: (iso: string) => void;
}) {
  const href = `https://news.ycombinator.com/item?id=${d.id}`;
  const thread = useThread(d.id);
  // Link "on thread" at the resolved story once we have it, else the comment's
  // immediate parent (or itself) so the link still works while it resolves.
  const threadHref = `https://news.ycombinator.com/item?id=${
    thread?.id ?? d.parent ?? d.id
  }`;
  // Center the excerpt on the matched token when there is one, otherwise the
  // comment can legitimately match (in the body) but show a 240-char prefix
  // that doesn't contain the hit, leaving nothing to highlight.
  const body = d.text ?? "";
  const matchSnippet = bestSnippet(body, query, 240);
  const excerpt = matchSnippet || body.slice(0, 240);
  return (
    <tr className="align-top">
      <td className="story-rank pt-1">{rank}.</td>
      <td className="story-vote select-none text-[color:var(--hn-subtle)] pt-1 pr-1 text-[10px]">
        ▲
      </td>
      <td className="py-1">
        <div className="text-[9pt] leading-[1.35]">
          <a
            className="subtle mr-1"
            href={`https://news.ycombinator.com/user?id=${d.by}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {d.by}
          </a>
          <span className="text-[color:var(--hn-subtle)] text-[8pt]">
            <TimeAgo iso={d.time} onPickMonth={onPickMonth} /> ·{" "}
            <a
              className="subtle"
              href={href}
              target="_blank"
              rel="noreferrer noopener"
            >
              comment ›
            </a>{" "}
            ·{" "}
            <a
              className="subtle"
              href={threadHref}
              target="_blank"
              rel="noreferrer noopener"
            >
              on thread{thread?.title ? ` “${thread.title}”` : ""}
            </a>{" "}
            ·{" "}
            <a
              className="subtle"
              href={`https://hn.algolia.com/api/v1/items/${d.id}`}
              target="_blank"
              rel="noreferrer noopener"
              title="Won't open on HN? A comment can be flagged, killed, or deleted there after we indexed it — HN then hides it, but it's still mirrored in the HN Search (Algolia) archive."
            >
              archived ›
            </a>
          </span>
          <div className="text-[9pt] text-black pt-[1px]">
            {highlight(excerpt, query)}
            {!matchSnippet && body.length > 240 ? "…" : ""}
          </div>
        </div>
      </td>
    </tr>
  );
}

function queryTokens(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
}

function queryMatches(text: string, query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0 || !text) return false;
  const re = new RegExp(`(${tokens.join("|")})`, "i");
  return re.test(text);
}

/**
 * Extract a window of `maxLen` chars around the first query-token match in
 * `text` so the highlighted hit is visible without dumping the whole body.
 */
function bestSnippet(text: string, query: string, maxLen: number): string {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return text.slice(0, maxLen);
  const re = new RegExp(`(${tokens.join("|")})`, "i");
  const m = re.exec(text);
  if (!m) return "";
  const idx = m.index;
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, start + maxLen);
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return head + text.slice(start, end) + tail;
}

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q || !text) return text;
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? (
      <mark key={i} style={{ background: "#ffe1cc", color: "#000", padding: 0 }}>
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}
