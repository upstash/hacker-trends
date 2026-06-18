/**
 * Drill-down index selection for the "Who is hiring?" page (T15).
 *
 * The drill-down can run against either:
 *   - the shared `hn` index, scoped to jobs (`scope=jobs`) - always available,
 *     ranks by relevance only (the `hn` index stores `ndesc = 0` for comments,
 *     so there's no discussion signal); or
 *   - the dedicated `hnjobs` index (scripts/ingest-jobs.ts) - holds only the job
 *     postings, each with a precomputed `replies` count, so it's fast AND can
 *     rank by `relevance + log(1 + replies)`.
 *
 * `hnjobs` is only useful once it's been BACKFILLED for the full history. The
 * build only validates a single recent month (the PRD forbids an unattended ~93k
 * backfill), so this gate defaults OFF: production keeps using `hn` (scope=jobs)
 * and gets the dedicated index automatically the moment the env flag is set,
 * with NO code change. Flip it on (after running `bun scripts/ingest-jobs.ts
 * --all` and confirming the daily Action refreshes it) by setting:
 *
 *   NEXT_PUBLIC_JOBS_INDEX_READY=1
 *
 * It's a `NEXT_PUBLIC_` var because the drill-down query is built in the browser
 * client (hn-search.ts), so the flag has to be readable there.
 */

import type { SearchIndex } from "./hn-query";

/** Whether the dedicated `hnjobs` index is fully populated and safe to query.
 *  Defaults false until the full backfill + daily refresh are confirmed. */
export const JOBS_INDEX_READY: boolean =
  process.env.NEXT_PUBLIC_JOBS_INDEX_READY === "1" ||
  process.env.NEXT_PUBLIC_JOBS_INDEX_READY === "true";

/**
 * The index the drill-down should query, and the scope it needs alongside it.
 *
 * When `hnjobs` is ready we target it directly (it's already postings-only, so
 * no `scope=jobs` parent arm is needed and the ranking uses `replies`). When it
 * isn't, we fall back to the shared `hn` index narrowed by `scope=jobs`.
 */
export function drillIndex(): { index: SearchIndex; scope: "jobs" | undefined } {
  return JOBS_INDEX_READY
    ? { index: "hnjobs", scope: undefined }
    : { index: "hn", scope: "jobs" };
}
