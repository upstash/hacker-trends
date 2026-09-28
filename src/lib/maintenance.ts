/**
 * Kill switches for LIVE queries while the Upstash index is unavailable. There
 * are two:
 *
 *  - `QUERYING_DISABLED` (below): build-time, needs a commit + deploy. When
 *    `true` the whole app runs off the CDN-cached gallery/example data:
 *      - `/api/hn` never touches Upstash (503 `{ code: "disabled" }`);
 *      - clicking a gallery card still loads its cached histogram into the main
 *        chart (both the homepage and `/who-is-hiring`);
 *      - the free-text search inputs and the comment/result drill-downs are
 *        inert, showing a plain gray "querying is disabled" note.
 *    Flip back to `false` (one line) once the database is healthy.
 *
 *  - The runtime flag (`isQueryingDisabled()` in runtime-flags.ts, server-only):
 *    flips in seconds with no deploy, so it's the one to reach for mid-incident.
 *    It only makes `/api/hn` return 503 `disabled` (clients show this label);
 *    the UI itself stays interactive. On the cache DB (`CACHE_REDIS_REST_*`,
 *    else the main DB):
 *      upstash redis exec --db-url $URL --db-token $TOKEN SET flags:querying-disabled 1   # disable
 *      upstash redis exec --db-url $URL --db-token $TOKEN DEL flags:querying-disabled     # re-enable
 *    Takes effect within ~15s per instance (+ the 503's short CDN cache).
 *
 * This file is imported by client components, so keep it dependency-free.
 */
export const QUERYING_DISABLED = false;

/** Neutral, no-error copy shown wherever live querying would have run. */
export const QUERYING_DISABLED_LABEL = "querying is disabled";
