"use client";

/**
 * The custom compare chip-row (T08).
 *
 * One bordered chip per series. Each chip is an AUTO-WIDTH text input (it sizes
 * to its content in `ch` units so the row stays dense), a colored dot tying it
 * to its band in the chart, and the series' all-time mention count (from the
 * aggregate the chart already ran - passed in via `totalAt`).
 *
 * A chip may hold a `|` OR-GROUP (e.g. `backend|sre|devops`): the chart sums the
 * parts into one bar. Add/remove series up to `MAX_SERIES` (8).
 *
 * Typing edits a local DRAFT; it is committed to the chart (and so to the live
 * aggregates) on Enter, on blur, or after a short idle pause - never per
 * keystroke. Colors come from `seriesSlots`, the same mapping the chart uses, so
 * an empty or duplicate chip (gray, no band) never shifts the other colors.
 *
 * `terms` + `setTerms` are lifted to the parent, so a gallery-card click can
 * swap the whole comparison (which discards any stale draft).
 */

import { useEffect, useRef, useState } from "react";
import { colorAt, MAX_SERIES, seriesSlots } from "@/lib/jobs-trends";
import { QUERYING_DISABLED } from "@/lib/maintenance";

/** Placeholder text; also the floor the auto-width uses so an empty chip is not
 *  a sliver. */
const PLACEHOLDER = "term or a|b|c";
/** Idle pause before a typed edit is committed. */
const COMMIT_MS = 500;
/** Dot/border color of a chip that draws no band (empty or duplicate). */
const NO_BAND = "#c6c6c6";

type Props = {
  terms: string[];
  setTerms: (t: string[]) => void;
  /** All-time mention count for the series at this index (the chart's
   *  aggregate total), or undefined while it is still in flight. */
  totalAt?: (seriesIndex: number) => number | undefined;
  max?: number;
};

export function JobsCompareChips({
  terms,
  setTerms,
  totalAt,
  max = MAX_SERIES,
}: Props) {
  // The draft only applies to the `terms` it was typed against; a new `terms`
  // from the parent (commit, gallery pick) supersedes it.
  const [draft, setDraft] = useState<{ base: string[]; values: string[] } | null>(null);
  const values = draft && draft.base === terms ? draft.values : terms;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (next: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setDraft(null);
    if (next.join("\u0000") !== terms.join("\u0000")) setTerms(next);
  };

  const edit = (i: number, v: string) => {
    const next = values.map((t, j) => (j === i ? v : t));
    setDraft({ base: terms, values: next });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), COMMIT_MS);
  };
  // Never drop the last chip - the chart always wants at least one series.
  const remove = (i: number) => {
    if (values.length > 1) commit(values.filter((_, j) => j !== i));
  };
  const add = () => {
    if (values.length < max) commit([...values, ""]);
  };

  const draftSlots = seriesSlots(values).slotOf;
  const committedSlots = seriesSlots(terms).slotOf;

  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-2">
        {values.map((t, i) => {
          const slot = draftSlots[i];
          const color = slot == null ? NO_BAND : colorAt(slot);
          // Totals belong to the committed series; hide them while editing.
          const committed = t === terms[i] ? committedSlots[i] : null;
          const total = committed == null ? undefined : totalAt?.(committed);
          // Auto-width: size the input to the longer of its text or the
          // placeholder, with a small floor so a fresh chip is still clickable.
          const ch = Math.max((t || PLACEHOLDER).length, 3);
          return (
            <div
              key={i}
              className="trend-chip"
              style={{ borderColor: color, minWidth: 0 }}
            >
              <span className="trend-dot" style={{ background: color }} />
              <input
                value={t}
                placeholder={PLACEHOLDER}
                spellCheck={false}
                autoComplete="off"
                aria-label={`compare series ${i + 1}`}
                // Disabled: the chips are a read-only legend for the picked
                // comparison; free-text editing is off while the DB is down.
                readOnly={QUERYING_DISABLED}
                onChange={(e) => edit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(values);
                }}
                onBlur={() => {
                  if (draft) commit(values);
                }}
                style={{ flex: "0 0 auto", width: `${ch}ch` }}
              />
              {total !== undefined && total > 0 && (
                <span className="text-[10px] tabular-nums text-[color:var(--hn-subtle)] whitespace-nowrap">
                  {total.toLocaleString()}
                </span>
              )}
              {!QUERYING_DISABLED && values.length > 1 && (
                <button
                  className="trend-x"
                  title="remove series"
                  aria-label="remove series"
                  onClick={() => remove(i)}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        {!QUERYING_DISABLED && values.length < max && (
          <button className="trend-add" onClick={add}>
            + add series
          </button>
        )}
      </div>
      {!QUERYING_DISABLED && (
        <div className="text-[10px] text-[color:var(--hn-subtle)] mt-1">
          tip: use <code>|</code> to OR several terms into one bar, e.g.{" "}
          <code>backend|sre|devops</code>
        </div>
      )}
    </div>
  );
}
