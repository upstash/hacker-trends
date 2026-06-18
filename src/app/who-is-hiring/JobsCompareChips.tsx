"use client";

/**
 * The custom compare chip-row (T08).
 *
 * One bordered chip per series. Each chip is an AUTO-WIDTH text input (it sizes
 * to its content in `ch` units so the row stays dense), a colored dot tying it
 * to its band in the chart, and the series' LIVE all-time mention count (from
 * the aggregate the chart already ran - passed in via `totalFor`).
 *
 * A chip may hold a `|` OR-GROUP (e.g. `backend|sre|devops`): the chart sums the
 * parts into one bar. The hint under the row spells that out. Add/remove series
 * up to `MAX_SERIES` (8); colors come from the shared `PALETTE` by index, so a
 * chip's color matches its chart band exactly.
 *
 * This component is purely presentational over `terms` + `setTerms` (lifted in
 * `WhoIsHiringSearch`), so a gallery-card click can swap the whole comparison
 * without this component owning any state.
 */

import { colorAt, MAX_SERIES } from "@/lib/jobs-trends";

/** Placeholder text; also the floor the auto-width uses so an empty chip is not
 *  a sliver. */
const PLACEHOLDER = "term or a|b|c";

type Props = {
  terms: string[];
  setTerms: (t: string[]) => void;
  /** Live all-time mention count for a series string (the chart's aggregate
   *  total), or undefined while the first aggregate is still in flight. */
  totalFor?: (text: string) => number | undefined;
  max?: number;
};

export function JobsCompareChips({
  terms,
  setTerms,
  totalFor,
  max = MAX_SERIES,
}: Props) {
  const set = (i: number, v: string) =>
    setTerms(terms.map((t, j) => (j === i ? v : t)));
  // Never drop the last chip - the chart always wants at least one series.
  const remove = (i: number) =>
    setTerms(terms.length > 1 ? terms.filter((_, j) => j !== i) : terms);
  const add = () => {
    if (terms.length < max) setTerms([...terms, ""]);
  };

  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-2">
        {terms.map((t, i) => {
          const color = colorAt(i);
          const total = totalFor?.(t.trim());
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
                onChange={(e) => set(i, e.target.value)}
                style={{ flex: "0 0 auto", width: `${ch}ch` }}
              />
              {total !== undefined && total > 0 && (
                <span className="text-[10px] tabular-nums text-[color:var(--hn-subtle)] whitespace-nowrap">
                  {total.toLocaleString()}
                </span>
              )}
              {terms.length > 1 && (
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
        {terms.length < max && (
          <button className="trend-add" onClick={add}>
            + add series
          </button>
        )}
      </div>
      <div className="text-[10px] text-[color:var(--hn-subtle)] mt-1">
        tip: use <code>|</code> to OR several terms into one bar, e.g.{" "}
        <code>backend|sre|devops</code>
      </div>
    </div>
  );
}
