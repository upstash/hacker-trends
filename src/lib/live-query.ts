/**
 * Live Upstash Search calls made while rendering pages (landing pages, OG
 * images). Each one takes a token from the same global budget `/api/hn` uses,
 * so crawlers or cache-busting slugs can't push the Search DB past its ceiling
 * through ISR renders. Over budget it throws, and callers fall back to cached
 * data or a degraded page. CI scripts call hn-index directly, unbudgeted.
 */

import "server-only";
import type { Redis } from "@upstash/redis";
import { runAggregate, runSearch } from "./hn-index";
import type { AggregateArgsOpts, SearchArgsOpts } from "./hn-query";
import { globalSearchBudget } from "./ratelimit";

async function takeToken(): Promise<void> {
  const b = await globalSearchBudget();
  if (!b.success) throw new Error("global search budget exhausted");
}

export async function budgetedAggregate(redis: Redis, opts: AggregateArgsOpts) {
  await takeToken();
  return runAggregate(redis, opts);
}

export async function budgetedSearch(redis: Redis, opts: SearchArgsOpts) {
  await takeToken();
  return runSearch(redis, opts);
}
