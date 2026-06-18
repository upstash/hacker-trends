/**
 * Transport-agnostic Hacker News search query logic.
 *
 * This is the single source of truth for *what* Redis Search query we run, kept
 * deliberately free of any `fetch`/env coupling. The builders here produce the
 * OPTION objects the `@upstash/redis` search SDK takes -
 * `redis.search.index({ name }).query({ filter, limit, orderBy?, scoreFunc? })`
 * and `.aggregate({ filter, aggregations })` - which `hn-index.ts` runs and the
 * "show the code" panel renders, so the executed call and the displayed snippet
 * are built from the SAME function and cannot drift.
 *
 * NOTE: these builders run inside the Vercel Edge runtime (the `/api/hn`
 * route via `hn-index.ts`), so keep this module on web-standard APIs only, no
 * Node built-ins.
 */

import { JOB_THREAD_IDS } from "./who-is-hiring-data";

/**
 * A query "scope" narrows the matched set to a subcorpus before the term match
 * is applied. Today the only scope is `jobs`: the top-level comments under the
 * monthly "Ask HN: Who is hiring?" threads, i.e. the individual job postings.
 * Everything else (no scope) searches all of Hacker News.
 */
export type Scope = "jobs" | undefined;

/**
 * Which Upstash Search index a SEARCH.QUERY runs against.
 *
 * `hn` (default) is the shared all-of-Hacker-News index. `hnjobs` is the
 * dedicated postings index built by scripts/ingest-jobs.ts: it holds ONLY the
 * "Who is hiring?" job postings, each with a precomputed `replies` field (the
 * direct-children discussion count). The drill-down targets `hnjobs` when it's
 * present so the search is fast AND can rank by `relevance + log(1 + replies)`;
 * it falls back to `hn` (scope=jobs) when the dedicated index isn't there.
 *
 * `hnjobs` is already scoped to postings, so no `scope=jobs` parent arm is added
 * for it, and its discussion signal is `replies` rather than the comment-only
 * `ndesc` field (which is always 0 on the shared index).
 */
export type SearchIndex = "hn" | "hnjobs";
export const DEFAULT_INDEX: SearchIndex = "hn";
const JOBS_INDEX: SearchIndex = "hnjobs";

export type HnDoc = {
  id: number;
  title: string;
  text?: string;
  by: string;
  type: string;
  time: string; // ISO 8601
  score: number;
  ndesc: number;
  parent?: number;
  url?: string;
  _score?: number; // BM25 relevance from Redis
  /** Precomputed direct-children reply count. Only present on `hnjobs` docs
   *  (the drill-down ranks by it); absent/undefined on shared `hn` docs. */
  replies?: number;
};

export type SortMode = "relevance" | "score" | "recent" | "discussed";

export type SearchResponse = {
  total: number;
  docs: HnDoc[];
  latencyMs: number;
};

export type Bucket = { key: number; keyAsString: string; docCount: number };

export type Aggregations = {
  buckets: Bucket[];
  topAuthors: { key: string; docCount: number }[];
  byType: { key: string; docCount: number }[];
};

export type AggResponse = Aggregations & { latencyMs: number };

/**
 * Tokenize the user query. We split on whitespace AND punctuation so that
 * `GPT-4`, `github.com`, `self-hosted` become multi-token queries we can AND
 * together, matching how the index itself tokenizes those at write time.
 * Sub-tokens shorter than 2 chars are dropped as low-signal; if that leaves
 * nothing (e.g. `C++`), fall back to the raw whitespace-split.
 */
export function tokenize(q: string): string[] {
  const split = q
    .trim()
    .split(/\s+/)
    .flatMap((t) => t.split(/[^\p{L}\p{N}]+/u))
    .filter((t) => t.length >= 2);
  if (split.length > 0) return split;
  return q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// How hard an exact-phrase title match outranks scattered token matches. Kept
// deliberately GENTLE: it's a tiebreaker among comparably-popular results, not
// an override. At 3 (vs the title token's $boost of 5) it demotes off-topic
// scatter - `vision pro` stops surfacing "Gemini 3 Pro: the frontier of vision
// AI" - while still keeping hugely-upvoted near-misses (the "self-hosting" mega
// threads under the query `self hosted`) at the top. Higher values (5, 10) start
// burying those popular variants under tiny exact-title posts, so we don't.
const PHRASE_BOOST = 3.0;

export type FilterOpts = { phraseBoost?: boolean; scope?: Scope };

/** The "Who is hiring?" subcorpus arm: match only comments whose immediate
 *  parent is one of the monthly hiring threads (each such comment is a job
 *  posting). It's an `$or` over ~180 parent ids; ANDed with the term arms it
 *  restricts the trend/search to job postings.
 *
 *  PERF: this arm is SLOW - `parent` is a non-`.fast()` numeric field, so the
 *  ~180-id `$or` scans, and a search/aggregate through it runs ~4s (measured) vs
 *  ~250ms for the same query on the dedicated `hnjobs` postings index. It is the
 *  LEGACY fallback only: every who-is-hiring path picks its index via
 *  `drillIndex()`, which targets `hnjobs` (no scope arm) by default and falls
 *  back to this arm on the shared `hn` index only when `hnjobs` is explicitly
 *  disabled (NEXT_PUBLIC_JOBS_INDEX_READY=0). See src/lib/jobs-index.ts. */
function jobScopeArm(): Record<string, unknown> {
  return { $or: JOB_THREAD_IDS.map((id) => ({ parent: id })) };
}

/**
 * Build the SEARCH.QUERY filter.
 *
 * Each token must match somewhere (`$and` across tokens), and within a token
 * we OR across title (boosted) + text. Matching is exact-token per field (see
 * the clause note below), no fuzzy, so the trend count tracks real mentions of
 * the term, and `cahid arda xxxx heyoo` returns nothing.
 *
 * `opts.phraseBoost` (search path only) additionally rewards docs whose TITLE
 * contains the full query as an adjacent phrase. This is the one place the
 * search and trend filters legitimately diverge: ranking cares about phrase
 * adjacency, a histogram count does not - and the aggregate path leaves it off
 * so the trend snippet stays minimal. Crucially it does NOT change the matched
 * SET (a title containing the phrase already contains every token), so doc
 * counts are identical with or without it; it only moves matches up the order.
 */
export function buildFilter(
  q: string,
  from?: string,
  to?: string,
  by?: string,
  type?: string,
  opts?: FilterOpts,
): Record<string, unknown> {
  const tokens = tokenize(q);

  // Exact-token matching on BOTH fields, no fuzzy ($smart). This is a *trends*
  // tool, so the histogram count and the upvote/discussion sorts must reflect
  // docs that actually contain the term, not a fuzzy neighborhood. $smart's
  // typo-tolerance + prefix expansion is catastrophically loose on short words:
  // "redis" (5 chars) $smart-matches 216k titles / 5.8M comments (vs 3k / 35k
  // exact), pulling in unrelated popular stories (Zed, AlphaFold, …) and
  // collapsing the trend line onto the HN baseline. $eq still does *tokenized*
  // matching (the word "redis" anywhere in the title), which is exactly the
  // honest mention count we want. Title keeps a $boost so headline mentions
  // outrank body mentions in relevance ranking.
  const titleClause = (t: string) => ({ title: { $eq: t, $boost: 5.0 } });
  const textClause = (t: string) => ({ text: { $eq: t } });

  // Each AND-arm here is a hard constraint. The query clauses ($or arms) and
  // the time-range clause are both required. NOTE: a top-level $or alongside
  // another top-level field is treated as a *scoring* hint, not a hard match,
  // so without an explicit $and, clicking a month bar would drop the query
  // filter and return every doc in that month.
  const must: Record<string, unknown>[] = [];

  // A term is a *mention*: it must appear in the title or the body. We don't
  // match it against the author handle - for a trend line "who posted it" is
  // noise (and a stray `{ by: "openai" }` in the snippet just confuses).
  const tokenArms = tokens.map(
    (t) => ({ $or: [titleClause(t), textClause(t)] }) as Record<string, unknown>,
  );

  // Multi-word phrase boost: fold an adjacent-phrase title clause into the FIRST
  // token's $or. It can't sit as its own top-level arm ($and and $or can't be
  // siblings at one level), and folding it here is exactly equivalent for
  // scoring - the arm still requires that token, and a phrase match implies it.
  // Single-token queries have no phrase to boost, so we skip them.
  if (opts?.phraseBoost && tokens.length > 1) {
    (tokenArms[0].$or as unknown[]).push({
      title: { $phrase: q.trim(), $boost: PHRASE_BOOST },
    });
  }
  must.push(...tokenArms);

  if (from || to) {
    const range: Record<string, string> = {};
    if (from) range.$gte = from;
    if (to) range.$lt = to;
    must.push({ time: range });
  }

  // Facet drill-downs: exact keyword match, AND-ed as hard constraints.
  if (by) must.push({ by });
  if (type) must.push({ type });

  // Scope: restrict the whole match to the "Who is hiring?" job postings. Added
  // as another hard $and arm, exactly like the token arms - a job posting is a
  // comment whose parent is one of the monthly threads.
  if (opts?.scope === "jobs") must.push(jobScopeArm());

  if (must.length === 0) return {};
  if (must.length === 1) return must[0];
  return { $and: must };
}

export type SearchArgsOpts = {
  q: string;
  sort: SortMode;
  limit?: number;
  /** Skip this many results (for SDK limit/offset pagination). */
  offset?: number;
  from?: string;
  to?: string;
  by?: string;
  type?: string;
  scope?: Scope;
  /** Which index to query. Defaults to `hn`; `hnjobs` is the dedicated postings
   *  index (pre-scoped, ranks by `replies`). */
  index?: SearchIndex;
};

// Relevance ranking weights. finalScore = BM25(text relevance, phrase-boosted)
//   + POINTS_FACTOR * log1p(upvotes)
//   + COMMENTS_FACTOR * log1p(comment count)
// Tuned over many example queries (scripts/eval-relevance.ts). Points lead
// comments so a quietly-upvoted post isn't buried, but comments matter enough
// to surface the genuinely-*discussed* threads a pure-upvote sort misses - e.g.
// `rust` then leads with "A Sad Day for Rust" / "Rust Moderation Team Resigns"
// (800–1200 upvotes but 800–1000 comments) instead of just "Announcing Rust 1.0".
const POINTS_FACTOR = 50;
const COMMENTS_FACTOR = 30;

// The drill-down ranking weight on a posting's direct-reply count, when querying
// the dedicated `hnjobs` index. Mirrors src/lib/jobs-trends.ts `rankKey`'s
// `relevance + log(1 + replies)`: BM25 relevance plus a log1p reply boost. We use
// the same gentle COMMENTS_FACTOR so a heavily-discussed posting rises without a
// single mega-thread swamping pure relevance.
const REPLIES_FACTOR = COMMENTS_FACTOR;

/** The `scoreFunc` shape the SDK takes: a list of field signals, each run
 *  through a modifier and scaled by a factor, combined with each other and with
 *  the BM25 relevance. */
type ScoreFunc = {
  fields: { field: string; modifier: "log1p"; factor: number }[];
  combineMode: "sum";
  scoreMode: "sum";
};

/** The SDK `query({...})` option object (everything after the index). */
export type SearchOptions = {
  filter: Record<string, unknown>;
  limit: number;
  offset?: number;
  orderBy?: Record<string, "ASC" | "DESC">;
  scoreFunc?: ScoreFunc;
};

/**
 * Build the SDK `query()` options for a search. Returns the chosen index plus
 * the option object passed straight to `redis.search.index({ name }).query()`.
 * This is the single source of truth for the search shape: `hn-index.ts` runs
 * it and `searchSnippet` renders it.
 */
export function buildSearchOptions(
  opts: SearchArgsOpts,
): { index: SearchIndex; options: SearchOptions } {
  const { q, sort, limit = 30, from, to, by, type, scope, offset, index = DEFAULT_INDEX } = opts;
  const onJobsIndex = index === JOBS_INDEX;
  // The `hnjobs` index already contains ONLY postings, so the scope=jobs parent
  // arm is redundant (and its ~180-id $or would just slow the filter). Drop it
  // there; keep it for the shared `hn` index.
  const filter = buildFilter(q, from, to, by, type, {
    phraseBoost: sort === "relevance",
    scope: onJobsIndex ? undefined : scope,
  });
  const options: SearchOptions = { filter, limit };
  if (offset) options.offset = offset;
  if (sort !== "relevance") {
    // `ndesc` doesn't exist on `hnjobs`; its discussion field is `replies`. Both
    // indexes have `score` and `time`, so those sorts map straight through.
    const discussField = onJobsIndex ? "replies" : "ndesc";
    const field =
      sort === "score" ? "score" : sort === "recent" ? "time" : discussField;
    options.orderBy = { [field]: "DESC" };
  } else if (q.trim()) {
    // Hybrid ranking: BM25 + signal fields, SUMmed onto the text relevance
    // (scoreMode sum) and combined with each other (combineMode sum). Without a
    // signal, plain BM25 ranks five different posts literally titled "Bitcoin"
    // (1-2 upvotes each) above the well-discussed ones. log1p has diminishing
    // returns so a 1000-upvote story isn't ~100x a 10-upvote one, and sum keeps
    // low-score docs visible. Mutually exclusive with orderBy. Only `.fast()`
    // numeric fields work here.
    const fields = onJobsIndex
      ? // Postings have no upvotes; the discussion signal is the precomputed
        // direct-reply count. This is exactly `relevance + log1p(replies)`.
        [{ field: "replies", modifier: "log1p" as const, factor: REPLIES_FACTOR }]
      : // Shared index: upvotes lead, comments fill in.
        [
          { field: "score", modifier: "log1p" as const, factor: POINTS_FACTOR },
          { field: "ndesc", modifier: "log1p" as const, factor: COMMENTS_FACTOR },
        ];
    options.scoreFunc = { fields, combineMode: "sum", scoreMode: "sum" };
  }
  return { index, options };
}

export type AggregateArgsOpts = {
  q: string;
  from?: string;
  to?: string;
  scope?: Scope;
  /** Which index to aggregate against. Defaults to `hn`; `hnjobs` is the
   *  dedicated postings index (already scoped to job postings, far smaller than
   *  the all-of-HN `hn` index, so the same histogram runs ~3x faster). When it's
   *  `hnjobs` the `scope=jobs` parent `$or` is dropped (redundant + slow there),
   *  exactly like `buildSearchOptions` does. */
  index?: SearchIndex;
};

/** The date-histogram + facet aggregations powering the trend chart. Shared by
 *  the raw-command builder and the SDK snippet so they can't drift. */
const AGGREGATIONS = {
  by_month: { $dateHistogram: { field: "time", fixedInterval: "30d" } },
  top_authors: { $terms: { field: "by", size: 6 } },
  by_type: { $terms: { field: "type", size: 4 } },
} as const;

/** The SDK `aggregate({...})` option object (everything after the index). */
export type AggregateOptions = {
  filter: Record<string, unknown>;
  aggregations: typeof AGGREGATIONS;
};

/**
 * Build the SDK `aggregate()` options. Returns the chosen index plus the option
 * object passed straight to `redis.search.index({ name }).aggregate()`. Single
 * source of truth for the aggregate shape: `hn-index.ts` runs it and
 * `aggregateSnippet` renders it.
 */
export function buildAggregateOptions(
  opts: AggregateArgsOpts,
): { index: SearchIndex; options: AggregateOptions } {
  const { q, from, to, scope, index = DEFAULT_INDEX } = opts;
  const onJobsIndex = index === JOBS_INDEX;
  // The `hnjobs` index already contains ONLY postings, so the scope=jobs parent
  // arm is redundant there (and its ~180-id $or would just slow the filter).
  // Drop it on that index; keep it for the shared `hn` index. Mirrors what
  // `buildSearchOptions` does for the search path.
  const filter = buildFilter(q, from, to, undefined, undefined, {
    scope: onJobsIndex ? undefined : scope,
  });
  return { index, options: { filter, aggregations: AGGREGATIONS } };
}

/* ---------- SDK code snippets (for the "show the code" panel) -------- */
/*
 * The app talks to Upstash over the REST path above, but the point of the
 * panel is to show how little code this *is* with `@upstash/redis`. These
 * builders produce the equivalent SDK calls from the exact same opts, so what
 * the panel shows always matches the query the UI just ran. The filter object
 * is literally what `buildFilter` returns, and the SDK takes the same JSON DSL.
 */

/** A value is "inlineable", kept on one line, if it's a primitive, a flat
 *  array of primitives, or a small object of inlineable values. This is what
 *  lets `{ $eq: "bitcoin", $boost: 5 }` stay horizontal instead of exploding
 *  into a tall column. Mirrors the data browser's `toJsLiteral` formatter. */
// A wrapper object may hold up to 2 keys; but a *flat* object - every value a
// scalar - may hold up to 3, so a scoreFunc field
// `{ field: "score", modifier: "log1p", factor: 50 }` stays on one line like the
// docs show. The extra key is allowed ONLY when flat, so the 3-key `aggregations`
// block (whose values are nested objects) still expands one key per line instead
// of collapsing onto one runaway line.
const MAX_INLINE_KEYS = 2;
const MAX_INLINE_FLAT_KEYS = 3;
function isInlineable(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return true;
  // Arrays of objects always get their own block; flat arrays can inline.
  if (Array.isArray(v)) return v.every((x) => typeof x !== "object" || x === null);
  // Recurse on object values so a single-key wrapper around a small object,
  // `{ title: { $eq: "x", $boost: 5 } }`, stays on one line.
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.every(([, x]) => isInlineable(x))) return false;
  const flat = entries.every(([, x]) => typeof x !== "object" || x === null);
  return entries.length <= (flat ? MAX_INLINE_FLAT_KEYS : MAX_INLINE_KEYS);
}

/** Pretty-print a value as a JS object literal (unquoted identifier keys),
 *  collapsing short objects/arrays onto a single line to use horizontal space. */
function fmtJs(v: unknown, indent = 0): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v !== "object") return JSON.stringify(v);

  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);

  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    // Only collapse arrays of primitives. An array of objects (e.g. the $or
    // arms) gets one element per line, each element still inlines on its own,
    // which avoids one absurdly long line while staying compact.
    const allPrimitive = v.every((x) => typeof x !== "object" || x === null);
    if (allPrimitive) {
      const oneLine = `[${v.map((x) => fmtJs(x, indent + 1)).join(", ")}]`;
      if (!oneLine.includes("\n")) return oneLine;
    }
    return `[\n${v.map((x) => inner + fmtJs(x, indent + 1)).join(",\n")}\n${pad}]`;
  }

  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  // Never inline the root object; the top-level call reads best expanded.
  // Below the root, the same predicate the array branch uses decides it.
  if (indent > 0 && isInlineable(v)) {
    const oneLine = `{ ${entries.map(([k, x]) => `${fmtKey(k)}: ${fmtJs(x, indent + 1)}`).join(", ")} }`;
    if (!oneLine.includes("\n")) return oneLine;
  }
  const body = entries
    .map(([k, val]) => `${inner}${fmtKey(k)}: ${fmtJs(val, indent + 1)}`)
    .join(",\n");
  return `{\n${body}\n${pad}}`;
}

/** `$smart`, `time`, `by` … are all valid JS identifiers, so emit them bare;
 *  quote anything that isn't (none today, but keeps the printer honest). */
function fmtKey(k: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
}

/** The `hn.query({...})` SDK call - rendered from the SAME `buildSearchOptions`
 *  the app executes, so the panel can't drift from the real query. We render the
 *  shared-`hn` form (default index) regardless of which index actually ran, so
 *  the panel always shows the upvote+comment ranking readers expect. */
export function searchSnippet(opts: SearchArgsOpts): string {
  const { options } = buildSearchOptions({ ...opts, scope: undefined, index: DEFAULT_INDEX });
  const note =
    opts.sort === "relevance" && opts.q.trim()
      ? "// rank by relevance, boosted by upvotes + comments\n"
      : "";
  // Annotate the scoreFunc block with the one-line formula it encodes, keeping
  // the leading whitespace ($1) so the comment lines up with the key it sits on.
  let body = fmtJs(options);
  if (opts.sort === "relevance" && opts.q.trim()) {
    body = body.replace(
      /(\n\s*)scoreFunc:/,
      `$1// finalScore = relevance + ${POINTS_FACTOR}*log1p(points) + ${COMMENTS_FACTOR}*log1p(comments)$1scoreFunc:`,
    );
  }
  return (
    `const hn = redis.search.index({ name: "hn", schema });\n\n` +
    note +
    `const documents = await hn.query(${body});\n\n` +
    `// type-safe\n` +
    `documents[0].data.title;`
  );
}

/** The bare date-histogram that draws a gallery trend line, no author/type
 *  facets, since the /examples sparklines only plot the monthly counts. Shown
 *  in the landing page's "code for this part" panel as the simplest possible
 *  aggregate: one filter, one `$dateHistogram`. */
export function histogramSnippet(term: string): string {
  // Hand-expand the aggregations block over several lines (fmtJs would collapse
  // the single `by_month` onto one long line that crops in the narrow landing
  // column). The filter still goes through fmtJs so it can't drift.
  const filter = fmtJs(buildFilter(term), 1);
  return (
    `const hn = redis.search.index({ name: "hn", schema });\n\n` +
    `// one date-histogram per term, overlay the lines to compare\n` +
    `const { aggregations } = await hn.aggregate({\n` +
    `  filter: ${filter},\n` +
    `  aggregations: {\n` +
    `    by_month: {\n` +
    `      $dateHistogram: {\n` +
    `        field: "time",\n` +
    `        fixedInterval: "30d",\n` +
    `      },\n` +
    `    },\n` +
    `  },\n` +
    `});`
  );
}

/** The histogram behind the /who-is-hiring chart: the same date-histogram as
 *  above, but the filter ANDs in the "job postings" scope - comments whose
 *  parent is one of the monthly "Who is hiring?" threads. The ~180 thread ids
 *  are shown as a named list rather than inlined, since that's how you'd
 *  actually write it (and matches what scripts/ingest-jobs.ts produces). */
export function jobsHistogramSnippet(term: string): string {
  // Print just the term arm via fmtJs so it can't drift from buildFilter, then
  // hand-assemble the readable scope arm around it.
  const termArm = fmtJs({ $or: [{ title: { $eq: term } }, { text: { $eq: term } }] }, 3);
  return (
    `const hn = redis.search.index({ name: "hn", schema });\n\n` +
    `// the monthly "Ask HN: Who is hiring?" threads (one per month since 2011)\n` +
    `const HIRING_THREADS = [2396027, 2503204, /* …180 more… */];\n\n` +
    `// per month, count the job postings that mention the term\n` +
    `const { aggregations } = await hn.aggregate({\n` +
    `  filter: {\n` +
    `    $and: [\n` +
    `      ${termArm},\n` +
    `      { $or: HIRING_THREADS.map((id) => ({ parent: id })) },\n` +
    `    ],\n` +
    `  },\n` +
    `  aggregations: {\n` +
    `    by_month: { $dateHistogram: { field: "time", fixedInterval: "30d" } },\n` +
    `  },\n` +
    `});`
  );
}

/** The `hn.aggregate({...})` SDK call - rendered from the SAME
 *  `buildAggregateOptions` the app executes. We render the shared-`hn` form
 *  (default index, no scope arm) so the panel shows the simplest aggregate. */
export function aggregateSnippet(opts: AggregateArgsOpts): string {
  const { options } = buildAggregateOptions({ ...opts, scope: undefined, index: DEFAULT_INDEX });
  return (
    `const hn = redis.search.index({ name: "hn", schema });\n\n` +
    `const aggregations = await hn.aggregate(${fmtJs(options)});`
  );
}

/** The whole backend: store plain hashes, then define an index over them.
 *  Mirrors scripts/ingest.ts. */
export const SETUP_SNIPPET = `import { Redis, s } from "@upstash/redis";

const redis = Redis.fromEnv();

// Insert your keys
await redis.hset("hn:8863", {
  title: "My YC app: Dropbox - Throw away your USB drive",
  by: "dhouston",
  type: "story",
  time: "2007-04-05T19:16:00.000Z",
  score: 111,
});

// Create an index with the key prefix
await redis.search.createIndex({
  name: "hn",
  dataType: "hash",
  prefix: "hn:",
  schema: s.object({
    title: s.string(),
    text:  s.string(),
    by:    s.keyword(),
    type:  s.keyword(),
    time:  s.date().fast(),
    score: s.number("F64"),
    ndesc: s.number("F64"),
  }),
});`;

/* ---------- SDK return-shape mappers ------------------------------- */
/*
 * The SDK parses Upstash's responses for us, so these mappers take already-
 * structured objects (not the raw REST kv-arrays the old parsers handled):
 *   query()     -> Array<{ key, score, data }>   (data has typed fields)
 *   aggregate() -> { by_month: { buckets:[{ key, keyAsString, docCount }] },
 *                    top_authors: { buckets:[{ key, docCount }], ... },
 *                    by_type:     { buckets:[{ key, docCount }], ... } }
 * We just project those onto the app's `HnDoc` / `Aggregations` types and coerce
 * the numeric fields (the SDK already returns them as numbers; we coerce
 * defensively so a missing field is 0, not NaN).
 */

/** One SDK query row: the document key, its BM25/score, and the field data. */
type QueryRow = { key: string; score: number; data: Record<string, unknown> };

/** Map the SDK's `query()` rows onto `HnDoc[]`. The row's `score` is the BM25
 *  (relevance/scoreFunc/orderBy) value, surfaced as `_score`; the field values
 *  come from `data`. */
export function mapDocs(rows: unknown): HnDoc[] {
  if (!Array.isArray(rows)) return [];
  const out: HnDoc[] = [];
  for (const row of rows as QueryRow[]) {
    const d = row?.data ?? {};
    const obj: Record<string, unknown> = { ...d, _score: Number(row?.score ?? 0) };
    obj.score = Number(d.score ?? 0);
    obj.ndesc = Number(d.ndesc ?? 0);
    obj.id = Number(d.id ?? 0);
    if (d.parent !== undefined) obj.parent = Number(d.parent);
    // `hnjobs` docs carry the precomputed direct-reply count; coerce it when the
    // field is present so the drill-down ranking can read a real number.
    if (d.replies !== undefined) obj.replies = Number(d.replies);
    out.push(obj as unknown as HnDoc);
  }
  return out;
}

/** A single `$dateHistogram` / `$terms` bucket as the SDK returns it. */
type SdkBucket = { key: unknown; keyAsString?: unknown; docCount?: unknown };

function mapDateBuckets(node: unknown): Bucket[] {
  const buckets = (node as { buckets?: unknown })?.buckets;
  if (!Array.isArray(buckets)) return [];
  return (buckets as SdkBucket[]).map((b) => ({
    key: Number(b.key),
    keyAsString: String(b.keyAsString ?? ""),
    docCount: Number(b.docCount ?? 0),
  }));
}

function mapTermBuckets(node: unknown): { key: string; docCount: number }[] {
  const buckets = (node as { buckets?: unknown })?.buckets;
  if (!Array.isArray(buckets)) return [];
  return (buckets as SdkBucket[]).map((b) => ({
    key: String(b.key),
    docCount: Number(b.docCount ?? 0),
  }));
}

/** Map the SDK's structured `aggregate()` result onto `Aggregations`. */
export function mapAggregations(agg: unknown): Aggregations {
  const a = (agg ?? {}) as Record<string, unknown>;
  return {
    buckets: mapDateBuckets(a.by_month),
    topAuthors: mapTermBuckets(a.top_authors),
    byType: mapTermBuckets(a.by_type),
  };
}
