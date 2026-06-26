/**
 * Self-contained Hacker News -> Upstash Redis ingester. Streams the
 * open-index/hacker-news monthly Parquet archive (off a local copy when present,
 * else range-fetched from HuggingFace) and HSETs every eligible item into the
 * `hn:` keyspace + search index.
 *
 * Portable ops script: depends on nothing in src/ and reads credentials from the
 * env, so it can be copied out and run anywhere with `bun` (the only npm deps are
 * hyparquet + @upstash/redis). The token MUST be writable.
 *
 *   UPSTASH_REDIS_REST_URL=...  UPSTASH_REDIS_REST_TOKEN=...  bun scripts/ingest-server.ts [args]
 *
 * Optional env:
 *   HN_ARCHIVE   path to a local parquet archive laid out as
 *                <HN_ARCHIVE>/data/<year>/<year>-<month>.parquet. When a month's
 *                file is present there it is read off disk (faster + survives a
 *                flaky HuggingFace); otherwise the month is range-fetched.
 *
 * Index lifecycle (same fast pattern as build-hnjobs.ts): for a big backfill,
 * dropping the index first and creating it after the writes is faster (no live
 * index update per HSET). RediSearch on Upstash DOES backfill existing keys after
 * a create, but it can lag; verify the count after a drop->ingest->create run.
 *
 * Usage:
 *   bun scripts/ingest-server.ts 2026 06             # one month
 *   bun scripts/ingest-server.ts 2026 Q1             # a quarter
 *   bun scripts/ingest-server.ts 2024 01 2024 12     # an inclusive range
 *   bun scripts/ingest-server.ts --all               # full archive (2006-10 .. current month)
 *   bun scripts/ingest-server.ts 2024 01 2024 12 --no-index   # ingest without (re)creating the index
 *   bun scripts/ingest-server.ts --drop-index        # drop the `hn` index (KEEP hashes), exit
 *   bun scripts/ingest-server.ts --create-index      # create the `hn` index over existing hashes, exit
 */
import { parquetReadObjects, asyncBufferFromUrl, asyncBufferFromFile } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { Redis, s } from "@upstash/redis";
import { existsSync } from "node:fs";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!REDIS_URL || !REDIS_TOKEN) {
  console.error("Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in the env (writable token).");
  process.exit(1);
}
const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const INDEX_NAME = "hn";
const HN_ARCHIVE = process.env.HN_ARCHIVE ?? "";
const FIRST_ARCHIVE_MONTH = { year: 2006, month: 10 }; // earliest HN parquet

// ~15k writes/s saturates the DB's index throughput; 64 is the validated sweet spot.
const BATCH_SIZE = 1000;
const CONCURRENCY = 64;
const TEXT_MAX = 1500;
const TYPE_NAMES = ["", "story", "comment", "poll", "pollopt", "job"] as const;

const HN_SCHEMA = s.object({
  title: s.string(),
  text: s.string(),
  by: s.keyword(),
  type: s.keyword(),
  time: s.date().fast(),
  score: s.number("F64"),
  ndesc: s.number("F64"),
  parent: s.number("F64"),
});
const hnHandle = redis.search.index({ name: INDEX_NAME, schema: HN_SCHEMA });

async function ensureIndex(): Promise<void> {
  try {
    await redis.search.createIndex({ name: INDEX_NAME, dataType: "hash", prefix: "hn:", schema: HN_SCHEMA });
    console.log(`index "${INDEX_NAME}" created`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/already exists/i.test(msg)) console.log(`index "${INDEX_NAME}" already exists, skipping create`);
    else throw e;
  }
}

async function dropIndex(): Promise<void> {
  try {
    await hnHandle.drop();
    console.log(`index "${INDEX_NAME}" dropped (hn:* hashes kept)`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/not\s*exist|no such|unknown index|not found/i.test(msg)) console.log(`index "${INDEX_NAME}" did not exist; nothing to drop`);
    else throw e;
  }
}

type HnRow = {
  id: number; type: number; by: string | null; time: bigint | number | Date | null;
  title: string | null; text: string | null; url: string | null; score: number | null;
  descendants: number | null; parent: number | null; deleted: number; dead: number;
};

const HTML_ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'", nbsp: " " };

function cleanText(str: string): string {
  if (!str) return "";
  let out = str.replace(/<\/?(p|br|div|span|li|ul|ol|pre|code|i|em|b|strong)[^>]*>/gi, " ");
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
  if (!typeName || !r.by) return null;

  let timeMs: number;
  if (r.time instanceof Date) timeMs = r.time.getTime();
  else if (typeof r.time === "bigint") timeMs = Number(r.time);
  else if (typeof r.time === "number") timeMs = r.time;
  else return null;
  if (!isFinite(timeMs) || timeMs < 1157000000000) return null;

  if (typeName === "story" || typeName === "job" || typeName === "poll") {
    if (!r.title) return null;
    const out: Record<string, string | number> = {
      id: r.id, title: r.title, by: r.by, type: typeName,
      time: new Date(timeMs).toISOString(), score: r.score ?? 1, ndesc: r.descendants ?? 0, parent: 0,
    };
    if (r.text) { const txt = cleanText(r.text); if (txt) out.text = txt; }
    if (r.url) out.url = r.url;
    return out;
  }
  if (typeName === "comment") {
    if (!r.text) return null;
    const text = cleanText(r.text);
    if (text.length < 12) return null;
    return {
      id: r.id, title: "", text, by: r.by, type: typeName,
      time: new Date(timeMs).toISOString(), score: 0, ndesc: 0, parent: r.parent ?? 0,
    };
  }
  return null;
}

async function flushBatchOnce(commands: unknown[][]): Promise<void> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`pipeline ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const arr = (await res.json()) as Array<{ error?: string }>;
    for (const r of arr) if (r && r.error) throw new Error(`pipeline error: ${r.error}`);
  } finally {
    clearTimeout(timer);
  }
}

async function flushBatch(commands: unknown[][]): Promise<void> {
  if (commands.length === 0) return;
  let attempt = 0;
  while (true) {
    try { await flushBatchOnce(commands); return; }
    catch (e) {
      const msg = (e as Error).message ?? String(e);
      const transient = /timed out|TimeoutError|ECONNRESET|ETIMEDOUT|UND_ERR|socket|network|aborted/.test(msg) ||
        msg.startsWith("pipeline 5") || msg.startsWith("pipeline 429");
      attempt++;
      if (!transient || attempt > 5) throw e;
      const delay = Math.min(15_000, 500 * 2 ** attempt);
      console.warn(`flush retry ${attempt} after ${delay}ms (${msg.slice(0, 100)})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function ingestMonth(year: string, month: string): Promise<void> {
  const localPath = HN_ARCHIVE ? `${HN_ARCHIVE}/data/${year}/${year}-${month}.parquet` : "";
  const url = `https://huggingface.co/datasets/open-index/hacker-news/resolve/main/data/${year}/${year}-${month}.parquet`;
  const t0 = Date.now();
  const useLocal = !!localPath && existsSync(localPath);
  console.log(`[${year}-${month}] reading parquet ${useLocal ? `(local ${localPath})` : "(HuggingFace)"}…`);

  const buf = useLocal ? await asyncBufferFromFile(localPath) : await asyncBufferFromUrl({ url });
  const rows = (await parquetReadObjects({
    file: buf, compressors,
    columns: ["id", "type", "by", "time", "title", "text", "url", "score", "descendants", "parent", "deleted", "dead"],
  })) as unknown as HnRow[];
  console.log(`[${year}-${month}] decoded ${rows.length.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  let pending: unknown[][] = [];
  const inflight = new Set<Promise<void>>();
  let written = 0, skipped = 0;

  const launch = (batch: unknown[][]) => {
    const p = flushBatch(batch).then(() => { written += batch.length; });
    inflight.add(p);
    p.finally(() => inflight.delete(p));
  };

  for (const raw of rows) {
    const h = rowToHash(raw);
    if (!h) { skipped++; continue; }
    const cmd: (string | number)[] = [`hn:${h.id}`];
    for (const [k, v] of Object.entries(h)) cmd.push(k, v);
    pending.push(["hset", ...cmd]);
    if (pending.length >= BATCH_SIZE) {
      const batch = pending; pending = [];
      while (inflight.size >= CONCURRENCY) await Promise.race(inflight);
      launch(batch);
    }
  }
  if (pending.length > 0) launch(pending);
  await Promise.all(inflight);

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`[${year}-${month}] DONE written=${written.toLocaleString()} skipped=${skipped.toLocaleString()} in ${elapsed.toFixed(1)}s (${(written / elapsed).toFixed(0)}/s)`);
}

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection (ignoring):", String(reason).slice(0, 200));
});

async function ingestMonthWithRetry(year: string, mm: string, maxTries = 4): Promise<boolean> {
  for (let tries = 1; tries <= maxTries; tries++) {
    try { await ingestMonth(year, mm); return true; }
    catch (e) {
      console.error(`month ${year}-${mm} attempt ${tries}/${maxTries} failed:`, (e as Error).message.slice(0, 200));
      if (tries >= maxTries) { console.error(`giving up on ${year}-${mm}`); return false; }
      await new Promise((r) => setTimeout(r, 5000 * tries));
    }
  }
  return false;
}

/** [y1,m1,y2,m2] for "--all": the whole archive up to the current UTC month. */
function fullArchiveRange(): [number, number, number, number] {
  const now = new Date();
  return [FIRST_ARCHIVE_MONTH.year, FIRST_ARCHIVE_MONTH.month, now.getUTCFullYear(), now.getUTCMonth() + 1];
}

async function main() {
  let args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  args = args.filter((a) => !a.startsWith("--"));

  // Standalone index-lifecycle ops.
  if (flags.has("--drop-index")) { await dropIndex(); return; }
  if (flags.has("--create-index")) { await ensureIndex(); return; }

  // Resolve the month range to ingest.
  let range: [number, number, number, number];
  if (flags.has("--all")) {
    range = fullArchiveRange();
  } else if (args.length === 2 && /^q[1-4]$/i.test(args[1])) {
    const y = Number(args[0]); const fm = (Number(args[1].slice(1)) - 1) * 3 + 1;
    range = [y, fm, y, fm + 2];
  } else if (args.length === 2) {
    range = [Number(args[0]), Number(args[1]), Number(args[0]), Number(args[1])];
  } else if (args.length === 4) {
    range = [Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3])];
  } else {
    console.error("Usage: bun scripts/ingest-server.ts <year> <month> | <year> Q<1-4> | <y1> <m1> <y2> <m2> | --all  [--no-index|--drop-index|--create-index]");
    process.exit(1);
  }

  // Keep the index live unless --no-index (then create it afterwards with --create-index).
  if (flags.has("--no-index")) console.log(`--no-index: ingesting WITHOUT (re)creating "${INDEX_NAME}"; run --create-index when done`);
  else await ensureIndex();

  const [y1, m1, y2, m2] = range;
  const singleMonth = y1 === y2 && m1 === m2;
  let failed = 0;
  for (let y = y1; y <= y2; y++) {
    const fromM = y === y1 ? m1 : 1;
    const toM = y === y2 ? m2 : 12;
    for (let m = fromM; m <= toM; m++) {
      const ok = await ingestMonthWithRetry(String(y), String(m).padStart(2, "0"));
      if (!ok) failed++;
    }
  }
  if (failed > 0) {
    console.error(`${failed} month(s) failed.`);
    // A single targeted month failing is an error to surface (cron); a long
    // backfill logs + continues but still exits non-zero so it is noticed.
    process.exit(1);
  }
  if (singleMonth) return;
  console.log("DONE.");
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
