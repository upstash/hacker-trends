/**
 * Evaluate candidate "Relevance" scoring functions against live Upstash data.
 *
 * The Relevance sort blends BM25 text relevance with document signals (upvotes
 * = `score`, comment count = `ndesc`). Upstash SCOREFUNC lets us combine
 * MULTIPLE fields:
 *
 *   SCOREFUNC SCOREMODE sum COMBINEMODE sum
 *     FIELDVALUE score MODIFIER log1p FACTOR <a>
 *     FIELDVALUE ndesc MODIFIER log1p FACTOR <b>
 *   => finalScore = BM25 + a*log1p(upvotes) + b*log1p(comments)
 *
 * This script runs several candidate configs over a set of real example queries
 * and prints the top results for each, plus summary metrics, so we can eyeball
 * which blend surfaces the best mix of relevant + popular + discussed.
 *
 *   bun --env-file=.env.local scripts/eval-relevance.ts
 *   bun --env-file=.env.local scripts/eval-relevance.ts "rust" "ai bubble"   # custom queries
 *   bun --env-file=.env.local scripts/eval-relevance.ts --full               # show top rows
 */
export {};

const REST_URL = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
const LIMIT = 12;

// Local tokenizer + filter builders so the eval can A/B the phrase-boost arm
// independently of the shipping lib (kept in lockstep with src/lib/hn-query.ts).
function tokenize(q: string): string[] {
  const split = q.trim().split(/\s+/).flatMap((t) => t.split(/[^\p{L}\p{N}]+/u)).filter((t) => t.length >= 2);
  if (split.length > 0) return split;
  return q.trim().split(/\s+/).filter((t) => t.length > 0);
}
function tokenArm(t: string) {
  return { $or: [{ title: { $eq: t, $boost: 5.0 } }, { text: { $eq: t } }] };
}
// phraseBoost > 0: fold an exact-phrase title boost into the FIRST token arm.
// Same matched set (phrase-in-title implies token-in-title), pure scoring lift.
function buildFilter(q: string, phraseBoost: number): Record<string, unknown> {
  const tokens = tokenize(q);
  if (tokens.length === 0) return {};
  if (tokens.length === 1) return tokenArm(tokens[0]);
  const arms = tokens.map(tokenArm) as Record<string, unknown>[];
  if (phraseBoost > 0) {
    (arms[0].$or as unknown[]).push(
      { title: { $phrase: q.trim(), $boost: phraseBoost } },
      { text: { $phrase: q.trim(), $boost: phraseBoost * 0.35 } },
    );
  }
  return { $and: arms };
}

type ScoreFieldCfg = { field: "score" | "ndesc"; modifier: string; factor: number };
type Config = {
  name: string;
  // null = pure BM25 (no scorefunc); otherwise list of field contributions summed onto BM25.
  fields: ScoreFieldCfg[] | null;
  phrase: number; // exact-phrase title boost weight (0 = off)
  note: string;
};

// Candidate configs to compare. `score` = upvotes, `ndesc` = comment count.
// Fix the signal blend at pts50/cmt30 (best on earlier runs) and sweep the
// phrase-boost magnitude to find the gentle-tiebreaker sweet spot.
const SIG = [
  { field: "score" as const, modifier: "log1p", factor: 50 },
  { field: "ndesc" as const, modifier: "log1p", factor: 30 },
];
const CONFIGS: Config[] = [
  { name: "baseline(pts-only,noph)", phrase: 0, fields: [SIG[0]], note: "SHIPPING: BM25 + 50*log1p(points)" },
  { name: "pts+cmt phrase=0", phrase: 0, fields: SIG, note: "add comments, no phrase boost" },
  { name: "pts+cmt phrase=3", phrase: 3, fields: SIG, note: "gentle phrase tiebreaker" },
  { name: "pts+cmt phrase=5", phrase: 5, fields: SIG, note: "moderate phrase boost" },
  { name: "pts+cmt phrase=10", phrase: 10, fields: SIG, note: "strong phrase boost" },
];

const DEFAULT_QUERIES = [
  "rust", "bitcoin", "openai", "kubernetes", "react",
  "ai bubble", "self hosted", "postgres", "vision pro", "layoffs",
];

async function call<T>(parts: (string | number)[]): Promise<{ result?: T; error?: string }> {
  const path = parts.map((p) => encodeURIComponent(String(p))).join("/");
  const r = await fetch(`${REST_URL}/${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  return (await r.json()) as { result?: T; error?: string };
}

type Row = { title: string; score: number; ndesc: number; type: string; rel: number };

function parse(raw: unknown): Row[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<[string, string, Array<[string, string]>]>).map((row) => {
    const o: Record<string, string> = {};
    for (const [k, v] of row[2]) o[k] = v;
    return {
      title: (o.title || o.text || "").slice(0, 64),
      score: Number(o.score ?? 0),
      ndesc: Number(o.ndesc ?? 0),
      type: o.type ?? "?",
      rel: parseFloat(row[1]),
    };
  });
}

function buildArgs(q: string, cfg: Config): (string | number)[] {
  const args: (string | number)[] = [
    "search.query", "hn", JSON.stringify(buildFilter(q, cfg.phrase)), "LIMIT", LIMIT,
  ];
  if (cfg.fields && cfg.fields.length) {
    args.push("SCOREFUNC", "SCOREMODE", "sum");
    if (cfg.fields.length > 1) args.push("COMBINEMODE", "sum");
    for (const f of cfg.fields) {
      args.push("FIELDVALUE", f.field, "MODIFIER", f.modifier, "FACTOR", f.factor);
    }
  }
  return args;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function run(q: string, cfg: Config): Promise<Row[]> {
  const j = await call<unknown>(buildArgs(q, cfg));
  if (j.error) {
    console.error(`  ERR [${cfg.name}] ${q}: ${j.error}`);
    return [];
  }
  // SEARCH.QUERY result is a flat array of [key, relScore, fields[]] rows.
  return parse(j.result);
}

const SHOW_ROWS = process.argv.includes("--full");
const QUERIES = (() => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  return args.length ? args : DEFAULT_QUERIES;
})();

async function main() {
  console.log(`Evaluating ${CONFIGS.length} configs over ${QUERIES.length} queries (top ${LIMIT}).\n`);
  for (const c of CONFIGS) console.log(`  · ${c.name.padEnd(24)} ${c.note}`);
  console.log();

  // Per-config aggregate metrics across all queries.
  const agg: Record<string, { medPts: number[]; medCmt: number[]; storyFrac: number[]; zeroPts: number[] }> = {};
  for (const c of CONFIGS) agg[c.name] = { medPts: [], medCmt: [], storyFrac: [], zeroPts: [] };

  for (const q of QUERIES) {
    console.log(`\n${"=".repeat(78)}\nQUERY: "${q}"`);
    for (const cfg of CONFIGS) {
      const rows = await run(q, cfg);
      const top = rows.slice(0, LIMIT);
      const pts = top.map((r) => r.score);
      const cmt = top.map((r) => r.ndesc);
      const storyFrac = top.length ? top.filter((r) => r.type === "story").length / top.length : 0;
      const zeroPts = top.length ? top.filter((r) => r.score <= 1).length / top.length : 0;
      agg[cfg.name].medPts.push(median(pts));
      agg[cfg.name].medCmt.push(median(cmt));
      agg[cfg.name].storyFrac.push(storyFrac);
      agg[cfg.name].zeroPts.push(zeroPts);

      console.log(
        `  ${cfg.name.padEnd(24)} medPts=${String(median(pts)).padStart(5)} ` +
        `medCmt=${String(median(cmt)).padStart(5)} story%=${(storyFrac * 100).toFixed(0).padStart(3)} ` +
        `low%=${(zeroPts * 100).toFixed(0).padStart(3)}`,
      );
      if (SHOW_ROWS) {
        for (const r of top.slice(0, 6)) {
          console.log(`        ${String(r.score).padStart(5)}p ${String(r.ndesc).padStart(4)}c ${r.type.padEnd(7)} ${r.title}`);
        }
      }
    }
  }

  console.log(`\n\n${"#".repeat(78)}\nSUMMARY (averaged across queries)\n`);
  const avg = (xs: number[]) => (xs.reduce((s, x) => s + x, 0) / (xs.length || 1));
  console.log(`${"config".padEnd(24)} ${"avgMedPts".padStart(9)} ${"avgMedCmt".padStart(9)} ${"story%".padStart(7)} ${"low%".padStart(6)}`);
  console.log("-".repeat(64));
  for (const c of CONFIGS) {
    const a = agg[c.name];
    console.log(
      `${c.name.padEnd(24)} ${avg(a.medPts).toFixed(0).padStart(9)} ${avg(a.medCmt).toFixed(0).padStart(9)} ` +
      `${(avg(a.storyFrac) * 100).toFixed(0).padStart(7)} ${(avg(a.zeroPts) * 100).toFixed(0).padStart(6)}`,
    );
  }
  console.log(`\nlow% = share of top-${LIMIT} with <=1 upvote (BM25 noise). Lower is better.`);
  console.log(`story% = share that are stories vs bare comments.`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
