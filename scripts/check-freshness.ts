/**
 * Read-only freshness check for the daily ingest Action: exits 1 if the newest
 * indexed HN item is older than MAX_AGE_HOURS, so a stalled pipeline fails the
 * run (and opens the alert issue) even when every step "succeeded".
 *
 *   bun scripts/check-freshness.ts [max-age-hours]   (default 36)
 *
 * One SEARCH.QUERY (newest first, LIMIT 1); never writes.
 */
export {};
import { Redis, s } from "@upstash/redis";

const MAX_AGE_HOURS = Number(process.argv[2] ?? 36);

async function main() {
  if (!Number.isFinite(MAX_AGE_HOURS) || MAX_AGE_HOURS <= 0) {
    console.error("Usage: bun scripts/check-freshness.ts [max-age-hours]");
    process.exit(1);
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error("check-freshness: missing UPSTASH_REDIS_REST_URL/TOKEN");
    process.exit(1);
  }
  const redis = Redis.fromEnv();
  const index = redis.search.index({ name: "hn", schema: s.object({ time: s.date().fast() }) });
  const rows = await index.query({ orderBy: { time: "DESC" }, limit: 1 });
  const row = rows[0] as { key?: string; data?: { time?: string } } | undefined;
  const newest = row?.data?.time ? Date.parse(row.data.time) : NaN;
  if (!Number.isFinite(newest)) {
    console.error(`check-freshness: could not read the newest item's time (${row?.key ?? "empty index"})`);
    process.exit(1);
  }
  const ageHours = (Date.now() - newest) / 3_600_000;
  const msg = `newest indexed item ${row?.key} at ${new Date(newest).toISOString()} (${ageHours.toFixed(1)}h old, limit ${MAX_AGE_HOURS}h)`;
  if (ageHours > MAX_AGE_HOURS) {
    console.error(`STALE: ${msg}`);
    process.exit(1);
  }
  console.log(`fresh: ${msg}`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
