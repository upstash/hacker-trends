/**
 * Stream a Hacker News monthly Parquet file from HuggingFace and HSET each
 * eligible item into Upstash Redis, batched through the pipeline endpoint.
 *
 * Before ingesting, this also creates the `hn` Redis Search index (idempotent;
 * skipped if it already exists). RediSearch indexes both existing and future
 * keys matching the `hn:` prefix, so the hashes written below are picked up
 * automatically.
 *
 * Usage:
 *   bun scripts/ingest.ts 2026 03          (one month)
 *   bun scripts/ingest.ts 2026 Q1          (a quarter)
 *   bun scripts/ingest.ts 2024 1 2024 12   (a range)
 */

import {
  parquetReadObjects,
  asyncBufferFromUrl,
} from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { Redis, s } from "@upstash/redis";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const INDEX_NAME = "hn";

/**
 * Create the hash-backed `hn` search index (prefix `hn:`) if it doesn't already
 * exist. Sortable numeric fields use F64; DATE/KEYWORD fields are marked FAST so
 * histograms, sorts, and $terms aggregations work.
 */
async function ensureIndex(): Promise<void> {
  try {
    await redis.search.createIndex({
      name: INDEX_NAME,
      dataType: "hash",
      prefix: "hn:",
      schema: s.object({
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
      }),
    });
    console.log(`index "${INDEX_NAME}" created`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    // Already-created index is fine, we only need to guarantee it exists.
    if (/already exists/i.test(msg)) {
      console.log(`index "${INDEX_NAME}" already exists, skipping create`);
    } else {
      throw e;
    }
  }
}

const TYPE_NAMES = ["", "story", "comment", "poll", "pollopt", "job"] as const;

const BATCH_SIZE = 500;
const CONCURRENCY = 24;

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

async function ingestMonth(year: string, month: string) {
  const url = `https://huggingface.co/datasets/open-index/hacker-news/resolve/main/data/${year}/${year}-${month}.parquet`;
  const t0 = Date.now();
  console.log(`[${year}-${month}] reading parquet…`);

  const buf = await asyncBufferFromUrl({ url });
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

  for (const raw of rows) {
    const h = rowToHash(raw);
    if (!h) {
      skipped++;
      continue;
    }
    const args: (string | number)[] = [`hn:${h.id}`];
    for (const [k, v] of Object.entries(h)) args.push(k, v);
    pending.push(["hset", ...args]);

    if (pending.length >= BATCH_SIZE) {
      const batch = pending;
      pending = [];
      while (inflight.size >= CONCURRENCY) {
        await Promise.race(inflight);
      }
      const p = flushBatch(batch).then(() => {
        written += batch.length;
      });
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }
  }

  if (pending.length > 0) {
    const batch = pending;
    pending = [];
    const p = flushBatch(batch).then(() => {
      written += batch.length;
    });
    inflight.add(p);
    p.finally(() => inflight.delete(p));
  }
  await Promise.all(inflight);

  const elapsed = (Date.now() - t0) / 1000;
  console.log(
    `[${year}-${month}] DONE written=${written.toLocaleString()} skipped=${skipped.toLocaleString()} in ${elapsed.toFixed(1)}s (${(written / elapsed).toFixed(0)}/s)`
  );
}

// Catch unhandled rejections from the inflight pipeline promises so a single
// transient error doesn't tear the whole process down. flushBatch already
// retries on transients, so reaching here means the month-level await also
// rethrew; log and continue.
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection (ignoring):", String(reason).slice(0, 200));
});

/**
 * Ingest one month, retrying on transient failures. The heavy Parquet read
 * (`asyncBufferFromUrl` + hyparquet range fetches) has no retry of its own, so a
 * passing HuggingFace 5xx/timeout would otherwise abort the whole month - which
 * for the unattended daily cron means a failed run and stale data. Re-reads the
 * month from scratch on each attempt (503s are rare, so simple beats clever).
 * Returns true on success, false once retries are exhausted.
 */
async function ingestMonthWithRetry(
  year: string,
  mm: string,
  maxTries = 4,
): Promise<boolean> {
  for (let tries = 1; tries <= maxTries; tries++) {
    try {
      await ingestMonth(year, mm);
      return true;
    } catch (e) {
      console.error(
        `month ${year}-${mm} attempt ${tries}/${maxTries} failed:`,
        (e as Error).message.slice(0, 200),
      );
      if (tries >= maxTries) {
        console.error(`giving up on ${year}-${mm}`);
        return false;
      }
      await new Promise((r) => setTimeout(r, 5000 * tries));
    }
  }
  return false;
}

async function main() {
  let args = process.argv.slice(2);

  // Expand "<year> Q<1-4>" into the equivalent three-month range.
  if (args.length === 2 && /^q[1-4]$/i.test(args[1])) {
    const y = args[0];
    const firstMonth = (Number(args[1].slice(1)) - 1) * 3 + 1;
    args = [y, String(firstMonth), y, String(firstMonth + 2)];
  }

  if (args.length !== 2 && args.length !== 4) {
    console.error(
      "Usage: bun scripts/ingest.ts <year> <month> | <year> Q<1-4> | <y1> <m1> <y2> <m2>"
    );
    process.exit(1);
  }

  // Make sure the search index exists before we start writing hashes.
  await ensureIndex();

  // Single month (the daily cron path): exit non-zero if it ultimately fails so
  // CI surfaces a persistent outage instead of silently leaving the data stale.
  if (args.length === 2) {
    const ok = await ingestMonthWithRetry(args[0], args[1].padStart(2, "0"));
    if (!ok) process.exit(1);
    return;
  }

  // Range: best-effort across many months - a month that exhausts its retries is
  // logged and skipped so one bad month doesn't abort a long backfill.
  const [y1, m1, y2, m2] = args.map(Number);
  for (let y = y1; y <= y2; y++) {
    const fromM = y === y1 ? m1 : 1;
    const toM = y === y2 ? m2 : 12;
    for (let m = fromM; m <= toM; m++) {
      await ingestMonthWithRetry(String(y), String(m).padStart(2, "0"));
    }
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
