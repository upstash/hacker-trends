/**
 * Shareable view state <-> URL query string.
 *
 * The whole point: every knob that changes what's on screen (the compared
 * terms, the sort, the selected date range, the type facet filter, and
 * which result tab is open) lives in the URL so a link reproduces the exact
 * view. The server `page.tsx` parses the incoming `?…` to seed initial state
 * (no hydration flash); the client rewrites it via `history.replaceState` as
 * the user pokes around.
 *
 * Schema (every field optional; absent == default):
 *   q       repeated, one per compared term, in order   ?q=openai&q=anthropic
 *   sort    relevance|score|discussed|recent            omitted when "relevance"
 *   from,to selected range as epoch-ms (month-aligned)   both present or neither
 *   type    active "by type" facet filter
 *   only    "only show from <term>" filter (merged mode) one of the q terms
 *   active  index into the term list of the open tab     omitted when 0
 */

import type { SortMode } from "./hn-query";

const SORTS: SortMode[] = ["relevance", "score", "discussed", "recent"];

// Mirrors PALETTE.length in HackerTrends; the chart can draw at most this many
// lines, so we never deserialize more terms than there are colors for.
export const MAX_TERMS = 5;

export const DEFAULT_TERMS = ["openai", "anthropic"];

export type ShareState = {
  /** Non-empty compared terms, in input order. */
  terms: string[];
  sort: SortMode;
  /** Selected range in epoch-ms; both set together or both absent. */
  from?: number;
  to?: number;
  type?: string;
  /** "only show from <term>" filter for the merged result list (one of `terms`). */
  only?: string;
  /** Index into `terms` of the open result tab. */
  active: number;
};

function asInt(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseShareState(sp: URLSearchParams): ShareState {
  const terms = sp
    .getAll("q")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_TERMS);

  const sortRaw = sp.get("sort") as SortMode | null;
  const sort = sortRaw && SORTS.includes(sortRaw) ? sortRaw : "relevance";

  const from = asInt(sp.get("from"));
  const to = asInt(sp.get("to"));
  const hasRange = from !== undefined && to !== undefined && to > from;

  const list = terms.length ? terms : DEFAULT_TERMS;
  const activeRaw = asInt(sp.get("active"));
  const active =
    activeRaw !== undefined && activeRaw >= 0 && activeRaw < list.length
      ? Math.floor(activeRaw)
      : 0;

  return {
    terms: terms.length ? terms : [...DEFAULT_TERMS],
    sort,
    from: hasRange ? from : undefined,
    to: hasRange ? to : undefined,
    type: sp.get("type")?.trim() || undefined,
    only: sp.get("only")?.trim() || undefined,
    active,
  };
}

/** Serialize to a query string (no leading "?"); "" when nothing to share. */
export function buildShareSearch(state: ShareState): string {
  const sp = new URLSearchParams();
  for (const t of state.terms) {
    const v = t.trim();
    if (v) sp.append("q", v);
  }
  if (state.sort !== "relevance") sp.set("sort", state.sort);
  if (state.from !== undefined && state.to !== undefined) {
    sp.set("from", String(Math.round(state.from)));
    sp.set("to", String(Math.round(state.to)));
  }
  if (state.type) sp.set("type", state.type);
  if (state.only) sp.set("only", state.only);
  if (state.active > 0) sp.set("active", String(state.active));
  return sp.toString();
}
