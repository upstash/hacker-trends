"use client";

/**
 * The comment drill-down panel (T09).
 *
 * Shows the actual job postings behind a hovered/clicked bar segment: one page
 * at a time (poster handle + highlighted excerpt), ranked by discussion. Each
 * row also links to THAT specific posting on HN and to its `/archived/<id>`
 * view, and a "Load more" button (when `onLoadMore` is wired) pulls the next
 * page. The panel header carries the month-level thread links; the per-row links
 * are for the individual posting. The matched term(s) are wrapped in the same
 * peach `#ffe1cc` mark the main search uses (whole words only, so "java" never
 * lights up inside "javascript"), and the excerpt is centered on the FIRST
 * whole-word match so the highlight is always visible.
 *
 * The panel is driven entirely by `useJobComments`: the last hover/click stays
 * on screen until the next one replaces it (no clear-on-mouse-leave flicker).
 */

import { memo } from "react";
import type { JSX } from "react";
import type { CommentsState } from "./useJobComments";
import { WHO_IS_HIRING_THREADS } from "@/lib/who-is-hiring-data";
import { QUERYING_DISABLED_LABEL } from "@/lib/maintenance";
import { centeredSnippet, termRegex } from "@/lib/jobs-trends";

/** Same peach highlight the main search uses (Results.tsx). */
const MARK = { background: "#ffe1cc", color: "#000", padding: 0 } as const;

/** Map a (year, 0-based month) to that month's "Who is hiring?" thread id, via
 *  the generated `WHO_IS_HIRING_THREADS` manifest (matched on "YYYY-MM"). A
 *  month the manifest doesn't list (skipped, or newer than the manifest) is
 *  null; the caller then falls back to the postings' own parent. */
function threadIdFor(year: number, month: number): number | null {
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  const t = WHO_IS_HIRING_THREADS.find((x) => x.month === key);
  return t ? t.id : null;
}

function JobsCommentsInner({
  state,
  onLoadMore,
  onRetry,
  disabled = false,
}: {
  state: CommentsState;
  /** load the next page of postings for the current segment (the "Load more"
   *  button). Omitted on surfaces that don't paginate. */
  onLoadMore?: () => void;
  /** re-run a failed load. */
  onRetry?: () => void;
  /** while live querying is off (DB down) the drill-down can't run: show a plain
   *  gray note instead of the hover/loading/results states. */
  disabled?: boolean;
}) {
  const { status, load, docs, hasMore, loadingMore, error } = state;
  const query = load ? load.parts.join(" ") : "";
  // A posting's parent IS its month's thread, so a month missing from the
  // manifest still gets its thread links once postings arrive.
  const threadId = load
    ? threadIdFor(load.year, load.month) ?? docs.find((d) => d.parent)?.parent ?? null
    : null;
  const retry = onRetry && (
    <button type="button" onClick={onRetry} className="ml-1 underline">
      retry
    </button>
  );

  return (
    <div>
      <div className="border-b border-[color:var(--hn-subtle)] pb-1 mb-2">
        <h3 className="text-[12px] font-bold flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {load ? (
            <>
              <span className="whitespace-nowrap">
                <span style={{ color: load.color }}>●</span> &ldquo;{load.label}
                &rdquo; in {load.periodLabel}
              </span>
              {load.value != null && (
                <span className="text-[11px] font-normal tabular-nums text-[color:var(--hn-subtle)] whitespace-nowrap">
                  {load.value.toLocaleString()}{" "}
                  {load.value === 1 ? "posting" : "postings"}
                </span>
              )}
              {threadId != null && (
                <span className="text-[10px] font-normal whitespace-nowrap">
                  <a
                    className="subtle"
                    href={`https://news.ycombinator.com/item?id=${threadId}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    HN thread
                  </a>
                  <span className="text-[color:var(--hn-subtle)]"> · </span>
                  <a
                    className="subtle"
                    href={`/archived/${threadId}`}
                  >
                    archived
                  </a>
                </span>
              )}
            </>
          ) : (
            "Job postings"
          )}
        </h3>
      </div>

      {disabled ? (
        <p className="text-[11px] text-[color:var(--hn-subtle)] leading-relaxed py-2">
          {QUERYING_DISABLED_LABEL}
        </p>
      ) : (
        <>
      {status === "idle" && (
        <p className="text-[11px] text-[color:var(--hn-subtle)] leading-relaxed py-2">
          Hover (or click) a bar segment to read the job postings that mention
          that term in that month.
        </p>
      )}
      {status === "loading" && (
        <div className="py-3 text-[12px] text-[color:var(--hn-subtle)] animate-pulse">
          Loading…
        </div>
      )}
      {status === "error" && (
        <div className="py-3 text-[12px] text-red-600">
          {error ?? "could not load postings"}
          {retry}
        </div>
      )}
      {status === "done" && docs.length === 0 && (
        <div className="py-3 text-[12px] text-[color:var(--hn-subtle)]">
          no matching postings in this month
        </div>
      )}
      {status === "done" && docs.length > 0 && (
        <>
          <ol className="flex flex-col gap-2">
            {docs.map((d, i) => (
              <li key={d.id} className="flex gap-2 text-[9pt] leading-[1.4]">
                <span className="story-rank pt-[1px]">{i + 1}.</span>
                <div className="min-w-0">
                  <a
                    className="subtle mr-1"
                    href={`https://news.ycombinator.com/item?id=${d.id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {d.by}
                  </a>
                  {/* Per-posting discussion count from the dedicated `hnjobs`
                   *  index (`replies` = direct children). Subtle, tabular, hidden
                   *  when the field is absent (shared `hn` index has no count). */}
                  {d.replies != null && d.replies > 0 && (
                    <span className="text-[color:var(--hn-subtle)] tabular-nums mr-1">
                      {d.replies} {d.replies === 1 ? "reply" : "replies"}
                      {" · "}
                    </span>
                  )}
                  <span>{highlight(centeredSnippet(plain(d.text ?? ""), query, 260), query)}</span>
                  {/* Per-POSTING links (the month thread + archive sit in the
                   *  header; these point at THIS specific job posting). */}
                  <span className="ml-1 whitespace-nowrap text-[8.5pt]">
                    <a
                      className="subtle"
                      href={`https://news.ycombinator.com/item?id=${d.id}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      HN thread
                    </a>
                    <span className="text-[color:var(--hn-subtle)]"> · </span>
                    <a className="subtle" href={`/archived/${d.id}`}>
                      archived
                    </a>
                  </span>
                </div>
              </li>
            ))}
          </ol>
          {error ? (
            <div className="mt-2 text-[11px] text-red-600">
              {error}
              {retry}
            </div>
          ) : (
            hasMore && onLoadMore && (
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="mt-2 text-[11px] font-semibold text-[color:var(--hn-orange)] hover:underline disabled:opacity-60"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )
          )}
        </>
      )}
        </>
      )}
    </div>
  );
}

/* Memoized: the panel re-renders only when its `state` (the loaded postings)
 * changes - not on every chart hover/magnification render of the parent. */
export const JobsComments = memo(JobsCommentsInner);

/* ---- local text helpers (so we can drop all the Results chrome) --------- */

/** Strip HTML + decode the handful of entities the index stores, collapse
 *  whitespace. The index text can carry `<p>`, `&#x2F;` etc. */
function plain(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

/** Wrap each whole-word match in the peach mark. `split` with the regex's one
 *  capture group puts the matches at the odd indexes. */
function highlight(text: string, q: string): (JSX.Element | string)[] | string {
  const re = termRegex(q);
  if (!re || !text) return text;
  return text.split(re).map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} style={MARK}>
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
