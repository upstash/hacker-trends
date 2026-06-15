"use client";

/**
 * "Show the code" panel: the demo's whole pitch is that this rich UI is a thin
 * shell over a handful of `@upstash/redis` calls. Every tab shows real SDK code:
 *
 *   • query     - the `hn.query({...})` behind the current result list, rebuilt
 *                 live as you change the term, sort, date range, or facets.
 *   • aggregate - the single `hn.aggregate({...})` that draws each trend line.
 *   • setup     - the entire backend: define the index once, then HSET plain
 *                 hashes into the Redis you already have. No search cluster.
 *
 * Snippets come straight from the same builders the app runs (hn-query.ts), so
 * what's shown here can't drift from what actually hits Upstash.
 */

import { useMemo, useState } from "react";
import {
  aggregateSnippet,
  searchSnippet,
  SETUP_SNIPPET,
  type SortMode,
} from "@/lib/hn-query";
import { highlight, CodeLinks } from "./code-bits";
import { track } from "@/lib/analytics";

type Tab = "query" | "aggregate" | "setup";

const TABS: { id: Tab; label: string }[] = [
  { id: "query", label: "query" },
  { id: "aggregate", label: "histogram" },
  { id: "setup", label: "index" },
];

type Props = {
  q: string;
  sort: SortMode;
  from?: string;
  to?: string;
  by?: string;
  type?: string;
};

export function CodePanel({ q, sort, from, to, by, type }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("query");

  const code = useMemo(() => {
    if (tab === "setup") return SETUP_SNIPPET;
    if (tab === "aggregate") return aggregateSnippet({ q, from, to });
    const snippet = searchSnippet({ q, sort, limit: 30, from, to, by, type });
    return snippet;
  }, [tab, q, sort, from, to, by, type]);

  return (
    <div className="code-panel">
      <div className="code-head">
        <button
          className="code-toggle"
          onClick={() =>
            setOpen((o) => {
              // Only the open direction is interesting - "did people look at the
              // code?" - so log on expand, not on collapse.
              if (!o) track("see_code_open", { tab });
              return !o;
            })
          }
          aria-expanded={open}
        >
          <span className="code-caret">{open ? "▾" : "▸"}</span>
          <span className="code-glyph">{"</>"}</span>
          <span>see the code</span>
        </button>
        {/* github + the "-" separator are dropped on a phone so "see the code"
            and the Upstash credit sit on one line (see CodeLinks / globals.css). */}
        <span className="code-sep hidden sm:inline">-</span>
        <CodeLinks hideGithubOnMobile />
      </div>

      {open && (
        <div className="code-body">
          <div className="code-tabbar">
            <div className="code-tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className="code-tab"
                  data-active={tab === t.id}
                  onClick={() => {
                    setTab(t.id);
                    track("code_tab", { tab: t.id });
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <pre className="code-pre">
            <code>{highlight(code)}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
