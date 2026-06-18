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
 * `hnjobs` is only useful once it's been BACKFILLED for the full history, and
 * that backfill is now DONE: `bun scripts/ingest-jobs.ts --all` wrote ~93.7k
 * postings spanning the full 2011-2026 thread history, and the daily ingest
 * Action (.github/workflows/ingest.yml) re-runs `ingest-jobs.ts` for the current
 * month (and finalizes the previous month at the boundary), so the index stays
 * fresh. The shared-`hn` `scope=jobs` fallback is ~16x slower (a ~180-id parent
 * `$or` over a non-`.fast()` field: ~4s vs ~250ms on `hnjobs`), so this gate now
 * defaults ON - production uses the fast dedicated index with no env var to set.
 *
 * Kept as an opt-OUT kill switch: if `hnjobs` ever needs to be taken offline
 * (a bad backfill, an index rebuild), force the legacy fallback WITHOUT a code
 * change by setting either of:
 *
 *   NEXT_PUBLIC_JOBS_INDEX_READY=0
 *   NEXT_PUBLIC_JOBS_INDEX_READY=false
 *
 * It's a `NEXT_PUBLIC_` var because the drill-down query is built in the browser
 * client (hn-search.ts), so the flag has to be readable there. NOTE: as a build-
 * time-inlined `NEXT_PUBLIC_` var it was the reason prod silently ran the slow
 * path - the flag lived in local `.env.local` but was never set in Vercel - so
 * the safe default is ON, with the kill switch as the only thing that needs an
 * explicit env var.
 */

import type { SearchIndex } from "./hn-query";

/** Whether the dedicated `hnjobs` index is fully populated and safe to query.
 *  Defaults TRUE (the full backfill + daily refresh are confirmed); set
 *  `NEXT_PUBLIC_JOBS_INDEX_READY=0` (or `false`) to force the `hn` scope=jobs
 *  fallback. */
export const JOBS_INDEX_READY: boolean =
  process.env.NEXT_PUBLIC_JOBS_INDEX_READY !== "0" &&
  process.env.NEXT_PUBLIC_JOBS_INDEX_READY !== "false";

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
