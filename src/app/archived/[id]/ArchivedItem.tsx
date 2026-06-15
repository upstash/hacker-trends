"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/** Algolia HN Search item shape (only the fields we render). `children` is the
 *  recursive reply tree; `story_id` is the root thread, `parent_id` the
 *  immediate parent. `text` is HN-sanitized HTML (may be null). */
type AlgoliaItem = {
  id: number;
  author: string | null;
  created_at: string | null;
  type: "story" | "comment" | string;
  title: string | null;
  text: string | null;
  url: string | null;
  points: number | null;
  parent_id: number | null;
  story_id: number | null;
  children: AlgoliaItem[];
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
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

function exactWhen(iso: string | null): string {
  if (!iso) return "";
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

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Header line shared by the root item and every reply: author, time, points
 *  (when present), type, and a link out to the live HN item. */
function ItemMeta({ item }: { item: AlgoliaItem }) {
  return (
    <div className="text-[8pt] text-[color:var(--hn-subtle)] leading-[1.4]">
      {item.author ? (
        <a
          className="subtle"
          href={`https://news.ycombinator.com/user?id=${item.author}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {item.author}
        </a>
      ) : (
        <span>[unknown]</span>
      )}{" "}
      <span title={exactWhen(item.created_at)}>{timeAgo(item.created_at)}</span>
      {item.points != null ? (
        <>
          {" · "}
          {item.points.toLocaleString()} point{item.points === 1 ? "" : "s"}
        </>
      ) : null}
      {" · "}
      <span className="uppercase text-[7pt]">{item.type}</span>
      {" · "}
      <a
        className="subtle"
        href={`https://news.ycombinator.com/item?id=${item.id}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        live HN ›
      </a>
    </div>
  );
}

/** HN's own sanitized markup - safe to inject for this demo. Tailwind's preflight
 *  strips default link/paragraph styling, so we restyle inside `.hn-html`. */
function HnHtml({ html }: { html: string | null }) {
  if (!html) return null;
  return (
    <div
      className="hn-html text-[10pt] leading-[1.45] text-black mt-1"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** One node of the reply tree. Indents each level a bit and caps the visible
 *  recursion depth so a deep thread doesn't run off the right edge. */
function Reply({ item, depth }: { item: AlgoliaItem; depth: number }) {
  const indent = Math.min(depth, 8) * 16;
  return (
    <div
      style={{
        marginLeft: indent,
        borderLeft: "1px solid #e4e4e4",
        paddingLeft: 10,
      }}
      className="mt-3"
    >
      <ItemMeta item={item} />
      <HnHtml html={item.text} />
      {item.children?.map((c) => (
        <Reply key={c.id} item={c} depth={depth + 1} />
      ))}
    </div>
  );
}

function Header() {
  return (
    <div className="hn-header flex items-center gap-2 px-2 py-[3px]">
      <span className="hn-logo">T</span>
      <Link href="/" className="font-bold text-[12px]">
        Hacker Trends
      </Link>
      <span className="text-[10px] opacity-80 hidden sm:inline">
        | archived view
      </span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      <Header />
      <div className="px-3 py-4">{children}</div>
    </div>
  );
}

export function ArchivedItem({ id }: { id: string }) {
  const [item, setItem] = useState<AlgoliaItem | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "notfound" | "error">(
    "loading"
  );

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setItem(null);
    fetch(`https://hn.algolia.com/api/v1/items/${id}`)
      .then((r) => {
        if (r.status === 404) return { __notfound: true } as const;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: AlgoliaItem | { __notfound: true }) => {
        if (!alive) return;
        if ("__notfound" in j || j == null || j.id == null) {
          setStatus("notfound");
          return;
        }
        setItem(j);
        setStatus("ok");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (status === "loading") {
    return (
      <Shell>
        <div className="text-[color:var(--hn-subtle)] text-sm">
          loading archived item #{id}…
        </div>
      </Shell>
    );
  }

  if (status === "notfound") {
    return (
      <Shell>
        <div className="text-sm">
          <p className="mb-2">Item #{id} is not in the archive.</p>
          <p className="text-[color:var(--hn-subtle)]">
            The HN Search (Algolia) archive has no record of this id.{" "}
            <Link className="subtle" href="/">
              ← back to Hacker Trends
            </Link>
          </p>
        </div>
      </Shell>
    );
  }

  if (status === "error" || !item) {
    return (
      <Shell>
        <div className="text-sm">
          <p className="mb-2">Couldn&apos;t load the archived item.</p>
          <p className="text-[color:var(--hn-subtle)]">
            The archive request failed.{" "}
            <Link className="subtle" href="/">
              ← back to Hacker Trends
            </Link>
          </p>
        </div>
      </Shell>
    );
  }

  const isStory = item.type === "story";
  const rootId = item.story_id ?? item.id;
  // Show the "archived original thread" link only when this item lives inside a
  // larger thread (a comment, or anything whose root isn't itself).
  const showRootLink = rootId != null && rootId !== item.id;
  const titleHref =
    item.url && item.url.length > 0
      ? item.url
      : `https://news.ycombinator.com/item?id=${item.id}`;
  const domain = domainOf(item.url);

  return (
    <Shell>
      {showRootLink ? (
        <div className="mb-3 text-[9pt]">
          <Link
            href={`/archived/${rootId}`}
            className="text-[color:var(--hn-orange)] font-bold"
          >
            ↑ view archived original thread
          </Link>
        </div>
      ) : null}

      {/* Root item ------------------------------------------------------- */}
      <div className="border border-[color:var(--hn-subtle)] bg-white p-3">
        {isStory && item.title ? (
          <div className="text-[12pt] leading-[1.3] mb-1">
            <a href={titleHref} target="_blank" rel="noreferrer noopener">
              {item.title}
            </a>
            {domain ? (
              <span className="story-domain"> ({domain})</span>
            ) : null}
          </div>
        ) : null}

        {!isStory ? (
          <div className="text-[8pt] text-[color:var(--hn-subtle)] mb-1 uppercase">
            archived comment
          </div>
        ) : null}

        <ItemMeta item={item} />
        <HnHtml html={item.text} />
      </div>

      {/* Reply tree ------------------------------------------------------ */}
      {item.children?.length ? (
        <div className="mt-4">
          <div className="text-[8pt] text-[color:var(--hn-subtle)] uppercase tracking-wide mb-1">
            {item.children.length} repl{item.children.length === 1 ? "y" : "ies"}
          </div>
          {item.children.map((c) => (
            <Reply key={c.id} item={c} depth={1} />
          ))}
        </div>
      ) : (
        <div className="mt-4 text-[9pt] text-[color:var(--hn-subtle)]">
          no replies in the archive.
        </div>
      )}

      <div className="mt-6 text-[9pt]">
        <Link className="subtle" href="/">
          ← back to Hacker Trends
        </Link>
      </div>
    </Shell>
  );
}
