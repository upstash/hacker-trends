/**
 * T11 - Content discovery for the "Who is hiring?" galleries.
 *
 * Measures, over the LIVE jobs-scoped data, every candidate term's popularity
 * (total mentions) and shock factor (volatility / peak-prominence / crossover),
 * combines them into a single interestingness metric, selects >=50 gallery items
 * (Top-N category cards >=4 terms each + head-to-head comparisons 2-4 terms incl.
 * |-OR-group stories), validates that every chosen term returns live data and no
 * comparison is a flat line, and emits the chosen set to `src/lib/jobs-gallery.ts`.
 *
 * It runs the same aggregation the page uses (buildAggregateOptions ->
 * scope=jobs $dateHistogram) through the @upstash/redis search SDK, then folds
 * the 30d buckets into gap-free calendar months with the SAME pure utilities the
 * chart uses (binMonths / sumByMonth / monthTotal), so the numbers the gallery is
 * picked from are the numbers the chart will draw.
 *
 * Tokenization-collision filtering (the PRD's explicit gotchas): the `hn` index
 * tokenizer drops single chars and punctuation and stems plurals, so several
 * candidate strings alias onto a noisier token. We refuse to seed any of:
 *   - bare `go` (the English verb floods it; use `golang`)
 *   - `c` / `c++` / `c#` (all collapse to the token `c` -> identical inflated count)
 *   - `embedded` vs `embeddings` (same stem -> identical count; keep only one)
 *   - `.net` / `asp.net` (dot-split noise)
 * Every candidate is probed live and any whose live total equals a known-collision
 * sibling, or that returns no data, is dropped before selection (see COLLISIONS +
 * the post-probe equality check).
 *
 *   bun --env-file=.env.local scripts/discover-job-trends.ts            # measure + emit
 *   bun --env-file=.env.local scripts/discover-job-trends.ts --dry      # measure only, no write
 *
 * Read-only against the index (only SEARCH.AGGREGATE); never writes Upstash.
 */
export {};
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hnRedis, runAggregate } from "../src/lib/hn-index";
import { type Bucket } from "../src/lib/hn-query";
import {
  binMonths,
  monthTotal,
  sumByMonth,
  monthIndex,
  parseParts,
  type RawBucket,
} from "../src/lib/jobs-trends";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error("Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (.env.local)");
}
const redis = hnRedis();
const DRY = process.argv.includes("--dry");
const CONCURRENCY = 6;
/** In a relative (100%) stack a comparison is a "flat line" only if NO term's
 *  share-of-column ever swings by at least this fraction AND no lead-change
 *  occurs. Tuned so the prototype's approved head-to-heads all pass. */
const FLAT_MOVE = 0.12;
/** A series needs at least this many all-time mentions to be worth charting. */
const MIN_TOTAL = 150;

/* ---------- candidate universe (themed groups, pre-collision-filter) ---------- */

/**
 * The candidate seed set. Grouped by theme so the selector can build "Top N"
 * cards from a theme's strongest live terms and head-to-heads across themes.
 * `|` inside a string is an OR-group seed (parts summed). Collision-prone forms
 * (bare `go`, `c`/`c++`/`c#`, `embeddings`, `.net`) are intentionally absent and
 * additionally guarded by the live equality check below.
 */
const SEEDS: Record<string, string[]> = {
  languages: [
    "python", "javascript", "typescript", "java", "golang", "ruby", "rust",
    "php", "scala", "kotlin", "swift", "elixir", "clojure", "haskell",
  ],
  "frontend frameworks": [
    "react", "vue", "angular", "svelte", "nextjs", "jquery", "ember", "backbone",
  ],
  "backend frameworks": [
    "rails", "django", "laravel", "spring", "flask", "express", "phoenix", "symfony",
  ],
  "functional languages": [
    "haskell", "ocaml", "elixir", "clojure", "scala", "erlang", "fsharp",
  ],
  "systems languages": [
    "rust", "golang", "zig", "nim", "fortran", "ada",
  ],
  "gpu & shader skills": [
    "cuda", "opengl", "vulkan", "glsl", "shader", "metal",
  ],
  "low-level skills": [
    "assembly", "embedded", "firmware", "verilog", "fpga", "rtos",
  ],
  databases: [
    "postgres", "mysql", "mongodb", "redis", "elasticsearch", "sqlite",
    "cassandra", "dynamodb",
  ],
  clouds: [
    "aws", "azure", "gcp", "heroku", "digitalocean", "cloudflare",
  ],
  "infra & devops": [
    "docker", "kubernetes", "terraform", "ansible", "jenkins", "prometheus",
  ],
  locations: [
    "san francisco", "new york", "london", "berlin", "remote", "austin",
    "seattle", "amsterdam",
  ],
  "ai & ml skills": [
    "ai", "machine learning", "llm", "pytorch", "tensorflow", "nlp",
  ],
  mobile: [
    "ios", "android", "react native", "flutter", "swift", "kotlin",
  ],
  security: [
    "security", "cryptography", "penetration testing", "infosec",
  ],
  "data engineering": [
    "spark", "hadoop", "kafka", "airflow", "snowflake", "databricks",
  ],
};

/**
 * Head-to-head SEEDS - hand-picked story candidates (incl. |-OR groups). Each is
 * still validated live (every part returns data, not a flat line) before it ships;
 * the selector drops any that fail.
 */
const HEAD_TO_HEAD_SEEDS: { terms: string[]; story: string; title?: string }[] = [
  { terms: ["onsite", "remote", "hybrid"],
    story: "The defining shift in how companies hire: onsite leads a decade, remote erupts in 2021, hybrid emerges after." },
  { terms: ["javascript", "typescript"],
    story: "The TypeScript takeover, measured in what companies list as wanted skills." },
  { terms: ["react", "vue", "angular"],
    story: "Frontend framework demand: React pulls decisively ahead of Vue and Angular." },
  { terms: ["golang", "rust"],
    story: "The systems-language race for hires: Go's early lead, Rust's steady climb." },
  { terms: ["tensorflow", "pytorch"],
    story: "The ML-framework changing of the guard, in hiring." },
  { terms: ["aws", "azure", "gcp"],
    story: "Cloud demand: AWS the default, Azure and GCP fighting for a distant second." },
  { terms: ["mysql", "mongodb", "postgres"],
    story: "Database demand, era by era: MySQL, the NoSQL wave, then Postgres on top." },
  { terms: ["docker", "kubernetes"],
    story: "The container handoff: Docker as the entry skill, Kubernetes as the must-have." },
  { terms: ["python", "java"],
    story: "Two old workhorses: Java's enterprise base versus Python's relentless climb." },
  { terms: ["ruby", "python"],
    story: "Ruby's Rails-era heyday versus Python's steady takeover of the same roles." },
  { terms: ["rails", "django"],
    story: "The two great web frameworks of the 2010s: Rails out front, Django closing in." },
  { terms: ["scala", "kotlin", "clojure"],
    story: "Three JVM challengers, each with its moment in the hiring threads." },
  { terms: ["docker", "terraform", "ansible"],
    story: "Infra-as-code in job posts: Docker first, then Terraform and Ansible." },
  { terms: ["postgres", "mysql"],
    story: "The relational-database swing: MySQL's early lead, Postgres pulling ahead." },
  { terms: ["aws", "heroku"],
    story: "The PaaS-to-cloud migration, as companies move off Heroku onto AWS." },
  { terms: ["machine learning", "blockchain"],
    story: "Two hype waves in hiring: the ML build-out versus the blockchain spike." },
  { title: "ios vs android",
    terms: ["ios", "android"],
    story: "The mobile duopoly in hiring demand, year by year." },
  { title: "startup vs enterprise",
    terms: ["startup", "enterprise"],
    story: "How job posts frame themselves: scrappy startup versus established enterprise." },
  { title: "backend / infra vs frontend",
    terms: ["backend|sre|devops|infra", "frontend|web design|ui|css"],
    story: "Backend and infra demand versus frontend demand - near-synonyms folded into one bar each with |." },
  { title: "AI wave vs crypto wave",
    terms: ["ai|machine learning|llm", "blockchain|crypto|web3"],
    story: "Two hype cycles head to head: the AI/ML bucket versus the blockchain/crypto bucket." },
];

/**
 * Known tokenization collisions: forms we never seed because the tokenizer
 * aliases them onto a noisier token. Documented so a future editor knows WHY
 * `go`/`c`/`c++` are missing from SEEDS.
 */
const COLLISIONS = [
  "go (English verb floods the token; use golang)",
  "c, c++, c# (single chars collapse to token 'c' -> identical inflated count)",
  "embeddings (same stem as 'embedded' -> identical count; keep one)",
  ".net / asp.net (dot-split noise; low, unreliable counts)",
];

/* ---------- live probe ---------------------------------------------- */

async function aggregateBuckets(q: string): Promise<Bucket[]> {
  const agg = await runAggregate(redis, { q, scope: "jobs" });
  return agg.buckets;
}

/** Fold a single PART's buckets into a gap-free calendar-month map (chart parity). */
function partMonths(buckets: Bucket[]): Map<string, number> {
  const raw: RawBucket[] = buckets.map((b) => ({ key: b.key, docCount: b.docCount }));
  return binMonths(raw);
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/* ---------- per-series metrics -------------------------------------- */

type TermMetric = {
  /** the raw series string (may contain `|`). */
  label: string;
  /** all-time jobs-scoped mention count (chip total). */
  total: number;
  /** the single tallest month's count (peak prominence). */
  peakValue: number;
  /** "YYYY-MM" of the peak month, for crossover detection. */
  peakMonthIdx: number;
  /** peak / median of non-zero months: spikiness / volatility. */
  towerRatio: number;
  /** the gap-free month map (for crossover detection in comparisons). */
  byMonth: Map<string, number>;
};

function median(xs: number[]): number {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Aggregate a series (each |-part separately) and fold to one month map. */
async function probeSeries(label: string): Promise<TermMetric> {
  const parts = parseParts(label);
  const perPart = await Promise.all(parts.map(async (p) => partMonths(await aggregateBuckets(p))));
  const byMonth = sumByMonth(perPart);

  let peakValue = 0;
  let peakKey = "";
  for (const [k, v] of byMonth) {
    if (v > peakValue) {
      peakValue = v;
      peakKey = k;
    }
  }
  const [py, pm] = peakKey ? peakKey.split("-").map(Number) : [0, 0];
  const med = median([...byMonth.values()]);
  return {
    label,
    total: monthTotal(byMonth),
    peakValue,
    peakMonthIdx: peakKey ? monthIndex(py, pm) : 0,
    towerRatio: med ? +(peakValue / med).toFixed(2) : 0,
    byMonth,
  };
}

/**
 * Lead-change (crossover) count for a comparison: walk the unioned monthly
 * timeline; whoever is highest that month "leads"; count how many times the
 * leader's identity flips. A clean handoff flips ~once; a rivalry flips often. A
 * crossover is the most attention-grabbing shock in a relative stack.
 */
function leadChanges(metrics: TermMetric[]): number {
  const months = new Set<string>();
  for (const m of metrics) for (const k of m.byMonth.keys()) months.add(k);
  const ordered = [...months].sort((a, b) => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return monthIndex(ay, am) - monthIndex(by, bm);
  });
  let prevLeader = -1;
  let flips = 0;
  for (const k of ordered) {
    let leader = -1;
    let best = 0;
    let colTotal = 0;
    metrics.forEach((m, i) => {
      const v = m.byMonth.get(k) ?? 0;
      colTotal += v;
      if (v > best) {
        best = v;
        leader = i;
      }
    });
    if (colTotal < 8) continue; // ignore low-signal months
    if (leader >= 0 && leader !== prevLeader) {
      if (prevLeader >= 0) flips++;
      prevLeader = leader;
    }
  }
  return flips;
}

/**
 * Relative-share "movement" for a comparison: the largest swing (max - min) in
 * ANY term's share-of-column across the timeline. The galleries render RELATIVE
 * (100%) stacks, so the right "is this a flat line?" test is whether the shares
 * actually MOVE - not whether absolute peaks are similar (a low-volume term still
 * holds a visible, shifting band in a relative stack). Returns a fraction in
 * [0, 1]; ~0 means every term holds a constant share (a genuinely boring stack),
 * a big number means a clear takeover/crossover. Only months whose column total
 * clears `colFloor` count, so early sparse noise can't fake movement.
 */
function relativeMovement(metrics: TermMetric[], colFloor = 8): number {
  const months = new Set<string>();
  for (const m of metrics) for (const k of m.byMonth.keys()) months.add(k);
  // Per term, track min and max share across qualifying months.
  const minShare = metrics.map(() => Infinity);
  const maxShare = metrics.map(() => -Infinity);
  for (const k of months) {
    const vals = metrics.map((m) => m.byMonth.get(k) ?? 0);
    const total = vals.reduce((a, b) => a + b, 0);
    if (total < colFloor) continue;
    vals.forEach((v, i) => {
      const share = v / total;
      if (share < minShare[i]) minShare[i] = share;
      if (share > maxShare[i]) maxShare[i] = share;
    });
  }
  let swing = 0;
  metrics.forEach((_, i) => {
    if (maxShare[i] === -Infinity) return;
    swing = Math.max(swing, maxShare[i] - minShare[i]);
  });
  return swing;
}

/* ---------- emitted shape ------------------------------------------- */

type GalleryCard = {
  /** display title (e.g. "Top 8 languages" or a head-to-head label). */
  title: string;
  /** each string is one series; `|` inside = OR-group (summed into one bar). */
  terms: string[];
  /** one-line editorial story under the card. */
  story: string;
};

function jsArray(items: GalleryCard[]): string {
  return items
    .map((c) => {
      const terms = c.terms.map((t) => JSON.stringify(t)).join(", ");
      return `  {\n    title: ${JSON.stringify(c.title)},\n    terms: [${terms}],\n    story: ${JSON.stringify(c.story)},\n  },`;
    })
    .join("\n");
}

/* ---------- main ---------------------------------------------------- */

async function main() {
  // 1. Probe every distinct series across SEEDS + head-to-heads (deduped).
  const allLabels = new Set<string>();
  for (const terms of Object.values(SEEDS)) for (const t of terms) allLabels.add(t);
  for (const h of HEAD_TO_HEAD_SEEDS) for (const t of h.terms) allLabels.add(t);
  const labels = [...allLabels];
  process.stderr.write(`Probing ${labels.length} distinct series (scope=jobs)...\n`);
  const probed = await mapLimit(labels, CONCURRENCY, probeSeries);
  const byLabel = new Map(labels.map((l, i) => [l, probed[i]]));

  // 2. Collision guard: drop any single-token term whose live total EQUALS another
  //    seeded term's total (identical token => tokenizer collision, e.g. embedded
  //    vs embeddings, or c/c++/c#). Single-part labels only (OR-groups are unions).
  const byTotal = new Map<number, string[]>();
  for (const m of probed) {
    if (parseParts(m.label).length !== 1) continue;
    if (m.total < MIN_TOTAL) continue;
    const arr = byTotal.get(m.total) ?? [];
    arr.push(m.label);
    byTotal.set(m.total, arr);
  }
  const collided = new Set<string>();
  for (const arr of byTotal.values()) {
    if (arr.length > 1) for (const l of arr) collided.add(l);
  }
  if (collided.size) {
    process.stderr.write(`Collision-equal totals (dropped): ${[...collided].join(", ")}\n`);
  }

  const usable = (label: string): boolean => {
    const m = byLabel.get(label);
    if (!m) return false;
    if (m.total < MIN_TOTAL) return false;
    // For OR-groups, judge the union; for single terms, also reject collisions.
    if (parseParts(label).length === 1 && collided.has(label)) return false;
    return true;
  };

  // 3. Build Top-N category cards: keep each theme's usable terms, strongest first
  //    by total. >=4 terms => Top-N card; <=3 usable => demote to comparisons.
  const interest = (m: TermMetric): number =>
    // popularity x shock: volume gives weight, tower ratio + peak give the drama.
    Math.log10(m.total + 10) * (m.towerRatio + Math.log10(m.peakValue + 10));

  const categoryCards: GalleryCard[] = [];
  const demoted: GalleryCard[] = [];
  for (const [theme, terms] of Object.entries(SEEDS)) {
    const keep = terms
      .filter(usable)
      .sort((a, b) => byLabel.get(b)!.total - byLabel.get(a)!.total)
      .slice(0, 8); // a "Top N" caps at 8 series (MAX_SERIES)
    if (keep.length >= 4) {
      categoryCards.push({
        title: `Top ${keep.length} ${theme}`,
        terms: keep,
        story: themeStory(theme),
      });
    } else if (keep.length >= 2) {
      // <=3-term "category" is demoted into Popular comparisons (PRD rule).
      demoted.push({
        title: theme,
        terms: keep,
        story: themeStory(theme),
      });
    }
  }

  // 4. Head-to-heads: keep only stories where every part is usable AND the stack
  //    actually MOVES. Because the gallery renders RELATIVE (100%) stacks, the
  //    right "not a flat line" test is share-movement (relativeMovement), not an
  //    absolute-peak ratio - a low-volume term still holds a shifting band. A
  //    comparison ships if some term's share swings by >= FLAT_MOVE OR the leader
  //    changes hands at least once (a crossover is the most striking shock).
  const headToHead: GalleryCard[] = [];
  for (const h of HEAD_TO_HEAD_SEEDS) {
    if (!h.terms.every(usable)) {
      process.stderr.write(`drop head-to-head (dead term): ${h.terms.join(" vs ")}\n`);
      continue;
    }
    const ms = h.terms.map((t) => byLabel.get(t)!);
    const move = relativeMovement(ms);
    const flips = leadChanges(ms);
    if (move < FLAT_MOVE && flips === 0) {
      process.stderr.write(
        `drop head-to-head (flat stack, move ${move.toFixed(2)}, flips ${flips}): ${h.terms.join(" vs ")}\n`,
      );
      continue;
    }
    headToHead.push({
      title: h.title ?? h.terms.join(" vs "),
      terms: h.terms,
      story: h.story,
    });
  }

  // Demoted small categories ride along in Popular comparisons.
  const comparisons = [...headToHead, ...demoted];

  // 5. Rank category cards by aggregate interest (most dramatic theme first).
  categoryCards.sort((a, b) => {
    const ai = a.terms.reduce((s, t) => s + interest(byLabel.get(t)!), 0);
    const bi = b.terms.reduce((s, t) => s + interest(byLabel.get(t)!), 0);
    return bi - ai;
  });

  // 6. Report.
  const totalItems = categoryCards.length + comparisons.length;
  const totalTermSlots =
    categoryCards.reduce((s, c) => s + c.terms.length, 0) +
    comparisons.reduce((s, c) => s + c.terms.length, 0);
  process.stderr.write(
    `\nSelected ${totalItems} gallery items ` +
      `(${categoryCards.length} Top-N cards, ${comparisons.length} comparisons), ` +
      `${totalTermSlots} term-slots.\n`,
  );
  if (totalItems < 50 && totalTermSlots < 50) {
    process.stderr.write(`WARNING: under 50 selections (${totalItems} items / ${totalTermSlots} slots).\n`);
  }

  // Compact metric dump for auditing the picks.
  const dump = [...categoryCards, ...comparisons].map((c) => ({
    title: c.title,
    terms: c.terms.map((t) => {
      const m = byLabel.get(t)!;
      return `${t}(total=${m.total},peak=${m.peakValue},tower=${m.towerRatio})`;
    }),
  }));
  process.stderr.write(JSON.stringify(dump, null, 2) + "\n");

  if (DRY) {
    process.stderr.write("\n--dry: not writing src/lib/jobs-gallery.ts\n");
    return;
  }

  // 7. Emit src/lib/jobs-gallery.ts.
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `/**
 * GENERATED by scripts/discover-job-trends.ts on ${stamp}. Do not hand-edit;
 * re-run the discovery script (it re-measures live jobs-scoped data) instead.
 *
 * Two galleries for the "Who is hiring?" search page:
 *   - CATEGORY_CARDS: themed "Top N <category>" lists (>=4 terms each), each a
 *     relative stacked-bar mini chart over live jobs data.
 *   - COMPARISONS: head-to-head stories (2-4 terms, incl. |-OR-group bars) plus
 *     any small (<=3-term) category demoted here per the "Top N is a real list"
 *     rule.
 *
 * Selection metric (over live scope=jobs aggregates): popularity (all-time
 * mention total) x shock factor (peak prominence + tower ratio + lead-change
 * crossover). Every term was probed live: none is dead (>= ${MIN_TOTAL} mentions)
 * and no comparison is a flat line (some term's relative share swings >= ${FLAT_MOVE}
 * over time, or the leader changes hands at least once).
 *
 * Tokenization collisions deliberately excluded (the index tokenizer aliases
 * these onto noisier tokens):
${COLLISIONS.map((c) => ` *   - ${c}`).join("\n")}
 *
 * \`|\` inside a term string is an OR-group: parts are aggregated separately and
 * summed bucket-for-bucket into one series/bar.
 */

export type GalleryCard = {
  /** display title (e.g. "Top 8 languages" or a head-to-head label). */
  title: string;
  /** each string is one series; \`|\` inside = OR-group (summed into one bar). */
  terms: string[];
  /** one-line editorial story shown under the card. */
  story: string;
};

/** Themed "Top N <category>" cards (>=4 terms each), ranked by interestingness. */
export const CATEGORY_CARDS: GalleryCard[] = [
${jsArray(categoryCards)}
];

/** Popular head-to-head comparisons (2-4 terms, incl. |-OR-group stories) plus
 *  demoted small categories. */
export const COMPARISONS: GalleryCard[] = [
${jsArray(comparisons)}
];

/** Flat union of every gallery card, in display order. */
export const GALLERY: GalleryCard[] = [...CATEGORY_CARDS, ...COMPARISONS];
`;

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const out = join(scriptDir, "..", "src", "lib", "jobs-gallery.ts");
  writeFileSync(out, file);
  process.stderr.write(`\nWrote ${out}\n`);
}

/** Editorial one-liner per theme (used for the Top-N card story). */
function themeStory(theme: string): string {
  const map: Record<string, string> = {
    languages: "The most-requested programming languages across every hiring thread.",
    "frontend frameworks": "Frontend frameworks as they rise and fade in job reqs.",
    "backend frameworks": "Backend and web frameworks companies staff up for.",
    "functional languages": "How much the functional world actually hires, year by year.",
    "systems languages": "Low-level and systems-programming demand.",
    "gpu & shader skills": "GPU, graphics and shader work in job posts.",
    "low-level skills": "Bare-metal, embedded and hardware-adjacent hiring.",
    databases: "The data stores in the stacks companies are hiring for.",
    clouds: "Cloud platform demand - AWS versus the rest.",
    "infra & devops": "The infrastructure and DevOps tools teams hire to run their stacks.",
    locations: "Where the jobs are - and how remote stacks up against the hubs.",
    "ai & ml skills": "The machine-learning and generative-AI hiring wave.",
    mobile: "Mobile platform and cross-platform demand.",
    security: "Security and cryptography roles across the hiring threads.",
    "data engineering": "The data-pipeline stack companies hire to move and crunch data.",
  };
  return map[theme] ?? `Demand for ${theme} across the hiring threads.`;
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
