/**
 * Transport-agnostic Hacker News search query logic.
 *
 * This is the single source of truth for *what* Redis command we run, kept
 * deliberately free of any `fetch`/env coupling. The browser client
 * (`hn-search.ts`) and the live edge proxy (`src/app/api/hn/route.ts`) both
 * import from here, so the command args are built in exactly one place and the
 * wire contract is just `?op=&q=&sort=&…`.
 *
 * NOTE: these builders run inside the Vercel Edge runtime (the `/api/hn`
 * route), so keep this module on web-standard APIs only, no Node built-ins.
 */

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
// scatter — `vision pro` stops surfacing "Gemini 3 Pro: the frontier of vision
// AI" — while still keeping hugely-upvoted near-misses (the "self-hosting" mega
// threads under the query `self hosted`) at the top. Higher values (5, 10) start
// burying those popular variants under tiny exact-title posts, so we don't.
const PHRASE_BOOST = 3.0;

export type FilterOpts = { phraseBoost?: boolean };

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
 * adjacency, a histogram count does not — and the aggregate path leaves it off
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
  // match it against the author handle — for a trend line "who posted it" is
  // noise (and a stray `{ by: "openai" }` in the snippet just confuses).
  const tokenArms = tokens.map(
    (t) => ({ $or: [titleClause(t), textClause(t)] }) as Record<string, unknown>,
  );

  // Multi-word phrase boost: fold an adjacent-phrase title clause into the FIRST
  // token's $or. It can't sit as its own top-level arm ($and and $or can't be
  // siblings at one level), and folding it here is exactly equivalent for
  // scoring — the arm still requires that token, and a phrase match implies it.
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

  if (must.length === 0) return {};
  if (must.length === 1) return must[0];
  return { $and: must };
}

export type SearchArgsOpts = {
  q: string;
  sort: SortMode;
  limit?: number;
  from?: string;
  to?: string;
  by?: string;
  type?: string;
};

// Relevance ranking weights. finalScore = BM25(text relevance, phrase-boosted)
//   + POINTS_FACTOR * log1p(upvotes)
//   + COMMENTS_FACTOR * log1p(comment count)
// Tuned over many example queries (scripts/eval-relevance.ts). Points lead
// comments so a quietly-upvoted post isn't buried, but comments matter enough
// to surface the genuinely-*discussed* threads a pure-upvote sort misses — e.g.
// `rust` then leads with "A Sad Day for Rust" / "Rust Moderation Team Resigns"
// (800–1200 upvotes but 800–1000 comments) instead of just "Announcing Rust 1.0".
const POINTS_FACTOR = 50;
const COMMENTS_FACTOR = 30;

/** Build the SEARCH.QUERY command args (everything after the verb). */
export function buildSearchArgs(opts: SearchArgsOpts): (string | number)[] {
  const { q, sort, limit = 30, from, to, by, type } = opts;
  // phraseBoost only affects the relevance ORDER, so only build it in for that.
  const filter = buildFilter(q, from, to, by, type, {
    phraseBoost: sort === "relevance",
  });
  const args: (string | number)[] = [
    "search.query",
    "hn",
    JSON.stringify(filter),
    "LIMIT",
    limit,
  ];
  if (sort !== "relevance") {
    const field =
      sort === "score" ? "score" : sort === "recent" ? "time" : "ndesc";
    args.push("ORDERBY", field, "DESC");
  } else if (q.trim()) {
    // Hybrid ranking: BM25 + upvote + comment signals, SUMmed onto the text
    // relevance (SCOREMODE sum) and combined with each other (COMBINEMODE sum).
    // Without any signal, plain BM25 ranks five different posts literally titled
    // "Bitcoin" (1-2 upvotes each) above the well-discussed ones. log1p has
    // diminishing returns so a 1000-upvote story isn't ~100x a 10-upvote one,
    // and SUM keeps low-score comments visible (they fall back to BM25 + their
    // comment count). Mutually exclusive with ORDERBY, so we skip it when the
    // user picked a different sort. Only `.fast()` numeric fields work here, and
    // both `score` and `ndesc` are indexed that way.
    args.push(
      "SCOREFUNC",
      "SCOREMODE",
      "sum",
      "COMBINEMODE",
      "sum",
      "FIELDVALUE",
      "score",
      "MODIFIER",
      "log1p",
      "FACTOR",
      POINTS_FACTOR,
      "FIELDVALUE",
      "ndesc",
      "MODIFIER",
      "log1p",
      "FACTOR",
      COMMENTS_FACTOR,
    );
  }
  return args;
}

export type AggregateArgsOpts = { q: string; from?: string; to?: string };

/** The date-histogram + facet aggregations powering the trend chart. Shared by
 *  the raw-command builder and the SDK snippet so they can't drift. */
const AGGREGATIONS = {
  by_month: { $dateHistogram: { field: "time", fixedInterval: "30d" } },
  top_authors: { $terms: { field: "by", size: 6 } },
  by_type: { $terms: { field: "type", size: 4 } },
} as const;

/** Build the SEARCH.AGGREGATE command args (everything after the verb). */
export function buildAggregateArgs(opts: AggregateArgsOpts): (string | number)[] {
  const { q, from, to } = opts;
  const filter = buildFilter(q, from, to);
  return [
    "search.aggregate",
    "hn",
    JSON.stringify(filter),
    JSON.stringify(AGGREGATIONS),
  ];
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
 *  array of primitives, or a small object (≤2 keys) of primitives. This is what
 *  lets `{ $eq: "bitcoin", $boost: 5 }` stay horizontal instead of exploding
 *  into a tall column. Mirrors the data browser's `toJsLiteral` formatter. */
// 3 so a scoreFunc field — `{ field: "score", modifier: "log1p", factor: 50 }` —
// stays on one line like the docs show, alongside the 2-key `{ $eq, $boost }`
// clauses. No other object in any emitted snippet has 3 primitive keys.
const MAX_INLINE_KEYS = 3;
function isInlineable(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return true;
  // Arrays of objects always get their own block; flat arrays can inline.
  if (Array.isArray(v)) return v.every((x) => typeof x !== "object" || x === null);
  // Recurse on object values so a single-key wrapper around a small object,
  // `{ title: { $eq: "x", $boost: 5 } }`, stays on one line.
  const entries = Object.entries(v as Record<string, unknown>);
  return entries.length <= MAX_INLINE_KEYS && entries.every(([, x]) => isInlineable(x));
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
  if (
    indent > 0 &&
    entries.length <= MAX_INLINE_KEYS &&
    entries.every(([, x]) => isInlineable(x))
  ) {
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

/** The `hn.query({...})` SDK call equivalent to `buildSearchArgs(opts)`. */
export function searchSnippet(opts: SearchArgsOpts): string {
  const { q, sort, limit = 30, from, to, by, type } = opts;
  const options: Record<string, unknown> = {
    filter: buildFilter(q, from, to, by, type, {
      phraseBoost: sort === "relevance",
    }),
    limit,
  };
  let note = "";
  if (sort !== "relevance") {
    const field =
      sort === "score" ? "score" : sort === "recent" ? "time" : "ndesc";
    options.orderBy = { [field]: "DESC" };
  } else if (q.trim()) {
    // Same hybrid rank as buildSearchArgs: BM25 + upvote + comment signals.
    options.scoreFunc = {
      fields: [
        { field: "score", modifier: "log1p", factor: POINTS_FACTOR },
        { field: "ndesc", modifier: "log1p", factor: COMMENTS_FACTOR },
      ],
      combineMode: "sum",
      scoreMode: "sum",
    };
    note = "// rank by relevance, boosted by upvotes + comments\n";
  }
  // Annotate the scoreFunc block with the one-line formula it encodes, keeping
  // the leading whitespace ($1) so the comment lines up with the key it sits on.
  let body = fmtJs(options);
  if (sort === "relevance" && q.trim()) {
    body = body.replace(
      /(\n\s*)scoreFunc:/,
      `$1// finalScore = relevance + ${POINTS_FACTOR}*log1p(score) + ${COMMENTS_FACTOR}*log1p(ndesc)$1scoreFunc:`,
    );
  }
  return (
    `const hn = redis.search.index({ name: "hn", schema });\n\n` +
    note +
    `const { documents } = await hn.query(${body});\n\n` +
    `// fully type-safe\n` +
    `documents[0].title;`
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

/** The `hn.aggregate({...})` SDK call equivalent to `buildAggregateArgs`. */
export function aggregateSnippet(opts: AggregateArgsOpts): string {
  const { q, from, to } = opts;
  const options = {
    filter: buildFilter(q, from, to),
    aggregations: AGGREGATIONS,
  };
  return (
    `const hn = redis.search.index({ name: "hn", schema });\n\n` +
    `const { aggregations } = await hn.aggregate(${fmtJs(options)});`
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

/** URL-encode command args into an Upstash REST path. */
export function encodePath(parts: (string | number)[]): string {
  return parts.map((p) => encodeURIComponent(String(p))).join("/");
}

/**
 * Build the command args from request query params (`?op=&q=&sort=&…`). Used by
 * the live `/api/hn` edge proxy so the wire contract (and the resulting Redis
 * command) is defined in one place.
 */
export function argsFromParams(p: URLSearchParams): (string | number)[] {
  const op = (p.get("op") as "search" | "aggregate") ?? "search";
  const q = p.get("q") ?? "";
  const from = p.get("from") ?? undefined;
  const to = p.get("to") ?? undefined;
  if (op === "aggregate") return buildAggregateArgs({ q, from, to });
  return buildSearchArgs({
    q,
    sort: (p.get("sort") as SortMode) ?? "relevance",
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    from,
    to,
    by: p.get("by") ?? undefined,
    type: p.get("type") ?? undefined,
  });
}

/* ---------- response parsing --------------------------------------- */

export function parseDocs(raw: unknown): HnDoc[] {
  if (!Array.isArray(raw)) return [];
  const out: HnDoc[] = [];
  for (const row of raw as Array<[string, string, Array<[string, string]>]>) {
    const fields = row[2];
    const obj: Record<string, string | number> = { _score: parseFloat(row[1]) };
    for (const [k, v] of fields) obj[k] = v;
    obj.score = Number(obj.score ?? 0);
    obj.ndesc = Number(obj.ndesc ?? 0);
    obj.id = Number(obj.id ?? 0);
    if (obj.parent !== undefined) obj.parent = Number(obj.parent);
    out.push(obj as unknown as HnDoc);
  }
  return out;
}

/**
 * SEARCH.AGGREGATE returns a flat key/value-pair array. Each value is itself
 * either a kv-array or an object, recursively.
 */
function kvArrayToObj(v: unknown): Record<string, unknown> {
  if (Array.isArray(v)) {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < v.length; i += 2) o[String(v[i])] = v[i + 1];
    return o;
  }
  if (v && typeof v === "object") return v as Record<string, unknown>;
  return {};
}

export function parseAggregations(raw: unknown): Aggregations {
  const empty: Aggregations = { buckets: [], topAuthors: [], byType: [] };
  const top = kvArrayToObj(raw);
  if (!Object.keys(top).length) return empty;

  function parseBuckets(node: unknown): Bucket[] {
    const o = kvArrayToObj(node);
    const buckets = o.buckets;
    if (!Array.isArray(buckets)) return [];
    return buckets.map((b) => {
      const bo = kvArrayToObj(b);
      return {
        key: Number(bo.key),
        keyAsString: String(bo.keyAsString ?? ""),
        docCount: Number(bo.docCount ?? 0),
      };
    });
  }

  function parseTerms(node: unknown): { key: string; docCount: number }[] {
    const o = kvArrayToObj(node);
    const buckets = o.buckets;
    if (!Array.isArray(buckets)) return [];
    return buckets.map((b) => {
      const bo = kvArrayToObj(b);
      return { key: String(bo.key), docCount: Number(bo.docCount ?? 0) };
    });
  }

  return {
    buckets: parseBuckets(top.by_month),
    topAuthors: parseTerms(top.top_authors),
    byType: parseTerms(top.by_type),
  };
}
