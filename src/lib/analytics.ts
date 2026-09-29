/**
 * Thin, typed wrapper over the Google Analytics gtag.js loaded in the root
 * layout. Everything funnels through `track()` so the event taxonomy lives in
 * one place (the union below) and call sites can't typo an event name or pass a
 * stray param. All of these fire client-side only; if gtag hasn't loaded (SSR,
 * an ad-blocker, the script still in flight) the call is a silent no-op.
 *
 * Event vocabulary - what we actually want to learn from this demo:
 *   search        - a term-set was searched (the headline signal: what people
 *                   look up). `compare` rides alongside it when 2+ terms.
 *   compare        - a multi-term comparison ran (which combos people try).
 *   example_pick   - a gallery sparkline was clicked to load its terms.
 *   result_click   - a result row was opened on Hacker News.
 *   sort_change    - the result sort mode was switched.
 *   filter_toggle  - a term / author / comments-only filter was toggled.
 *   zero_results   - a search settled with no matches (content/data gaps).
 *   see_code_open  - the "see the code" panel was expanded (is the pitch landing?).
 *   code_tab       - a tab inside that panel was switched.
 *   share          - the "share" button copied a link to the current view.
 *   jobs_search    - a who-is-hiring comparison changed (chips or gallery card).
 *   load_error     - a chart / result / gallery fetch failed, incl. load shedding
 *                    (`busy`, `rate_limited`): how many people saw an error.
 *   outbound_click - a link off-site to Upstash or GitHub (the conversion win).
 *   LCP/INP/CLS/FCP/TTFB - Core Web Vitals samples (perf on real traffic).
 */

import { ApiError } from "./hn-search";

// gtag is defined by the inline snippet in app/layout.tsx.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

type EventMap = {
  search: { terms: string; term_count: number; sort: string };
  compare: { terms: string; term_count: number };
  example_pick: { terms: string; term_count: number };
  result_click: { kind: "story" | "comment"; rank: number; term: string };
  sort_change: { sort: string };
  filter_toggle: {
    kind: "term" | "author" | "comments_only";
    value: string;
    active: boolean;
  };
  zero_results: { terms: string; sort: string };
  see_code_open: { tab: string };
  code_tab: { tab: string };
  share: { terms: string; term_count: number };
  jobs_search: { terms: string; term_count: number; source: "chips" | "gallery" };
  load_error: {
    scope: "chart" | "results" | "gallery" | "jobs_chart" | "jobs_comments";
    code: string;
    attempt?: number;
  };
  outbound_click: {
    destination: "upstash" | "github";
    location: string;
  };
};

// GA4 caps string param values at 100 chars; clamp the free-form term strings so
// a long comparison doesn't get silently dropped server-side.
const clamp = (s: string) => (s.length > 100 ? s.slice(0, 100) : s);

/** Fire a typed analytics event. No-op until gtag.js has loaded. */
export function track<K extends keyof EventMap>(name: K, params: EventMap[K]) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    clean[k] = typeof v === "string" ? clamp(v) : v;
  }
  window.gtag("event", name, clean);
}

/** Log a failed fetch as `load_error`. Aborts are the app cancelling a stale
 *  request, not a failure anyone saw, so they're skipped. */
export function trackError(
  scope: EventMap["load_error"]["scope"],
  e: unknown,
  attempt?: number,
) {
  if ((e as { name?: string } | null)?.name === "AbortError") return;
  const code = e instanceof ApiError ? e.code : "network";
  track("load_error", attempt === undefined ? { scope, code } : { scope, code, attempt });
}

/** Tag an upstash.com link with UTM params so Upstash's own analytics can
 *  attribute the visit to this demo (per surface via `utm_content`). Other
 *  hosts pass through unchanged. */
export function outboundUrl(href: string, location: string): string {
  const u = new URL(href);
  if (u.hostname !== "upstash.com") return href;
  u.searchParams.set("utm_source", "hackernewstrends");
  u.searchParams.set("utm_medium", "referral");
  u.searchParams.set("utm_campaign", "hacker-trends");
  u.searchParams.set("utm_content", location);
  return u.toString();
}

/** Convenience for the off-site links - the metric the demo ultimately cares
 *  about (a click through to Upstash / the repo). */
export function trackOutbound(
  destination: "upstash" | "github",
  location: string,
) {
  track("outbound_click", { destination, location });
}

/** Forward a Core Web Vitals sample to GA. CLS is sub-1 so it's scaled to an
 *  integer; the rest are millisecond values. `non_interaction` keeps these from
 *  polluting engagement/bounce metrics. */
export function trackWebVital(metric: {
  id: string;
  name: string;
  value: number;
  rating?: string;
}) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", metric.name, {
    event_category: "Web Vitals",
    event_label: metric.id,
    value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
    metric_rating: metric.rating,
    non_interaction: true,
  });
}
