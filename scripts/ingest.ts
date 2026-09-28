/**
 * Load Hacker News items into Upstash Redis as `hn:<id>` hashes, batched
 * through the pipeline endpoint. Two sources:
 *
 *  - Monthly Parquet files from HuggingFace (open-index/hacker-news), for bulk
 *    backfills. That dataset stopped publishing on 2026-08-23, so a missing
 *    current or previous month is expected and non-fatal.
 *  - The official HN Firebase API (`--live`), for the daily cron: fills the ID
 *    tail after the newest indexed item in bounded, resumable chunks, then
 *    re-fetches the last ~3 days to refresh scores/comment counts and delete
 *    items that died since. This alone keeps the index current.
 *
 * Before writing, this also creates the `hn` Redis Search index (idempotent;
 * skipped if it already exists). RediSearch indexes both existing and future
 * keys matching the `hn:` prefix, so the hashes written below are picked up
 * automatically.
 *
 * Every mode WRITES to the Redis in UPSTASH_REDIS_REST_URL/TOKEN. Run bare (or
 * with --help) for usage; that path never touches the DB.
 *
 * Usage:
 *   bun scripts/ingest.ts 2026 03          (one month)
 *   bun scripts/ingest.ts 2026 Q1          (a quarter)
 *   bun scripts/ingest.ts 2024 1 2024 12   (a range)
 *   bun scripts/ingest.ts --live           (Firebase tail + 3-day refresh)
 *
 * HN_LOCAL_ARCHIVE=/path/to/hn-archive reads `data/<y>/<y>-<m>.parquet` from a
 * local copy of the dataset instead of HuggingFace when the file exists there.
 */

import {
  parquetReadObjects,
  asyncBufferFromUrl,
  asyncBufferFromFile,
} from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { Redis, s } from "@upstash/redis";
import { existsSync } from "node:fs";

// Opt-in local copy of the open-index/hacker-news parquet archive. Faster than
// range-fetching from HuggingFace and works while HF is flaky.
const LOCAL_ARCHIVE = process.env.HN_LOCAL_ARCHIVE;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const INDEX_NAME = "hn";

/**
 * Create the hash-backed `hn` search index (prefix `hn:`) if it doesn't already
 * exist. Sortable numeric fields use F64; DATE/KEYWORD fields are marked FAST so
 * histograms, sorts, and $terms aggregations work.
 */
const HN_SCHEMA = s.object({
  // Headline text for stories/jobs/polls. Empty for comments.
  title: s.string(),
  // Body text for comments + Ask HN posts. HTML stripped, capped ~1500 chars.
  text: s.string(),
  by: s.keyword(),        // KEYWORD FAST for $terms
  type: s.keyword(),      // story | comment | poll | job
  time: s.date().fast(),  // DATE FAST for histogram + sort
  score: s.number("F64"), // story upvotes, 0 for comments
  ndesc: s.number("F64"), // descendants / comment count
  parent: s.number("F64"),// parent story id for comments
});

async function ensureIndex(): Promise<void> {
  // Do not use CREATE as the existence probe. Upstash changed the duplicate
  // CREATE error from "already exists" to "Search entry should have an
  // initialized schema" in June 2026, which made every scheduled ingest abort
  // before its first write. DESCRIBE is the stable, read-only existence check.
  const handle = redis.search.index({ name: INDEX_NAME, schema: HN_SCHEMA });
  const existing = await handle.describe();
  if (existing) {
    console.log(`index "${INDEX_NAME}" already exists, skipping create`);
    return;
  }

  try {
    await redis.search.createIndex({
      name: INDEX_NAME,
      dataType: "hash",
      prefix: "hn:",
      schema: HN_SCHEMA,
    });
    console.log(`index "${INDEX_NAME}" created`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    // A concurrent creator between DESCRIBE and CREATE is also harmless.
    if (/already exists|initialized schema/i.test(msg)) {
      console.log(`index "${INDEX_NAME}" already exists, skipping create`);
    } else {
      throw e;
    }
  }
}

const TYPE_NAMES = ["", "story", "comment", "poll", "pollopt", "job"] as const;

// Empirically ~15k writes/s saturates the DB's server-side index throughput;
// 128 concurrency measured identical to 64, so 64 is the validated sweet spot.
const BATCH_SIZE = 1000;
const CONCURRENCY = 64;

type HnRow = {
  id: number;
  type: number;
  by: string | null;
  time: bigint | number | Date | null;
  title: string | null;
  text: string | null;
  url: string | null;
  score: number | null;
  descendants: number | null;
  parent: number | null;
  deleted: number;
  dead: number;
};

const TEXT_MAX = 1500;

const HTML_ENTITY: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'", nbsp: " ",
};

/** Strip HTML tags, decode common entities, collapse whitespace. */
function cleanText(s: string): string {
  if (!s) return "";
  // Replace <p> and <br> with spaces so paragraphs don't merge into one word.
  let out = s.replace(/<\/?(p|br|div|span|li|ul|ol|pre|code|i|em|b|strong)[^>]*>/gi, " ");
  out = out.replace(/<a [^>]*>([^<]*)<\/a>/gi, " $1 ");
  out = out.replace(/<[^>]+>/g, " ");
  out = out.replace(/&([a-zA-Z]+|#x?[0-9a-fA-F]+);/g, (_, ent) => HTML_ENTITY[ent] ?? " ");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > TEXT_MAX) out = out.slice(0, TEXT_MAX);
  return out;
}

function rowToHash(r: HnRow): Record<string, string | number> | null {
  if (r.deleted || r.dead) return null;
  const typeName = TYPE_NAMES[r.type] ?? null;
  if (!typeName) return null;
  if (!r.by) return null;

  let timeMs: number;
  if (r.time instanceof Date) timeMs = r.time.getTime();
  else if (typeof r.time === "bigint") timeMs = Number(r.time);
  else if (typeof r.time === "number") timeMs = r.time;
  else return null;
  if (!isFinite(timeMs) || timeMs < 1157000000000) return null;

  if (typeName === "story" || typeName === "job" || typeName === "poll") {
    if (!r.title || r.title.length === 0) return null;
    const out: Record<string, string | number> = {
      id: r.id,
      title: r.title,
      by: r.by,
      type: typeName,
      time: new Date(timeMs).toISOString(),
      score: r.score ?? 1,
      ndesc: r.descendants ?? 0,
      parent: 0,
    };
    // Some stories (Ask HN, Show HN) also have body text, so index it.
    if (r.text) {
      const txt = cleanText(r.text);
      if (txt) out.text = txt;
    }
    if (r.url) out.url = r.url;
    return out;
  }

  if (typeName === "comment") {
    if (!r.text) return null;
    const text = cleanText(r.text);
    // Drop near-empty / noise comments to keep the index meaningful.
    if (text.length < 12) return null;
    return {
      id: r.id,
      title: "", // empty so dateHistogram & terms still work
      text,
      by: r.by,
      type: typeName,
      time: new Date(timeMs).toISOString(),
      score: 0,
      ndesc: 0,
      parent: r.parent ?? 0,
    };
  }

  // Skip pollopt, they don't carry meaningful searchable content.
  return null;
}

async function flushBatchOnce(commands: unknown[][]): Promise<void> {
  // 60s explicit timeout per pipeline request; Bun's default seems to abort
  // sooner under load.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`pipeline ${res.status}: ${txt.slice(0, 400)}`);
    }
    const arr = (await res.json()) as Array<{ error?: string }>;
    for (const r of arr) {
      if (r && r.error) throw new Error(`pipeline error: ${r.error}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function flushBatch(commands: unknown[][]): Promise<void> {
  if (commands.length === 0) return;
  let attempt = 0;
  // Retry up to 5 times with exponential backoff on transient network errors.
  // Don't retry on permanent errors (auth, quota, syntax).
  while (true) {
    try {
      await flushBatchOnce(commands);
      return;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const transient =
        msg.includes("timed out") ||
        msg.includes("TimeoutError") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("UND_ERR") ||
        msg.includes("socket") ||
        msg.includes("network") ||
        msg.includes("aborted") ||
        msg.startsWith("pipeline 5") || // 5xx
        msg.startsWith("pipeline 429");
      attempt++;
      if (!transient || attempt > 5) throw e;
      const delay = Math.min(15_000, 500 * 2 ** attempt);
      console.warn(`flush retry ${attempt} after ${delay}ms (${msg.slice(0, 100)})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function hsetCommand(h: Record<string, string | number>): unknown[] {
  const args: (string | number)[] = [`hn:${h.id}`];
  for (const [k, v] of Object.entries(h)) args.push(k, v);
  return ["hset", ...args];
}

/** Flush many commands as parallel BATCH_SIZE pipelines. Waits for every
 *  pipeline to settle before rethrowing, so nothing is left in flight. */
async function flushAll(commands: unknown[][]): Promise<void> {
  const batches: unknown[][][] = [];
  for (let i = 0; i < commands.length; i += BATCH_SIZE) {
    batches.push(commands.slice(i, i + BATCH_SIZE));
  }
  const results = await Promise.allSettled(batches.map(flushBatch));
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
}

type MonthResult = "ok" | "missing" | "failed";

function parquetUrl(year: string, month: string): string {
  return `https://huggingface.co/datasets/open-index/hacker-news/resolve/main/data/${year}/${year}-${month}.parquet`;
}

/** Read one month's Parquet and HSET its items. Returns "missing" (no retry)
 *  when HuggingFace has no file for the month. */
async function ingestMonth(year: string, month: string): Promise<"ok" | "missing"> {
  const localPath = LOCAL_ARCHIVE
    ? `${LOCAL_ARCHIVE}/data/${year}/${year}-${month}.parquet`
    : null;
  const url = parquetUrl(year, month);
  const t0 = Date.now();
  const useLocal = !!localPath && existsSync(localPath);

  if (!useLocal) {
    // Probe first so a missing month is distinguishable from a transient error.
    const head = await fetch(url, { method: "HEAD" });
    if (head.status === 404) return "missing";
    if (!head.ok) throw new Error(`HEAD ${url} -> ${head.status}`);
  }
  console.log(`[${year}-${month}] reading parquet ${useLocal ? `(local ${localPath})` : "(HuggingFace)"}…`);

  const buf = useLocal
    ? await asyncBufferFromFile(localPath!)
    : await asyncBufferFromUrl({ url });
  const rows = (await parquetReadObjects({
    file: buf,
    compressors,
    columns: [
      "id",
      "type",
      "by",
      "time",
      "title",
      "text",
      "url",
      "score",
      "descendants",
      "parent",
      "deleted",
      "dead",
    ],
  })) as unknown as HnRow[];
  console.log(`[${year}-${month}] decoded ${rows.length.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  let pending: unknown[][] = [];
  const inflight = new Set<Promise<void>>();
  let written = 0;
  let skipped = 0;
  // First pipeline failure. Pipelines never reject (the error is captured
  // here), so none go unhandled; we stop queueing and let the rest settle
  // before throwing, so a retry never overlaps this attempt's writes.
  let failure: unknown = null;

  const queue = (batch: unknown[][]) => {
    const p: Promise<void> = flushBatch(batch)
      .then(
        () => {
          written += batch.length;
        },
        (e) => {
          failure ??= e;
        },
      )
      .finally(() => inflight.delete(p));
    inflight.add(p);
  };

  for (const raw of rows) {
    if (failure) break;
    const h = rowToHash(raw);
    if (!h) {
      skipped++;
      continue;
    }
    pending.push(hsetCommand(h));

    if (pending.length >= BATCH_SIZE) {
      const batch = pending;
      pending = [];
      while (inflight.size >= CONCURRENCY) {
        await Promise.race(inflight);
      }
      queue(batch);
    }
  }

  if (!failure && pending.length > 0) queue(pending);
  await Promise.all(inflight);
  if (failure) throw failure;

  const elapsed = (Date.now() - t0) / 1000;
  console.log(
    `[${year}-${month}] DONE written=${written.toLocaleString()} skipped=${skipped.toLocaleString()} in ${elapsed.toFixed(1)}s (${(written / elapsed).toFixed(0)}/s)`
  );
  return "ok";
}

type HnApiItem = {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  text?: string;
  url?: string;
  score?: number;
  descendants?: number;
  parent?: number;
  deleted?: boolean;
  dead?: boolean;
};

const HN_API = "https://hacker-news.firebaseio.com/v0";
const LIVE_FETCH_CONCURRENCY = 64;
// IDs fetched and flushed per chunk. Each chunk is fully written before the next
// starts, so the newest indexed item is always a safe resume point.
const LIVE_CHUNK_IDS = 5_000;
// Per-run budgets. 64-way fetching does ~300 items/s (measured Sep 2026) and HN
// adds ~14k IDs/day, so the tail clears ~200k IDs per run (a backlog catches up
// over a few runs) and the refresh ~45k, leaving room in the 30-min Action for
// the gallery primes that follow.
const LIVE_TAIL_BUDGET_MS = 12 * 60_000;
const REFRESH_BUDGET_MS = 5 * 60_000;
// Items are first fetched minutes after posting (score 1, no comments). Re-fetch
// the last few days so scores, comment counts and dead/deleted flags settle.
const REFRESH_WINDOW_MS = 3 * 24 * 60 * 60_000;

async function fetchJsonWithRetry<T>(url: string, tries = 4): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      if (attempt < tries) await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw last;
}

function apiItemToHash(item: HnApiItem | null): Record<string, string | number> | null {
  if (!item?.type || !item.time) return null;
  const type = TYPE_NAMES.indexOf(item.type as (typeof TYPE_NAMES)[number]);
  if (type < 0) return null;
  return rowToHash({
    id: item.id,
    type,
    by: item.by ?? null,
    time: item.time * 1000,
    title: item.title ?? null,
    text: item.text ?? null,
    url: item.url ?? null,
    score: item.score ?? null,
    descendants: item.descendants ?? null,
    parent: item.parent ?? null,
    deleted: Number(!!item.deleted),
    dead: Number(!!item.dead),
  });
}

/** Fetch items first..last (inclusive) from Firebase, LIVE_FETCH_CONCURRENCY at
 *  a time. Every worker settles before this returns or throws. */
async function fetchItems(first: number, last: number): Promise<(HnApiItem | null)[]> {
  const items = new Array<HnApiItem | null>(last - first + 1);
  let cursor = 0;
  let failure: unknown = null;
  await Promise.all(
    Array.from({ length: Math.min(LIVE_FETCH_CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length && !failure) {
        const i = cursor++;
        try {
          items[i] = await fetchJsonWithRetry<HnApiItem | null>(`${HN_API}/item/${first + i}.json`);
        } catch (e) {
          failure ??= e;
        }
      }
    }),
  );
  if (failure) throw failure;
  return items;
}

/** HSETs for live items; with `refresh`, also DELs items that are now dead or
 *  deleted (they were indexed while still alive). */
function liveCommands(items: (HnApiItem | null)[], refresh: boolean) {
  const commands: unknown[][] = [];
  let deleted = 0;
  let skipped = 0;
  for (const item of items) {
    const h = apiItemToHash(item);
    if (h) {
      commands.push(hsetCommand(h));
    } else if (refresh && item && (item.dead || item.deleted)) {
      commands.push(["del", `hn:${item.id}`]);
      deleted++;
    } else {
      skipped++;
    }
  }
  return { commands, written: commands.length - deleted, deleted, skipped };
}

type IndexedRow = { key?: string; data?: { id?: string | number } };

function indexedId(row: IndexedRow | undefined): number {
  return Number(row?.data?.id ?? row?.key?.replace(/^hn:/, ""));
}

/**
 * Keep the index current from HN's official Firebase API, independent of the
 * HuggingFace archive (which stopped publishing in August 2026):
 *
 *  1. Tail: fill IDs after the newest indexed item up to HN's max item, in
 *     LIVE_CHUNK_IDS chunks, until LIVE_TAIL_BUDGET_MS runs out. The next run
 *     resumes from the newest indexed item, so a large gap drains over several
 *     runs instead of failing.
 *  2. Refresh: re-fetch items indexed in the last REFRESH_WINDOW_MS (up to the
 *     newest item from before this run), newest first, re-HSET them with current
 *     score/comment counts and DEL the ones that are now dead or deleted.
 */
async function ingestLive(): Promise<void> {
  const index = redis.search.index({ name: INDEX_NAME, schema: HN_SCHEMA });
  const [rows, maxId] = await Promise.all([
    index.query({ orderBy: { time: "DESC" }, limit: 1 }),
    fetchJsonWithRetry<number>(`${HN_API}/maxitem.json`),
  ]);
  const latestId = indexedId(rows[0] as IndexedRow | undefined);
  if (!Number.isFinite(latestId)) {
    throw new Error("could not determine latest indexed HN id (empty index? ingest a month first)");
  }

  await fillTail(latestId, maxId);
  await refreshRecent(index, latestId);
}

async function fillTail(latestId: number, maxId: number): Promise<void> {
  const delta = maxId - latestId;
  if (delta <= 0) {
    console.log(`[live] already caught up (indexed=${latestId}, HN max=${maxId})`);
    return;
  }
  console.log(
    `[live] ${delta.toLocaleString()} IDs behind (indexed=${latestId}, HN max=${maxId}); budget ${LIVE_TAIL_BUDGET_MS / 60_000}min`,
  );
  const t0 = Date.now();
  let written = 0;
  let skipped = 0;
  let next = latestId + 1;

  while (next <= maxId && Date.now() - t0 < LIVE_TAIL_BUDGET_MS) {
    const last = Math.min(maxId, next + LIVE_CHUNK_IDS - 1);
    const r = liveCommands(await fetchItems(next, last), false);
    await flushAll(r.commands);
    written += r.written;
    skipped += r.skipped;
    next = last + 1;
    console.log(
      `[live] through ${last} (${(last - latestId).toLocaleString()}/${delta.toLocaleString()}) written=${written.toLocaleString()} in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
  }

  const left = maxId - next + 1;
  console.log(
    `[live] tail DONE written=${written.toLocaleString()} skipped=${skipped.toLocaleString()} in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
      (left > 0 ? `; budget reached, ${left.toLocaleString()} IDs left for the next run` : ""),
  );
}

async function refreshRecent(
  index: ReturnType<typeof redis.search.index<typeof HN_SCHEMA>>,
  latestId: number,
): Promise<void> {
  const since = new Date(Date.now() - REFRESH_WINDOW_MS).toISOString();
  const oldest = await index.query({
    filter: { time: { $gte: since } },
    orderBy: { time: "ASC" },
    limit: 1,
  });
  const firstId = indexedId(oldest[0] as IndexedRow | undefined);
  if (!Number.isFinite(firstId) || firstId > latestId) {
    console.log(`[refresh] nothing indexed since ${since} before this run; skipping`);
    return;
  }

  console.log(
    `[refresh] re-fetching IDs ${firstId}..${latestId} (${(latestId - firstId + 1).toLocaleString()}); budget ${REFRESH_BUDGET_MS / 60_000}min`,
  );
  const t0 = Date.now();
  let written = 0;
  let deleted = 0;
  let last = latestId;

  // Newest first: the youngest items have the stalest counts.
  while (last >= firstId && Date.now() - t0 < REFRESH_BUDGET_MS) {
    const first = Math.max(firstId, last - LIVE_CHUNK_IDS + 1);
    const r = liveCommands(await fetchItems(first, last), true);
    await flushAll(r.commands);
    written += r.written;
    deleted += r.deleted;
    last = first - 1;
  }

  const left = last - firstId + 1;
  console.log(
    `[refresh] DONE updated=${written.toLocaleString()} deleted=${deleted.toLocaleString()} in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
      (left > 0 ? `; budget reached, ${left.toLocaleString()} oldest IDs not refreshed` : ""),
  );
}

/**
 * Ingest one month, retrying on transient failures. The heavy Parquet read
 * (`asyncBufferFromUrl` + hyparquet range fetches) has no retry of its own, so a
 * passing HuggingFace 5xx/timeout would otherwise abort the whole month. Re-reads
 * the month from scratch on each attempt; `ingestMonth` only throws once its own
 * pipelines have settled, so attempts never overlap. A missing file is not
 * retried.
 */
async function ingestMonthWithRetry(
  year: string,
  mm: string,
  maxTries = 4,
): Promise<MonthResult> {
  for (let tries = 1; tries <= maxTries; tries++) {
    try {
      return await ingestMonth(year, mm);
    } catch (e) {
      console.error(
        `month ${year}-${mm} attempt ${tries}/${maxTries} failed:`,
        String((e as Error)?.message ?? e).slice(0, 200),
      );
      if (tries >= maxTries) {
        console.error(`giving up on ${year}-${mm}`);
        return "failed";
      }
      await new Promise((r) => setTimeout(r, 5000 * tries));
    }
  }
  return "failed";
}

/** True for the current/previous UTC month (or later): HuggingFace may not
 *  have published it yet, or ever again, and the Firebase tail covers it. */
function mayBeUnpublished(year: string, mm: string): boolean {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevYm = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${year}-${mm}` >= prevYm;
}

/** Collapse a month result into ok/not-ok, logging why a missing month is fine. */
function monthOk(year: string, mm: string, r: MonthResult): boolean {
  if (r === "ok") return true;
  if (r === "missing") {
    if (mayBeUnpublished(year, mm)) {
      console.log(`[${year}-${mm}] not on HuggingFace; skipping (the --live Firebase tail covers recent items)`);
      return true;
    }
    console.error(`[${year}-${mm}] not on HuggingFace (${parquetUrl(year, mm)})`);
  }
  return false;
}

const USAGE = `Usage (every mode writes to the Redis in UPSTASH_REDIS_REST_URL/TOKEN):
  bun scripts/ingest.ts <year> <month>        one month from the HuggingFace archive
  bun scripts/ingest.ts <year> Q<1-4>         one quarter
  bun scripts/ingest.ts <y1> <m1> <y2> <m2>   an inclusive month range
  bun scripts/ingest.ts --live                HN Firebase tail + 3-day refresh (daily cron)`;

async function main() {
  let args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (args.length === 1 && args[0] === "--live") {
    await ensureIndex();
    await ingestLive();
    return;
  }

  // Expand "<year> Q<1-4>" into the equivalent three-month range.
  if (args.length === 2 && /^q[1-4]$/i.test(args[1])) {
    const y = args[0];
    const firstMonth = (Number(args[1].slice(1)) - 1) * 3 + 1;
    args = [y, String(firstMonth), y, String(firstMonth + 2)];
  }

  const valid =
    (args.length === 2 || args.length === 4) &&
    args.every((a, i) => (i % 2 === 0 ? /^\d{4}$/.test(a) : /^(0?[1-9]|1[0-2])$/.test(a)));
  if (!valid) {
    console.error(USAGE);
    process.exit(1);
  }

  // Make sure the search index exists before we start writing hashes.
  await ensureIndex();

  if (args.length === 2) {
    const year = args[0];
    const month = args[1].padStart(2, "0");
    if (!monthOk(year, month, await ingestMonthWithRetry(year, month))) process.exit(1);
    return;
  }

  // Range: keep going past a bad month so one failure doesn't abort a long
  // backfill, but exit non-zero at the end if any month didn't make it.
  const [y1, m1, y2, m2] = args.map(Number);
  const bad: string[] = [];
  for (let y = y1; y <= y2; y++) {
    const fromM = y === y1 ? m1 : 1;
    const toM = y === y2 ? m2 : 12;
    for (let m = fromM; m <= toM; m++) {
      const year = String(y);
      const mm = String(m).padStart(2, "0");
      if (!monthOk(year, mm, await ingestMonthWithRetry(year, mm))) bad.push(`${year}-${mm}`);
    }
  }
  if (bad.length > 0) {
    console.error(`FAILED months: ${bad.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
