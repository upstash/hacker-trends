/**
 * Build/refresh the dedicated `hnjobs` Upstash Search index: ONE document per
 * "Who is hiring?" job posting (a top-level comment under a monthly hiring
 * thread), each carrying a PRECOMPUTED direct-children reply count.
 *
 * Why a separate index (not just reuse `hn`):
 *  - The shared `hn` index stores `ndesc = 0` for every comment, so there is no
 *    "how much discussion did this posting draw" signal to rank the drill-down
 *    by. `hnjobs` materializes that as a real `replies` field, so the panel can
 *    rank by `relevance + log(1 + replyCount)` (see src/lib/jobs-trends.ts).
 *  - It holds ONLY the ~93k job postings, not all 40M+ HN items, so a term match
 *    inside a month window is a tiny, fast scan - the hover drill-down feels
 *    instant instead of paying the ~360ms shared-index query.
 *
 * Index schema (hash-backed, prefix `hnjob:`):
 *   id      F64 / KEYWORD   HN item id of the posting
 *   text    TEXT            the posting body (HTML stripped), for term matching
 *   by      KEYWORD .fast() poster handle
 *   type    KEYWORD .fast() always "comment" (kept for parity with `hn`)
 *   time    DATE   .fast()  posting time (DATE FAST -> histogram + range + sort)
 *   parent  F64             the monthly hiring-thread id this posting sits under
 *   thread  KEYWORD .fast() "YYYY-MM" of the thread (handy facet, never required)
 *   score   F64    .fast()  always 0 (postings have no upvotes), kept for parity
 *   replies F64    .fast()  PRECOMPUTED direct-children count (the new signal)
 *
 * Reply count = DIRECT children only (comments whose `parent` is the posting),
 * the honest "discussion this posting drew". It is built with a SINGLE pass per
 * month - NOT a per-posting query (the PRD forbids that: `$terms` on the
 * non-`.fast()` `parent` is ~10s). The pass: fetch all postings under the
 * thread, then query the `hn` index for the children of those posting ids in
 * `$or`-batches and tally by `parent`. That is O(postings / BATCH) queries per
 * month, a couple dozen at most.
 *
 * Idempotent: HSET overwrites `hnjob:<id>` in place, so re-running a month just
 * refreshes its postings + reply counts. No dedup needed.
 *
 * SAFE BY DEFAULT: with no args it validates ONE recent month (a small slice) so
 * the build loop can exercise it without a ~93k backfill. To run the full
 * backfill (DO NOT do this unattended - it walks every monthly thread):
 *
 *   bun scripts/ingest-jobs.ts --all
 *
 * Other usage:
 *   bun scripts/ingest-jobs.ts                 # validate the latest month only
 *   bun scripts/ingest-jobs.ts 2026-06         # one specific month
 *   bun scripts/ingest-jobs.ts 2026-01 2026-06 # an inclusive month range
 */

import { Redis, s } from "@upstash/redis";
import { WHO_IS_HIRING_THREADS, type HiringThread } from "../src/lib/who-is-hiring-data";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
if (!REDIS_URL || !REDIS_TOKEN) {
  throw new Error("Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (.env.local)");
}

const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

/** The dedicated postings index. Distinct prefix so it never overlaps `hn:`. */
export const JOBS_INDEX = "hnjobs";
export const JOBS_PREFIX = "hnjob:";

/**
 * The shared `hn` index we READ postings + their children from. We query it via
 * the SDK (not the raw REST path) because raw `search.query ... LIMIT n` is
 * capped at <1000 and has no OFFSET form, while the SDK's `query({ limit,
 * offset })` paginates - a few of the busiest threads hold ~1000 postings.
 */
const hnSource = redis.search.index({
  name: "hn",
  schema: s.object({
    title: s.string(),
    text: s.string(),
    by: s.keyword(),
    type: s.keyword(),
    time: s.date().fast(),
    parent: s.number("F64"),
  }),
});

/**
 * Create the `hnjobs` index if it doesn't already exist. Mirrors the `hn`
 * schema (so the same `buildFilter` term arms match) and adds `replies`. DATE +
 * the numeric ranking fields are `.fast()` so histograms, range filters, ORDERBY
 * and SCOREFUNC all work against them.
 */
export async function ensureJobsIndex(): Promise<{ created: boolean }> {
  try {
    await redis.search.createIndex({
      name: JOBS_INDEX,
      dataType: "hash",
      prefix: JOBS_PREFIX,
      schema: s.object({
        // Postings have no headline; kept empty so $dateHistogram/$terms still
        // see the same field set the `hn` index exposes.
        title: s.string(),
        text: s.string(),
        by: s.keyword(),
        type: s.keyword(),
        time: s.date().fast(),
        parent: s.number("F64"),
        thread: s.keyword(),
        score: s.number("F64"),
        // The whole point of this index: a real per-posting discussion count.
        replies: s.number("F64"),
      }),
    });
    console.log(`index "${JOBS_INDEX}" created`);
    // A freshly-created index isn't immediately ready to pick up keys written
    // microseconds later in the same process (the create returns before the
    // index machinery settles), so the very first month's HSETs can land
    // un-indexed. A short pause lets the index come up before we write; on every
    // subsequent (already-exists) run there's no pause and re-HSET indexes in
    // place. Verified: without this, run #1 indexed 0 docs and only run #2's
    // re-HSET took.
    await new Promise((r) => setTimeout(r, 3000));
    return { created: true };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/already exists/i.test(msg)) {
      console.log(`index "${JOBS_INDEX}" already exists, skipping create`);
      return { created: false };
    }
    throw e;
  }
}

/* ---------- query helpers (SDK, paginated) --------------------------- */

/** The fields the SDK returns in `data` for an `hn` doc (all stringly typed). */
type HnDocData = {
  id?: string;
  text?: string;
  by?: string;
  time?: string;
  parent?: string | number;
};

// Page size for paginated reads. <1000 (the index's hard cap) with headroom.
const PAGE = 500;

/**
 * Query the `hn` index for every doc matching `filter`, paginating with
 * limit/offset until a short page comes back. Returns the flat `data` objects.
 */
async function queryAll(filter: Record<string, unknown>): Promise<HnDocData[]> {
  const out: HnDocData[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = (await hnSource.query({ filter, limit: PAGE, offset })) as Array<{ data: HnDocData }>;
    for (const row of page) out.push(row.data);
    if (page.length < PAGE) break;
  }
  return out;
}

/* ---------- one month: postings + direct-children reply counts -------- */

/** A job posting we are about to write into `hnjobs`. */
type Posting = {
  id: number;
  text: string;
  by: string;
  time: string; // ISO 8601
};

/**
 * Fetch every top-level posting under one hiring thread (comments whose `parent`
 * is the thread id). One query - the thread has at most ~1000 postings and the
 * `parent` equality is fast.
 */
async function fetchPostings(threadId: number): Promise<Posting[]> {
  const docs = await queryAll({ parent: threadId });
  const out: Posting[] = [];
  for (const d of docs) {
    const id = Number(d.id);
    if (!id || !d.text) continue;
    out.push({ id, text: d.text, by: d.by ?? "", time: d.time ?? "" });
  }
  return out;
}

// How many posting ids to OR together per children-lookup query. Big enough to
// keep the round-trip count low, small enough that the $or filter stays cheap.
const CHILDREN_BATCH = 64;

/**
 * Build the `postingId -> direct-children count` map in a SINGLE pass over the
 * month, batching the children lookups. Never queries per-posting: we OR up to
 * `CHILDREN_BATCH` posting ids into one paginated `hn` query and tally the
 * returned children by their `parent`. Postings with zero replies simply never
 * appear in the map (their count defaults to 0 at write time).
 */
async function buildReplyCounts(postingIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (let i = 0; i < postingIds.length; i += CHILDREN_BATCH) {
    const batch = postingIds.slice(i, i + CHILDREN_BATCH);
    const children = await queryAll({ $or: batch.map((id) => ({ parent: id })) });
    for (const d of children) {
      const parent = Number(d.parent);
      if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
  }
  return counts;
}

/** Write one month's postings into `hnjobs` via a single pipeline of HSETs. */
async function writePostings(
  postings: Posting[],
  replies: Map<number, number>,
  thread: HiringThread,
): Promise<void> {
  if (postings.length === 0) return;
  const commands: unknown[][] = postings.map((p) => {
    const fields: (string | number)[] = [
      `${JOBS_PREFIX}${p.id}`,
      "id", p.id,
      "title", "",
      "text", p.text,
      "by", p.by,
      "type", "comment",
      "time", p.time,
      "parent", thread.id,
      "thread", thread.month,
      "score", 0,
      "replies", replies.get(p.id) ?? 0,
    ];
    return ["hset", ...fields];
  });

  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`pipeline ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const arr = (await r.json()) as Array<{ error?: string }>;
  for (const x of arr) if (x?.error) throw new Error(`pipeline error: ${x.error}`);
}

/** Ingest one month's hiring thread into `hnjobs`. Returns a small summary. */
async function ingestThread(thread: HiringThread): Promise<{ postings: number; withReplies: number; maxReplies: number }> {
  const t0 = Date.now();
  const postings = await fetchPostings(thread.id);
  const replies = await buildReplyCounts(postings.map((p) => p.id));
  await writePostings(postings, replies, thread);

  let withReplies = 0;
  let maxReplies = 0;
  for (const c of replies.values()) {
    if (c > 0) withReplies++;
    if (c > maxReplies) maxReplies = c;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[${thread.month}] postings=${postings.length} withReplies=${withReplies} maxReplies=${maxReplies} in ${elapsed}s`,
  );
  return { postings: postings.length, withReplies, maxReplies };
}

/* ---------- month selection + CLI ------------------------------------ */

/** Threads whose "YYYY-MM" month is within [from, to] inclusive (string compare
 *  is correct for zero-padded YYYY-MM). */
function threadsInRange(from: string, to: string): HiringThread[] {
  return WHO_IS_HIRING_THREADS.filter((t) => t.month >= from && t.month <= to);
}

const LATEST = WHO_IS_HIRING_THREADS[WHO_IS_HIRING_THREADS.length - 1];

async function main() {
  const args = process.argv.slice(2);
  await ensureJobsIndex();

  let targets: HiringThread[];
  let mode: string;

  if (args[0] === "--all") {
    // FULL BACKFILL - every monthly thread. Heavy; never run unattended.
    targets = WHO_IS_HIRING_THREADS;
    mode = "FULL BACKFILL (--all)";
  } else if (args.length === 2) {
    targets = threadsInRange(args[0], args[1]);
    mode = `range ${args[0]}..${args[1]}`;
  } else if (args.length === 1) {
    targets = WHO_IS_HIRING_THREADS.filter((t) => t.month === args[0]);
    mode = `month ${args[0]}`;
  } else {
    // Default: validate the latest month only (the safe slice).
    targets = LATEST ? [LATEST] : [];
    mode = `validate latest month (${LATEST?.month})`;
  }

  if (targets.length === 0) {
    console.error(`no hiring threads matched (${mode}). Known months span ${WHO_IS_HIRING_THREADS[0]?.month}..${LATEST?.month}.`);
    process.exit(1);
  }

  console.log(`ingest-jobs: ${mode} -> ${targets.length} thread(s)`);
  let totalPostings = 0;
  let totalWithReplies = 0;
  for (const thread of targets) {
    const r = await ingestThread(thread);
    totalPostings += r.postings;
    totalWithReplies += r.withReplies;
  }

  console.log(
    `DONE: wrote ${totalPostings} postings across ${targets.length} month(s); ${totalWithReplies} had >=1 direct reply.`,
  );
  if (args.length === 0) {
    console.log(
      `\nThis was the SAFE single-month validation. To backfill everything (heavy):\n  bun scripts/ingest-jobs.ts --all\nor a range, e.g.:\n  bun scripts/ingest-jobs.ts 2025-01 2026-06`,
    );
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
