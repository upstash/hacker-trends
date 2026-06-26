/**
 * Self-contained rebuild of the dedicated `hnjobs` Upstash Search index used by
 * the "Who is hiring?" page. ONE document per job posting (a top-level comment
 * under a monthly hiring thread), each carrying a precomputed direct-children
 * `replies` count.
 *
 * Portable ops script: it depends on nothing in src/ (the thread list + schema
 * are baked in) and reads credentials from the env, so it can be copied out and
 * run anywhere with just `bun` + network access. The token MUST be writable (the
 * deployed app's read-only token won't do).
 *
 *   UPSTASH_REDIS_REST_URL=...  UPSTASH_REDIS_REST_TOKEN=...  bun scripts/build-hnjobs.ts [args]
 *
 * Why drop-then-create (the fast path): with the index live, every HSET also
 * pays the server-side index update, and the page could query a half-built index
 * mid-run. So the default rebuild DROPS the index (keeping the hnjob:* hashes),
 * upserts every posting index-free, then CREATES the index once at the end.
 * NOTE: a freshly created Upstash index does not reliably backfill pre-existing
 * keys; if a create-at-the-end run leaves the index near-empty, re-run with
 * `--all` (no `--no-index`) so the live HSETs index as they are written.
 *
 * Usage:
 *   bun scripts/build-hnjobs.ts --rebuild        # full: drop -> upsert all -> create
 *   bun scripts/build-hnjobs.ts --all            # upsert every month (index lifecycle untouched)
 *   bun scripts/build-hnjobs.ts 2026-06          # one month
 *   bun scripts/build-hnjobs.ts 2025-01 2025-12  # an inclusive month range
 *   bun scripts/build-hnjobs.ts --drop-index     # drop the index (KEEP hashes), exit
 *   bun scripts/build-hnjobs.ts --create-index   # create the index over existing hashes, exit
 *   bun scripts/build-hnjobs.ts --all --no-index # upsert all WITHOUT (re)creating the index
 *
 * Flags compose with the month selectors: `--no-index` skips the (re)create,
 * `--drop-index` / `--create-index` are standalone. The destructive full
 * lifecycle (drop -> upsert-all -> create) requires the explicit `--rebuild`
 * flag; running with NO args just prints this usage and does nothing.
 */
import { Redis, s } from "@upstash/redis";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!REDIS_URL || !REDIS_TOKEN) {
  console.error(
    "Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in the env (writable token).",
  );
  process.exit(1);
}
const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const JOBS_INDEX = "hnjobs";
const JOBS_PREFIX = "hnjob:";
const PAGE = 500; // hn index hard cap is <1000
const CHILDREN_BATCH = 64; // posting ids OR'd per reply-count lookup

/** Every monthly "Who is hiring?" thread: [month, storyId]. Baked in so the
 *  script needs nothing from the repo. Append new months here as they appear. */
const THREADS: [string, number][] = [["2011-04",2396027],["2011-05",2503204],["2011-06",2607052],["2011-08",2831646],["2011-09",2949787],["2011-10",3060221],["2011-11",3181796],["2011-12",3300371],["2012-01",3412900],["2012-02",3537881],["2012-03",3652041],["2012-04",3783657],["2012-05",3913997],["2012-06",4053076],["2012-07",4184755],["2012-08",4323597],["2012-09",4463689],["2012-10",4596375],["2012-11",4727241],["2012-12",4857714],["2013-01",4992617],["2013-02",5150834],["2013-03",5304169],["2013-04",5472746],["2013-05",5637663],["2013-06",5803764],["2013-07",5970187],["2013-08",6139927],["2013-09",6310234],["2013-10",6475879],["2013-11",6653437],["2013-12",6827554],["2014-01",6995020],["2014-02",7162197],["2014-03",7324236],["2014-04",7507765],["2014-05",7679431],["2014-06",7829042],["2014-07",7970366],["2014-08",8120070],["2014-09",8252715],["2014-10",8394339],["2014-11",8542892],["2014-12",8681040],["2015-01",8822808],["2015-02",8980047],["2015-03",9127232],["2015-06",9639001],["2015-07",9812245],["2015-08",9996333],["2015-09",10152809],["2015-10",10311580],["2015-11",10492086],["2015-12",10655740],["2016-01",10822019],["2016-02",11012044],["2016-03",11202954],["2016-04",11405239],["2016-05",11611867],["2016-06",11814828],["2016-07",12016568],["2016-08",12202865],["2016-09",12405698],["2016-10",12627852],["2016-11",12846216],["2016-12",13080280],["2017-01",13301832],["2017-02",13541679],["2017-03",13764728],["2017-04",14023198],["2017-05",14238005],["2017-06",14460777],["2017-07",14688684],["2017-08",14901313],["2017-09",15148885],["2017-10",15384262],["2017-11",15601729],["2017-12",15824597],["2018-01",16052538],["2018-02",16282819],["2018-03",16492994],["2018-04",16735011],["2018-05",16967543],["2018-06",17205865],["2018-07",17442187],["2018-08",17663077],["2018-09",17902901],["2018-10",18113144],["2018-11",18354503],["2018-12",18589702],["2019-01",18807017],["2019-02",19055166],["2019-03",19281834],["2019-04",19543940],["2019-05",19797594],["2019-06",20083795],["2019-07",20325925],["2019-08",20584311],["2019-09",20867123],["2019-10",21126014],["2019-11",21419536],["2019-12",21683554],["2020-01",21936440],["2020-02",22225314],["2020-03",22465476],["2020-04",22749308],["2020-05",23042618],["2020-06",23379196],["2020-07",23702122],["2020-08",24038520],["2020-09",24342498],["2020-10",24651639],["2020-11",24969524],["2020-12",25266288],["2021-01",25632982],["2021-02",25989764],["2021-03",26304051],["2021-04",26661443],["2021-05",27025922],["2021-06",27355392],["2021-07",27699704],["2021-08",28037366],["2021-09",28380661],["2021-10",28719320],["2021-11",29067493],["2021-12",29405056],["2022-01",29782099],["2022-02",30164271],["2022-03",30515750],["2022-04",30878761],["2022-05",31235968],["2022-06",31582796],["2022-07",31947297],["2022-08",32306920],["2022-09",32677265],["2022-10",33068421],["2022-11",33422129],["2022-12",33818037],["2023-01",34219335],["2023-02",34612353],["2023-03",34983767],["2023-04",35424807],["2023-05",35773707],["2023-06",36152014],["2023-07",36573871],["2023-08",36956867],["2023-09",37351667],["2023-10",37739028],["2023-11",38099086],["2023-12",38490811],["2024-01",38842977],["2024-02",39217310],["2024-03",39562986],["2024-04",39894820],["2024-05",40224213],["2024-06",40563283],["2024-07",40846428],["2024-08",41129813],["2024-09",41425910],["2024-10",41709301],["2024-11",42017580],["2024-12",42297424],["2025-01",42575537],["2025-02",42919502],["2025-03",43243024],["2025-04",43547611],["2025-05",43858554],["2025-06",44159528],["2025-07",44434576],["2025-08",44757794],["2025-09",45093192],["2025-10",45438503],["2025-11",45800465],["2025-12",46108941],["2026-01",46466074],["2026-02",46857488],["2026-03",47219668],["2026-04",47601859],["2026-05",47975571],["2026-06",48357725]];

/** hnjobs field schema (mirrors the `hn` schema + a real `replies` count). */
const JOBS_SCHEMA = s.object({
  title: s.string(), text: s.string(), by: s.keyword(), type: s.keyword(),
  time: s.date().fast(), parent: s.number("F64"), thread: s.keyword(),
  score: s.number("F64"), replies: s.number("F64"),
});
const jobsHandle = redis.search.index({ name: JOBS_INDEX, schema: JOBS_SCHEMA });

/** The shared `hn` index we READ postings + children from (SDK handle so the
 *  read-your-writes sync token routes us to an up-to-date replica - a raw REST
 *  call to a stale replica fails with "schema not initialized"). */
const hn = redis.search.index({
  name: "hn",
  schema: s.object({
    title: s.string(), text: s.string(), by: s.keyword(), type: s.keyword(),
    time: s.date().fast(), parent: s.number("F64"),
  }),
});

type HnDoc = { id?: string | number; text?: string; by?: string; time?: string; parent?: string | number };

/** Query the `hn` index for every doc matching `filter`, paginated, with retry
 *  so a transient null/5xx doesn't abort the run. */
async function queryAll(filter: Record<string, unknown>): Promise<HnDoc[]> {
  const out: HnDoc[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let page: Array<{ data: HnDoc }> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        page = (await hn.query({ filter, limit: PAGE, offset })) as Array<{ data: HnDoc }> | null;
        if (page) break;
      } catch { /* backoff + retry */ }
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
    if (!page) throw new Error(`queryAll: page at offset ${offset} kept failing`);
    for (const row of page) out.push(row.data);
    if (page.length < PAGE) break;
  }
  return out;
}

type Posting = { id: number; text: string; by: string; time: string };

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

/** HSET one month's postings via the raw /pipeline endpoint. */
async function writePostings(postings: Posting[], replies: Map<number, number>, month: string, threadId: number): Promise<void> {
  if (postings.length === 0) return;
  const commands = postings.map((p) => [
    "hset", `${JOBS_PREFIX}${p.id}`,
    "id", p.id, "title", "", "text", p.text, "by", p.by, "type", "comment",
    "time", p.time, "parent", threadId, "thread", month, "score", 0,
    "replies", replies.get(p.id) ?? 0,
  ]);
  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`pipeline HSET failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
}

async function ingestThread([month, threadId]: [string, number]) {
  const postings = await fetchPostings(threadId);
  const replies = await buildReplyCounts(postings.map((p) => p.id));
  await writePostings(postings, replies, month, threadId);
  let withReplies = 0;
  for (const p of postings) if ((replies.get(p.id) ?? 0) > 0) withReplies++;
  return { postings: postings.length, withReplies };
}

async function dropIndex(): Promise<void> {
  try {
    await jobsHandle.drop();
    console.log(`index "${JOBS_INDEX}" dropped (hnjob:* hashes kept)`);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (/not\s*exist|no such|unknown index|not found/i.test(msg)) console.log(`index "${JOBS_INDEX}" did not exist; nothing to drop`);
    else throw e;
  }
}

async function createIndex(): Promise<void> {
  try {
    await redis.search.createIndex({ name: JOBS_INDEX, dataType: "hash", prefix: JOBS_PREFIX, schema: JOBS_SCHEMA });
    console.log(`index "${JOBS_INDEX}" created over the hnjob:* hashes`);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (/already exists/i.test(msg)) console.log(`index "${JOBS_INDEX}" already exists`);
    else throw e;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));

  // Standalone index-lifecycle ops.
  if (flags.has("--drop-index")) { await dropIndex(); return; }
  if (flags.has("--create-index")) { await createIndex(); return; }

  // Nothing to do without an explicit selector - printing usage beats silently
  // running the destructive full rebuild (which is what a bare invocation used
  // to do; bun auto-loads .env so even an "unset creds" run is live).
  if (args.length === 0) {
    console.error("Nothing to do. Pass --rebuild (full drop->upsert->create), --all, a month (2026-06), a range (2025-01 2025-12), --drop-index, or --create-index.");
    process.exit(1);
  }

  // The destructive full lifecycle: drop -> upsert all -> create.
  const fullLifecycle = flags.has("--rebuild");

  let targets: [string, number][];
  if (fullLifecycle || flags.has("--all")) {
    targets = THREADS;
  } else if (positional.length === 2) {
    targets = THREADS.filter(([m]) => m >= positional[0] && m <= positional[1]);
  } else if (positional.length === 1) {
    targets = THREADS.filter(([m]) => m === positional[0]);
  } else {
    targets = THREADS;
  }
  if (targets.length === 0) { console.error(`no threads matched ${positional.join("..")}`); process.exit(1); }

  if (fullLifecycle) await dropIndex();
  else if (!flags.has("--no-index")) {
    // A month/range/--all run without --no-index keeps the index live so the
    // HSETs index as written (the reliable path when backfill won't trigger).
    await createIndex();
  }

  console.log(`upserting ${targets.length} month(s)${flags.has("--no-index") || fullLifecycle ? " (index-free)" : ""} ...`);
  let totalPostings = 0, totalWithReplies = 0, failed = 0;
  for (const t of targets) {
    // Per-month retry: a ~90-min full run hits the occasional transient
    // ECONNRESET; retry the whole (idempotent) month rather than abort.
    let r: { postings: number; withReplies: number } | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { r = await ingestThread(t); break; }
      catch (e) {
        console.error(`[${t[0]}] attempt ${attempt + 1} failed: ${(e as Error)?.message ?? e} - retrying`);
        await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
      }
    }
    if (!r) { console.error(`[${t[0]}] FAILED after retries - skipping`); failed++; continue; }
    totalPostings += r.postings; totalWithReplies += r.withReplies;
    console.log(`[${t[0]}] postings=${r.postings} withReplies=${r.withReplies}`);
  }
  console.log(`UPSERT DONE: ${totalPostings} postings across ${targets.length} month(s); ${totalWithReplies} had >=1 reply; ${failed} month(s) failed.`);

  if (fullLifecycle) {
    await createIndex();
    if (failed > 0) console.error(`WARNING: ${failed} month(s) failed and are NOT indexed - re-run those ranges with the index live.`);
  }
  console.log("DONE.");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
