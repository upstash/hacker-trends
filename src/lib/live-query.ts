/**
 * Live Upstash Search calls made while rendering pages (landing pages, OG
 * images). Each one takes a token from the render budget (separate from, and
 * smaller than, `/api/hn`'s), so crawlers or cache-busting slugs can neither
 * push the Search DB past its ceiling nor starve interactive search. Over
 * budget it throws, and callers fall back to cached data or a degraded page
 * (see `shortenRevalidate`). CI scripts call hn-index directly, unbudgeted.
 */

import "server-only";
import type { Redis } from "@upstash/redis";
import { runAggregate, runSearch } from "./hn-index";
import type { AggregateArgsOpts, SearchArgsOpts } from "./hn-query";
import { renderSearchBudget } from "./ratelimit";

async function takeToken(): Promise<void> {
  let b = await renderSearchBudget();
  if (!b.success) {
    // One short wait for the next slot before degrading the render.
    await new Promise((r) => setTimeout(r, Math.min(b.retryAfter || 1, 1) * 1000 + Math.random() * 250));
    b = await renderSearchBudget();
  }
  if (!b.success) throw new Error("render search budget exhausted");
}

export async function budgetedAggregate(redis: Redis, opts: AggregateArgsOpts) {
  await takeToken();
  return runAggregate(redis, opts);
}

export async function budgetedSearch(redis: Redis, opts: SearchArgsOpts) {
  await takeToken();
  return runSearch(redis, opts);
}

/** How long a degraded render may be served before ISR retries it. */
const DEGRADED_REVALIDATE_S = 300;

/**
 * Shorten the current render's ISR lifetime, for a page that had to degrade
 * (budget spent, query failed, kill switch on). A fetch with a smaller
 * `next.revalidate` than the route's lowers the whole route's revalidate for
 * this render (Next's documented per-render opt-in); a PING is the cheapest
 * request that carries it, and the data cache dedupes it for its lifetime.
 */
export async function shortenRevalidate(): Promise<void> {
  if (!process.env.UPSTASH_REDIS_REST_URL) return;
  try {
    await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/ping`, {
      headers: { authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      next: { revalidate: DEGRADED_REVALIDATE_S },
    });
  } catch {
    // best effort: worst case the degraded page lives for the normal window
  }
}
