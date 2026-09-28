/**
 * Server-only runtime kill switch. Flip it without a deploy (a deploy purges the
 * CDN, which made the 2026-06-25 incident worse). The key lives on the cache DB
 * (`CACHE_REDIS_REST_*` if set, else the main Search DB):
 *
 *   upstash redis exec --db-url $URL --db-token $TOKEN SET flags:querying-disabled 1   # disable
 *   upstash redis exec --db-url $URL --db-token $TOKEN DEL flags:querying-disabled     # re-enable
 *
 * Read at most once per QUERY_FLAG_TTL_MS per warm instance. The build-time
 * `QUERYING_DISABLED` const in maintenance.ts still forces it on everywhere.
 * The `server-only` import makes a client-component import a build error.
 */

import "server-only";
import { cacheRedis } from "./hn-index";
import { QUERYING_DISABLED } from "./maintenance";

export const QUERYING_DISABLED_FLAG_KEY = "flags:querying-disabled";
const QUERY_FLAG_TTL_MS = 15_000;

let cached: { value: boolean; at: number } | null = null;

export async function isQueryingDisabled(): Promise<boolean> {
  if (QUERYING_DISABLED) return true;
  if (cached && Date.now() - cached.at < QUERY_FLAG_TTL_MS) return cached.value;
  let value = cached?.value ?? false;
  try {
    const redis = cacheRedis();
    if (redis) value = (await redis.get(QUERYING_DISABLED_FLAG_KEY)) != null;
  } catch {
    // Redis blip: keep the last known value rather than flapping.
  }
  cached = { value, at: Date.now() };
  return value;
}
