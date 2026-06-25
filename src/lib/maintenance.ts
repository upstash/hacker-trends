/**
 * Kill-switch for LIVE queries while the Upstash index is unavailable.
 *
 * When `true`, the app runs entirely off the CDN-cached gallery/example data:
 *   - the `/api/hn` edge route never touches Upstash (returns the neutral
 *     "disabled" message, not a red error);
 *   - clicking a gallery card still loads its cached histogram into the main
 *     chart (both the homepage and `/who-is-hiring`);
 *   - the free-text search inputs and the comment/result drill-downs are inert,
 *     showing a plain gray "querying is disabled" note instead of an error.
 *
 * Flip back to `false` (one line) once the database is healthy.
 */
export const QUERYING_DISABLED = true;

/** Neutral, no-error copy shown wherever live querying would have run. */
export const QUERYING_DISABLED_LABEL = "querying is disabled";
