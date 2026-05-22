"use client";

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

export function Results({ docs, query }: { docs: HnDoc[]; query: string }) {
  if (docs.length === 0) {
    // No term active — the chart already shows the "type a term…" prompt, so
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
        {docs.map((d, i) =>
          d.type === "comment" ? (
            <CommentRow key={d.id} doc={d} rank={i + 1} query={query} />
          ) : (
            <StoryRow key={d.id} doc={d} rank={i + 1} query={query} />
          )
        )}
      </tbody>
    </table>
  );
}

function StoryRow({
  doc: d,
  rank,
  query,
}: {
  doc: HnDoc;
  rank: number;
  query: string;
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
          {timeAgo(d.time)} |{" "}
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
}: {
  doc: HnDoc;
  rank: number;
  query: string;
}) {
  const href = `https://news.ycombinator.com/item?id=${d.id}`;
  const parentHref = d.parent
    ? `https://news.ycombinator.com/item?id=${d.parent}`
    : href;
  // Center the excerpt on the matched token when there is one — otherwise the
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
            wrote {timeAgo(d.time)} ·{" "}
            <a
              className="subtle"
              href={parentHref}
              target="_blank"
              rel="noreferrer noopener"
            >
              on thread
            </a>{" "}
            ·{" "}
            <a
              className="subtle"
              href={href}
              target="_blank"
              rel="noreferrer noopener"
            >
              comment ›
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
