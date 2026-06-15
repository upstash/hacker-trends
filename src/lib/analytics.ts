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
 *   outbound_click - a link off-site to Upstash or GitHub (the conversion win).
 *   web_vital      - a Core Web Vital sample (perf on real traffic).
 */

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
