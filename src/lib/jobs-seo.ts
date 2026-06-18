/**
 * Per-page SEO copy for the "Who is hiring?" programmatic landing routes
 * (`/who-is-hiring/[term]` and `/who-is-hiring/compare/[slug]`, built by T17).
 *
 * The titles, meta descriptions and short analysis bodies here are KEYWORD-LED:
 * they lead with the exact phrase people actually search, picked from real
 * Ahrefs US search volumes pulled at build time (see KEYWORD_VOLUMES below and
 * the research summary in the header comment). The big takeaways from that pull:
 *
 *   - For single-skill pages the dominant query is "<skill> jobs"
 *     ("python jobs" ~3000/mo, "aws jobs" ~8300, "machine learning jobs" ~4000,
 *     "data engineer jobs" ~9700, "java jobs" ~1300, "golang jobs" ~450,
 *     "rust jobs" ~400). The intent-y "is X in demand" / "is X worth learning"
 *     variants measure near-zero (~10/mo), so we do NOT lead with those.
 *   - For head-to-head pages the query is "X vs Y" with NO "jobs" suffix
 *     ("typescript vs javascript" ~6200, "pytorch vs tensorflow" ~6300,
 *     "kotlin vs java" ~3600, "docker vs kubernetes" ~2900,
 *     "postgresql vs mysql" ~2700, "react vs angular" ~2200,
 *     "python vs java" ~2100). Orientation matters: we lead with the
 *     higher-volume direction of each pair.
 *   - A few "<term> jobs" queries are polluted by unrelated meanings (Apache
 *     Spark vs "spark driver", Spring framework vs "school spring", Phoenix
 *     framework vs "phoenix jobs" the city, Express.js vs "express staffing",
 *     "assembly jobs" the factory line, "metal jobs" the industry). Those terms
 *     get a disambiguated title and are marked low-confidence below.
 *
 * Pages outside the curated set fall back to a keyword-led TEMPLATE
 * (`jobsTermSeo` / `jobsComparisonSeo`) so every route still has a sensible
 * "<term> jobs" / "X vs Y" title and a factual, non-empty description. The
 * analysis body is intentionally specific where curated and a short, honest
 * template otherwise (never fabricated numbers - the page's live chart and the
 * deterministic stat strip carry the hard data).
 *
 * Pure data + pure string helpers, no React, no network. Keyed by the same
 * slugs the routes use (`termToSlug` / `comparisonSlug` from site.ts).
 */

import { termToSlug, comparisonSlug } from "./site";
import { CATEGORY_CARDS, type GalleryCard } from "./jobs-gallery";

/* ------------------------------------------------------------------ types */

export type JobsSeoEntry = {
  /** The full <title> element. Leads with the exact high-volume keyword. ~55-65
   *  chars before the brand tail; routes append " - Hacker News Who Is Hiring". */
  title: string;
  /** <meta name="description">. ~150-160 chars, front-loads the keyword. */
  description: string;
  /** 60-120 word custom analysis paragraph(s), specific to this term/pair. No
   *  invented figures - the page's live chart supplies the numbers. */
  analysis: string[];
};

/** A single measured keyword (real Ahrefs US search volume, captured at build
 *  time so future tuning has the data without re-spending API units). */
export type KeywordVolume = {
  keyword: string;
  /** US monthly search volume. */
  volume: number;
  /** Ahrefs keyword difficulty 0-100 (0 = trivial to rank). */
  kd: number;
  /** True when "<term> jobs" collides with an unrelated, higher-volume meaning
   *  (so we disambiguate the title and treat the number as soft). */
  collision?: boolean;
};

/* ------------------------------------------------------- measured volumes */
/* Real Ahrefs US "volume" + "difficulty" from the build-time research pull
 * (2026-06-17). Kept so T17/T18 can prioritize indexing and so the numbers are
 * auditable. Not every gallery term is here - only the ones we looked up; the
 * rest use the keyword-led template and are treated as long-tail. */

export const KEYWORD_VOLUMES: KeywordVolume[] = [
  // single-skill "<term> jobs"
  { keyword: "data engineer jobs", volume: 9700, kd: 0 },
  { keyword: "aws jobs", volume: 8300, kd: 8 },
  { keyword: "startup jobs", volume: 4500, kd: 26 },
  { keyword: "machine learning jobs", volume: 4000, kd: 1 },
  { keyword: "python jobs", volume: 3000, kd: 5 },
  { keyword: "remote developer jobs", volume: 3200, kd: 24 },
  { keyword: "full stack developer jobs", volume: 1900, kd: 2 },
  { keyword: "devops jobs", volume: 1800, kd: 2 },
  { keyword: "python developer jobs", volume: 1800, kd: 3 },
  { keyword: "sql jobs", volume: 1700, kd: 0 },
  { keyword: "security engineer jobs", volume: 1400, kd: 0 },
  { keyword: "rails jobs", volume: 1400, kd: 2 },
  { keyword: "java jobs", volume: 1300, kd: 2 },
  { keyword: "cloudflare jobs", volume: 1300, kd: 10 },
  { keyword: "snowflake jobs", volume: 1100, kd: 1 },
  { keyword: "c++ jobs", volume: 1000, kd: 0 },
  { keyword: "blockchain jobs", volume: 1000, kd: 79 },
  { keyword: "ios developer jobs", volume: 900, kd: 0 },
  { keyword: "android developer jobs", volume: 700, kd: 0 },
  { keyword: "react developer jobs", volume: 700, kd: 0 },
  { keyword: "remote software jobs", volume: 700, kd: 2 },
  { keyword: "frontend developer jobs", volume: 600, kd: 2 },
  { keyword: "azure jobs", volume: 600, kd: 0 },
  { keyword: "laravel jobs", volume: 600, kd: 0 },
  { keyword: "javascript jobs", volume: 500, kd: 7 },
  { keyword: "php jobs", volume: 500, kd: 0 },
  { keyword: "sre jobs", volume: 500, kd: 1 },
  { keyword: "kubernetes jobs", volume: 500, kd: 1 },
  { keyword: "backend developer jobs", volume: 450, kd: 2 },
  { keyword: "golang jobs", volume: 450, kd: 9 },
  { keyword: "mongodb jobs", volume: 450, kd: 0 },
  { keyword: "spark jobs", volume: 450, kd: 0, collision: true },
  { keyword: "rust jobs", volume: 400, kd: 0 },
  { keyword: "fpga jobs", volume: 400, kd: 0 },
  { keyword: "penetration testing jobs", volume: 400, kd: 0 },
  { keyword: "react jobs", volume: 350, kd: 1 },
  { keyword: "django jobs", volume: 350, kd: 3 },
  { keyword: "react native jobs", volume: 300, kd: 0 },
  { keyword: "elixir jobs", volume: 300, kd: 1 },
  { keyword: "docker jobs", volume: 250, kd: 1 },
  { keyword: "swift jobs", volume: 250, kd: 2 },
  { keyword: "flutter jobs", volume: 250, kd: 0 },
  { keyword: "embedded jobs", volume: 250, kd: 1 },
  { keyword: "cryptography jobs", volume: 250, kd: 0 },
  { keyword: "rust developer jobs", volume: 250, kd: 1 },
  { keyword: "ruby jobs", volume: 200, kd: 3 },
  { keyword: "llm jobs", volume: 200, kd: 0 },
  { keyword: "haskell jobs", volume: 200, kd: 0 },
  { keyword: "clojure jobs", volume: 200, kd: 0 },
  { keyword: "nlp jobs", volume: 200, kd: 0 },
  { keyword: "scala jobs", volume: 150, kd: 0 },
  { keyword: "terraform jobs", volume: 150, kd: 0 },
  { keyword: "gcp jobs", volume: 150, kd: 3 },
  { keyword: "typescript jobs", volume: 150, kd: 0 },
  { keyword: "mysql jobs", volume: 150, kd: 0 },
  { keyword: "elasticsearch jobs", volume: 150, kd: 0 },
  { keyword: "svelte jobs", volume: 150, kd: 0 },
  { keyword: "kotlin jobs", volume: 100, kd: 0 },
  { keyword: "redis jobs", volume: 100, kd: 0 },
  { keyword: "cuda jobs", volume: 100, kd: 0 },
  { keyword: "ocaml jobs", volume: 100, kd: 0 },
  { keyword: "prometheus jobs", volume: 100, kd: 1 },
  { keyword: "ansible jobs", volume: 100, kd: 0 },
  // collision-prone "<term> jobs" (unrelated meaning dominates the number)
  { keyword: "express jobs", volume: 1800, kd: 0, collision: true },
  { keyword: "phoenix jobs", volume: 1800, kd: 9, collision: true },
  { keyword: "assembly jobs", volume: 1700, kd: 0, collision: true },
  { keyword: "spring jobs", volume: 200, kd: 4, collision: true },
  { keyword: "metal jobs", volume: 50, kd: 0, collision: true },

  // head-to-head "X vs Y" (leading orientation = higher volume direction)
  { keyword: "pytorch vs tensorflow", volume: 6300, kd: 4 },
  { keyword: "typescript vs javascript", volume: 6200, kd: 3 },
  { keyword: "kotlin vs java", volume: 3600, kd: 1 },
  { keyword: "docker vs kubernetes", volume: 2900, kd: 7 },
  { keyword: "postgresql vs mysql", volume: 2700, kd: 9 },
  { keyword: "react vs angular", volume: 2200, kd: 2 },
  { keyword: "aws vs azure", volume: 2200, kd: 4 },
  { keyword: "python vs java", volume: 2100, kd: 25 },
  { keyword: "vue vs react", volume: 1100, kd: 3 },
  { keyword: "ios vs android", volume: 1000, kd: 7 },
  { keyword: "react native vs flutter", volume: 1000, kd: 5 },
  { keyword: "rust vs go", volume: 700, kd: 4 },
  { keyword: "sre vs devops", volume: 700, kd: 3 },
  { keyword: "mongodb vs mysql", volume: 700, kd: 3 },
  { keyword: "aws vs gcp", volume: 400, kd: 9 },
  { keyword: "ruby vs python", volume: 400, kd: 4 },
  { keyword: "golang vs python", volume: 350, kd: 0 },
  { keyword: "mysql vs postgres", volume: 250, kd: 7 },
  { keyword: "golang vs rust", volume: 200, kd: 7 },
  { keyword: "rails vs django", volume: 90, kd: 0 },
  { keyword: "scala vs kotlin", volume: 80, kd: 1 },
  { keyword: "remote vs onsite", volume: 50, kd: 0 },
];

/** Quick lookup of a measured keyword's US volume (0 if not measured). */
export function keywordVolume(keyword: string): number {
  const k = keyword.toLowerCase();
  return KEYWORD_VOLUMES.find((e) => e.keyword === k)?.volume ?? 0;
}

/* --------------------------------------------------- shared copy helpers */

/** Title-case a single token for use mid-sentence ("rust" -> "Rust"). Leaves
 *  already-cased display names (e.g. "AWS") alone if all-caps. */
function cap(term: string): string {
  if (term.length <= 4 && term === term.toUpperCase()) return term;
  return term.charAt(0).toUpperCase() + term.slice(1);
}

/** Some skills read better with a canonical display spelling in prose/titles. */
const DISPLAY: Record<string, string> = {
  golang: "Go (Golang)",
  nextjs: "Next.js",
  "react native": "React Native",
  "machine learning": "Machine Learning",
  ai: "AI",
  ml: "ML",
  nlp: "NLP",
  llm: "LLM",
  ios: "iOS",
  aws: "AWS",
  gcp: "GCP",
  sre: "SRE",
  ui: "UI",
  css: "CSS",
  fpga: "FPGA",
  cuda: "CUDA",
  opengl: "OpenGL",
  postgres: "Postgres",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  dynamodb: "DynamoDB",
  typescript: "TypeScript",
  javascript: "JavaScript",
  php: "PHP",
  ocaml: "OCaml",
  graphql: "GraphQL",
  "new york": "New York",
  "san francisco": "San Francisco",
};

function display(term: string): string {
  return DISPLAY[term.toLowerCase()] ?? cap(term);
}

/* ---------------------------------------------------- curated term pages */
/* High-value single-skill pages: keyword-led title ("<term> jobs ...") + a
 * specific, non-templated analysis paragraph. Keyed by termToSlug(term). */

const TERM_SEO: Record<string, JobsSeoEntry> = {
  python: {
    title: "Python Jobs on Hacker News - Demand Trend Since 2011",
    description:
      "How Python demand trended in Hacker News 'Who is hiring?' posts since 2011. See the monthly mention share, the peak hiring months, and the real job postings.",
    analysis: [
      "Python is one of the most-requested languages across the entire history of the Hacker News 'Who is hiring?' thread, and the chart shows why: its share of postings has held remarkably steady while the language quietly absorbed web, data and machine-learning work. Use the share toggle to see Python's slice of the market each month, switch to raw counts to watch absolute hiring volume rise and fall with the macro cycle, and drill into any month to read the actual postings - the seniority, the stacks paired with it, and the companies doing the hiring.",
    ],
  },
  rust: {
    title: "Rust Jobs on Hacker News - Is Rust in Demand?",
    description:
      "Track Rust hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend of how often Rust appears, its share of the market, and the real postings.",
    analysis: [
      "Rust started as a near-absent curiosity in the 'Who is hiring?' thread and has climbed steadily as systems teams, crypto shops and infrastructure companies adopted it. The chart lets you judge the demand question for yourself rather than trusting the hype: switch to share mode to see how much of the market Rust actually commands month to month, and to raw counts to see whether the absolute number of Rust roles is still growing. Click any month to read the postings behind the bar - which companies hire Rust engineers, at what level, and alongside which other skills.",
    ],
  },
  golang: {
    title: "Go (Golang) Jobs on Hacker News - Demand Trend",
    description:
      "How demand for Go (Golang) trended in Hacker News 'Who is hiring?' posts. Monthly mention share, peak hiring months, and the real postings behind the trend.",
    analysis: [
      "Go built an early, durable base in the 'Who is hiring?' thread on the back of cloud-native infrastructure, networking and backend services, and the chart shows that demand settling into a steady plateau rather than the boom-and-fade of more hyped languages. Toggle to share mode to compare Go's slice of the market against the wider language mix, and to counts to track absolute volume. Drill into any month to see the kinds of teams hiring Go engineers - SRE, platform, distributed-systems and crypto roles feature heavily.",
    ],
  },
  java: {
    title: "Java Jobs on Hacker News - Demand Trend Since 2011",
    description:
      "How Java demand trended in Hacker News 'Who is hiring?' posts since 2011. See its monthly mention share, the enterprise hiring base, and the real postings.",
    analysis: [
      "Java carries a deep, enterprise-heavy base of demand in the 'Who is hiring?' thread, and the chart shows it holding a meaningful share of postings year after year even as flashier languages came and went. Switch to share mode to see how the JVM ecosystem's slice of the market has drifted over time, and to raw counts for absolute hiring volume. Drill into any month to read the postings - Java roles skew toward larger companies, backend and platform teams, and frequently appear alongside Kotlin, Spring and the cloud stack.",
    ],
  },
  javascript: {
    title: "JavaScript Jobs on Hacker News - Demand Trend",
    description:
      "How JavaScript demand trended in Hacker News 'Who is hiring?' posts since 2011. Monthly mention share, the TypeScript shift, and the real job postings.",
    analysis: [
      "JavaScript has been a constant of the 'Who is hiring?' thread since the beginning, but the chart tells a more interesting story than raw ubiquity: its share has gradually ceded ground as TypeScript took over the same roles. Use the share toggle to watch that handover, and raw counts to see absolute front-end and full-stack hiring volume. Drill into any month to read the postings - which framework each role pairs JavaScript with, and how often a listing actually means 'TypeScript' in practice.",
    ],
  },
  typescript: {
    title: "TypeScript Jobs on Hacker News - Demand Trend",
    description:
      "Track TypeScript hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend of its rise, its share of front-end roles, and the real postings.",
    analysis: [
      "TypeScript is the clearest 'takeover' story in the whole 'Who is hiring?' dataset: it appears late, then climbs almost vertically as teams migrate JavaScript codebases and make it the default for new front-end and full-stack work. The chart lets you watch that ascent directly - switch to share mode to see TypeScript's growing slice of the market, and to counts for absolute volume. Drill into any month to see the stacks it pairs with (React, Node, Next.js) and the seniority of the roles asking for it.",
    ],
  },
  react: {
    title: "React Jobs on Hacker News - Front-End Demand Trend",
    description:
      "How React demand trended in Hacker News 'Who is hiring?' posts. See its dominant share of front-end roles, the peak months, and the real job postings.",
    analysis: [
      "React went from one of several front-end options to the default the rest of the market is measured against, and the chart shows that dominance plainly: its share of front-end-flavored postings pulls decisively ahead of Vue and Angular and stays there. Toggle to share mode to size React's slice of the market each month, and to raw counts to track absolute hiring volume through the front-end boom and the layoff cycle. Drill into any month to read the postings - the companies, the seniority, and whether each role pairs React with TypeScript, Next.js or React Native.",
    ],
  },
  aws: {
    title: "AWS Jobs on Hacker News - Cloud Demand Trend",
    description:
      "How demand for AWS skills trended in Hacker News 'Who is hiring?' posts. Monthly mention share, AWS versus the other clouds, and the real postings.",
    analysis: [
      "AWS is the default cloud in the 'Who is hiring?' thread by a wide margin, and the chart makes the scale of that lead obvious: its share of cloud-tagged postings dwarfs Azure and GCP across nearly the whole history. Use share mode to see exactly how much of the market AWS commands month to month, and raw counts to follow absolute demand as cloud adoption matured. Drill into any month to read the postings - the roles range from platform and SRE to data and backend, and reveal which AWS services teams most often expect you to know.",
    ],
  },
  kubernetes: {
    title: "Kubernetes Jobs on Hacker News - DevOps Demand Trend",
    description:
      "Track Kubernetes hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend of its rise from niche to must-have infra skill, with real postings.",
    analysis: [
      "Kubernetes is the second half of the container story in the 'Who is hiring?' thread: it appears after Docker establishes containers as table stakes, then climbs to become the default orchestration skill on infra and platform job posts. The chart shows that handoff clearly - switch to share mode to watch Kubernetes overtake bare Docker as the thing teams actually list, and to counts for absolute DevOps hiring volume. Drill into any month to see the postings and the surrounding stack (Terraform, AWS, Prometheus, Go).",
    ],
  },
  "machine learning": {
    title: "Machine Learning Jobs on Hacker News - ML Demand Trend",
    description:
      "How machine learning demand trended in Hacker News 'Who is hiring?' posts. See the ML hiring wave, its share of the market, and the real job postings.",
    analysis: [
      "Machine learning is one of the great growth stories of the 'Who is hiring?' dataset, climbing from a specialist niche to a pervasive ask, then surging again with the generative-AI wave. The chart lets you separate genuine demand from hype: use share mode to see ML's slice of the market over time, and raw counts to watch the absolute number of roles balloon, especially post-2022. Drill into any month to read the postings - research versus applied, the frameworks named (PyTorch, TensorFlow), and how often 'LLM' now appears alongside.",
    ],
  },
  blockchain: {
    title: "Blockchain Jobs on Hacker News - Crypto Hiring Trend",
    description:
      "Track blockchain and crypto hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend showing the boom, the bust, and the real postings.",
    analysis: [
      "Blockchain is the textbook hype-cycle curve in the 'Who is hiring?' thread: a sharp spike as crypto money flooded in, then a steep fade as the market cooled. The chart captures both halves - switch to share mode to see how large a slice of the market crypto hiring briefly claimed, and to counts to see the boom and bust in absolute terms. Drill into any month to read the postings behind the spike: the protocols, the funding stage of the companies, and how the roles changed as the cycle turned.",
    ],
  },
  docker: {
    title: "Docker Jobs on Hacker News - Container Demand Trend",
    description:
      "How Docker demand trended in Hacker News 'Who is hiring?' posts. See containers go from novelty to baseline expectation, with the real job postings.",
    analysis: [
      "Docker is the entry point of the container story in the 'Who is hiring?' thread: it appears early, spikes as containers go mainstream, then settles into a steady baseline as it becomes assumed rather than advertised. The chart shows that arc - use share mode to watch Docker's slice peak and then plateau as Kubernetes takes over the headline, and counts for absolute demand. Drill into any month to read the postings and the infra stack Docker travels with.",
    ],
  },
  remote: {
    title: "Remote Jobs on Hacker News - Remote Work Hiring Trend",
    description:
      "How remote work demand trended in Hacker News 'Who is hiring?' posts. The pre-2020 baseline, the 2021 eruption, and the real remote postings.",
    analysis: [
      "Remote is the single most dramatic shift in the whole 'Who is hiring?' dataset. For a decade it is a steady minority of postings; then in 2021 it erupts as companies went remote-first overnight, before settling into a new, much higher normal. The chart shows that step-change vividly - use share mode to see remote's slice of the market jump, and raw counts for absolute volume. Drill into any month to read the postings and watch the language evolve, from 'remote OK' to 'remote-first' to the later 'hybrid' framing.",
    ],
  },
  ruby: {
    title: "Ruby Jobs on Hacker News - Ruby on Rails Demand Trend",
    description:
      "How Ruby and Rails demand trended in Hacker News 'Who is hiring?' posts. See the Rails-era peak, the long fade, and the real job postings.",
    analysis: [
      "Ruby's curve in the 'Who is hiring?' thread is the arc of the Rails startup era: a strong early presence as Rails was the default way to ship a web product, then a gradual decline as Python, Node and Go absorbed the same roles. The chart shows that long fade - use share mode to watch Ruby's slice shrink, and counts for absolute volume. Drill into any month to read the postings: Ruby roles still cluster around established Rails shops and product-focused teams.",
    ],
  },
  scala: {
    title: "Scala Jobs on Hacker News - JVM Demand Trend",
    description:
      "Track Scala hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend of the functional-JVM language, its data-engineering base, and real postings.",
    analysis: [
      "Scala occupies a specific niche in the 'Who is hiring?' thread: a functional-leaning JVM language whose demand is tied closely to big-data and data-engineering work (Spark, Kafka) rather than general backend hiring. The chart shows a smaller, more cyclical curve than the mainstream languages - use share mode to see how its slice moves with the data-platform cycle, and counts for absolute volume. Drill into any month to read the postings and see which roles still reach for Scala over Kotlin or plain Java.",
    ],
  },
  elixir: {
    title: "Elixir Jobs on Hacker News - Demand Trend",
    description:
      "How Elixir demand trended in Hacker News 'Who is hiring?' posts. A live monthly trend of the BEAM language, its Phoenix-driven niche, and the real postings.",
    analysis: [
      "Elixir is a devoted-niche story in the 'Who is hiring?' thread: never huge in absolute terms, but with a steady, loyal base of teams that picked it for concurrency and the Phoenix framework. The chart shows a small but persistent curve rather than a fad spike - use share mode to see how its slice holds up over time, and counts for absolute demand. Drill into any month to read the postings; Elixir roles tend to come from product companies that made a deliberate platform bet.",
    ],
  },
  django: {
    title: "Django Jobs on Hacker News - Python Web Demand Trend",
    description:
      "How Django demand trended in Hacker News 'Who is hiring?' posts. See the Python web framework's steady base against Rails and Flask, with the real postings.",
    analysis: [
      "Django is the steady Python counterpart to Rails in the 'Who is hiring?' thread: a batteries-included web framework with a durable base of demand that rose as Python itself climbed. The chart shows it holding its ground while Rails faded - use share mode to compare Django's slice against the other web frameworks, and counts for absolute volume. Drill into any month to read the postings: Django roles span startups and established product teams alike, often paired with Postgres and React.",
    ],
  },
  rails: {
    title: "Rails Jobs on Hacker News - Ruby on Rails Demand Trend",
    description:
      "Track Ruby on Rails hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend of the framework's startup-era peak and long tail, with real postings.",
    analysis: [
      "Rails defined the startup web stack of the early 2010s, and the 'Who is hiring?' thread captures that moment precisely: a strong early presence, then a slow decline as the ecosystem matured and alternatives multiplied. The chart shows that long tail - use share mode to watch Rails' slice shrink against Django and the JavaScript frameworks, and counts for absolute volume. Drill into any month to read the postings; the companies hiring Rails today tend to be established product shops running mature codebases.",
    ],
  },
  ios: {
    title: "iOS Developer Jobs on Hacker News - Mobile Demand Trend",
    description:
      "How iOS developer demand trended in Hacker News 'Who is hiring?' posts. See the mobile duopoly with Android, the Swift shift, and the real job postings.",
    analysis: [
      "iOS is one half of the mobile duopoly in the 'Who is hiring?' thread, and the chart lets you watch it trade share with Android over the years while the underlying tooling shifted from Objective-C to Swift. Use share mode to compare iOS's slice of mobile postings against Android's, and counts for absolute mobile hiring volume across the app-economy boom and its later cooling. Drill into any month to read the postings and see whether each role wants native Swift, cross-platform React Native or Flutter, or both.",
    ],
  },
  android: {
    title: "Android Developer Jobs on Hacker News - Mobile Demand Trend",
    description:
      "How Android developer demand trended in Hacker News 'Who is hiring?' posts. See the mobile duopoly with iOS, the Kotlin shift, and the real job postings.",
    analysis: [
      "Android is the other half of the mobile duopoly in the 'Who is hiring?' thread, and the chart shows it moving roughly in step with iOS while Kotlin gradually replaced Java as the language teams ask for. Use share mode to compare Android's slice of mobile postings against iOS, and counts for absolute mobile hiring volume. Drill into any month to read the postings and see the split between native Kotlin roles and cross-platform listings that name React Native or Flutter.",
    ],
  },
  swift: {
    title: "Swift Jobs on Hacker News - iOS Language Demand Trend",
    description:
      "Track Swift hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend of Apple's language replacing Objective-C in iOS roles, with real postings.",
    analysis: [
      "Swift's curve in the 'Who is hiring?' thread is the story of it displacing Objective-C as the language iOS roles ask for: it appears after Apple's 2014 launch, then climbs steadily as native teams migrate. The chart shows that adoption - use share mode to see Swift's growing slice of mobile postings, and counts for absolute demand. Drill into any month to read the postings; Swift roles cluster at product companies with a serious native iOS app rather than cross-platform shops.",
    ],
  },
  kotlin: {
    title: "Kotlin Jobs on Hacker News - Android & JVM Demand Trend",
    description:
      "How Kotlin demand trended in Hacker News 'Who is hiring?' posts. See it replace Java on Android and grow on the JVM, with the real job postings.",
    analysis: [
      "Kotlin's rise in the 'Who is hiring?' thread tracks Google's 2017 endorsement for Android plus a slow spread into general JVM backend work. The chart shows it climbing from near-zero to a steady presence - use share mode to see Kotlin take share from Java on mobile roles, and counts for absolute demand. Drill into any month to read the postings and see the split between Android-native Kotlin roles and server-side JVM teams adopting it alongside or instead of Java.",
    ],
  },
  postgres: {
    title: "Postgres Jobs on Hacker News - Database Demand Trend",
    description:
      "How Postgres demand trended in Hacker News 'Who is hiring?' posts. See it overtake MySQL and the NoSQL wave as the default database, with the real postings.",
    analysis: [
      "Postgres is the quiet winner of the database story in the 'Who is hiring?' thread: it starts behind MySQL, weathers the NoSQL hype, and ends up the default relational database teams reach for. The chart shows that crossover - use share mode to watch Postgres pull ahead of MySQL and MongoDB, and counts for absolute demand. Drill into any month to read the postings; Postgres now appears across startups and scale-ups alike, frequently paired with Python, Django and the cloud stack.",
    ],
  },
  mongodb: {
    title: "MongoDB Jobs on Hacker News - NoSQL Demand Trend",
    description:
      "Track MongoDB hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend of the NoSQL wave, its peak, and the move back to Postgres, with real postings.",
    analysis: [
      "MongoDB's curve in the 'Who is hiring?' thread is the shape of the NoSQL wave: a sharp rise as document stores became fashionable, a peak, then a relative decline as Postgres reclaimed default status. The chart captures that cycle - use share mode to see MongoDB's slice swell and then settle, and counts for absolute demand. Drill into any month to read the postings and see the kinds of products that still standardize on it.",
    ],
  },
  terraform: {
    title: "Terraform Jobs on Hacker News - Infra-as-Code Demand Trend",
    description:
      "How Terraform demand trended in Hacker News 'Who is hiring?' posts. See infrastructure-as-code go mainstream on DevOps roles, with the real job postings.",
    analysis: [
      "Terraform tracks the mainstreaming of infrastructure-as-code in the 'Who is hiring?' thread: it appears as cloud adoption matured and climbs as declarative infra became the expected DevOps skill. The chart shows that adoption - use share mode to watch Terraform's slice of infra postings grow alongside Kubernetes, and counts for absolute demand. Drill into any month to read the postings; Terraform roles sit squarely in platform, SRE and DevOps teams, usually next to AWS and Kubernetes.",
    ],
  },
  ai: {
    title: "AI Jobs on Hacker News - AI Hiring Wave Trend",
    description:
      "Track AI hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend of the AI wave, how it dwarfs the crypto cycle, and the real postings.",
    analysis: [
      "AI is the defining hiring wave of the recent 'Who is hiring?' history, and the chart shows it surging post-2022 as generative models reshaped what companies staff for. Use share mode to see how large a slice of the entire market AI roles now command, and counts to watch the absolute number climb. Drill into any month to read the postings and see the shift from research-flavored 'machine learning' listings to product roles built around LLMs, retrieval and applied AI.",
    ],
  },
  "react native": {
    title: "React Native Jobs on Hacker News - Mobile Demand Trend",
    description:
      "How React Native demand trended in Hacker News 'Who is hiring?' posts. See cross-platform mobile hiring against native iOS and Android, with real postings.",
    analysis: [
      "React Native is the cross-platform option in the mobile slice of the 'Who is hiring?' thread, letting web-leaning teams ship to both iOS and Android. The chart shows its demand rise as the framework matured, then trade attention with Flutter - use share mode to compare React Native's slice against native and Flutter roles, and counts for absolute mobile demand. Drill into any month to read the postings; React Native roles favor product startups already invested in React on the web.",
    ],
  },
  flutter: {
    title: "Flutter Jobs on Hacker News - Cross-Platform Demand Trend",
    description:
      "Track Flutter hiring demand in Hacker News 'Who is hiring?' posts. A live monthly trend of Google's cross-platform framework against React Native, with real postings.",
    analysis: [
      "Flutter is Google's entry in the cross-platform mobile race, and the 'Who is hiring?' thread shows it climbing from nothing into a real, if smaller, share of mobile postings as teams weighed it against React Native. The chart lets you compare the two directly - use share mode to size Flutter's slice over time, and counts for absolute demand. Drill into any month to read the postings and see which kinds of products bet on Dart and Flutter over the React-flavored alternative.",
    ],
  },
};

/* ----------------------------------------------- curated comparison pages */
/* High-value head-to-head pages: keyword-led "X vs Y" title in the
 * higher-volume orientation + a specific analysis. Keyed by comparisonSlug. */

const COMPARISON_SEO: Record<string, JobsSeoEntry> = {
  [comparisonSlug(["javascript", "typescript"])]: {
    title: "TypeScript vs JavaScript Jobs - Hacker News Demand Trend",
    description:
      "TypeScript vs JavaScript hiring demand on Hacker News 'Who is hiring?' posts. Watch the takeover month by month, in share and raw counts, with real postings.",
    analysis: [
      "This is the clearest takeover in the dataset. For years JavaScript dominates the front-end and full-stack slice of the 'Who is hiring?' thread; then TypeScript appears and climbs almost vertically as teams migrate codebases and make it the default for new work. The chart lets you watch the handover directly: in share mode, TypeScript's slice grows at JavaScript's expense; in raw counts you see both, since many 'JavaScript' postings now effectively mean TypeScript. Drill into any month to read the actual postings and judge which one a given role really wants.",
    ],
  },
  [comparisonSlug(["tensorflow", "pytorch"])]: {
    title: "PyTorch vs TensorFlow Jobs - Hacker News ML Demand Trend",
    description:
      "PyTorch vs TensorFlow hiring demand on Hacker News 'Who is hiring?' posts. See the ML-framework changing of the guard, in share and counts, with real postings.",
    analysis: [
      "The ML-framework race in the 'Who is hiring?' thread is a clean changing of the guard. TensorFlow leads the early machine-learning postings; then PyTorch overtakes it as research and, increasingly, production teams standardize on it. The chart shows that crossover plainly - switch to share mode to see PyTorch pull ahead of TensorFlow, and to counts to track the overall ML hiring boom that lifts both. Drill into any month to read the postings and see which framework each team names, and how often the role is research versus applied.",
    ],
  },
  [comparisonSlug(["python", "java"])]: {
    title: "Python vs Java Jobs - Hacker News Demand Trend Since 2011",
    description:
      "Python vs Java hiring demand on Hacker News 'Who is hiring?' posts. Two workhorse languages compared month by month, in share and counts, with real postings.",
    analysis: [
      "Python versus Java is the contest of two workhorse languages with very different bases. Java carries a deep, enterprise-heavy demand; Python climbs relentlessly on the back of web, data and machine-learning work. The chart shows Python gradually closing and often surpassing Java's slice of the 'Who is hiring?' thread - use share mode to see the relative trend, and counts to compare absolute hiring volume. Drill into any month to read the postings and see the different company profiles behind each: large established teams for Java, a broader startup-to-scale-up spread for Python.",
    ],
  },
  [comparisonSlug(["react", "vue", "angular"])]: {
    title: "React vs Vue vs Angular Jobs - Hacker News Demand Trend",
    description:
      "React vs Vue vs Angular hiring demand on Hacker News 'Who is hiring?' posts. The front-end framework race month by month, in share and counts, with real postings.",
    analysis: [
      "The front-end framework race in the 'Who is hiring?' thread has a decisive winner. React pulls clearly ahead of both Vue and Angular and stays there, while the other two settle into much smaller, steadier niches. The chart lets you see exactly how lopsided the demand is - use share mode to size each framework's slice of front-end postings, and counts for absolute volume across the front-end boom and the later cooling. Drill into any month to read the postings and see which roles pair React with TypeScript and Next.js.",
    ],
  },
  [comparisonSlug(["golang", "rust"])]: {
    title: "Rust vs Go Jobs - Hacker News Systems Language Demand Trend",
    description:
      "Rust vs Go (Golang) hiring demand on Hacker News 'Who is hiring?' posts. The systems-language race month by month, in share and counts, with real postings.",
    analysis: [
      "The systems-language race in the 'Who is hiring?' thread is a tale of two trajectories: Go builds an early, durable base on cloud-native infrastructure, while Rust starts later and climbs steadily as crypto, infra and systems teams adopt it. The chart lets you compare the two directly - use share mode to see Rust narrowing the gap on Go, and counts for absolute demand. Drill into any month to read the postings and see the kinds of teams hiring for each: backend and platform for Go, systems and infrastructure for Rust.",
    ],
  },
  [comparisonSlug(["docker", "kubernetes"])]: {
    title: "Docker vs Kubernetes Jobs - Hacker News DevOps Demand Trend",
    description:
      "Docker vs Kubernetes hiring demand on Hacker News 'Who is hiring?' posts. The container handoff month by month, in share and counts, with real postings.",
    analysis: [
      "Docker versus Kubernetes in the 'Who is hiring?' thread is a handoff, not a fight. Docker rises first as containers go mainstream and becomes assumed; then Kubernetes climbs to be the orchestration skill teams actually advertise. The chart shows that baton-pass - use share mode to watch Kubernetes overtake bare Docker as the headline ask, and counts for the overall DevOps hiring boom. Drill into any month to read the postings and the surrounding infra stack (Terraform, AWS, Prometheus, Go).",
    ],
  },
  [comparisonSlug(["aws", "azure", "gcp"])]: {
    title: "AWS vs Azure vs GCP Jobs - Hacker News Cloud Demand Trend",
    description:
      "AWS vs Azure vs GCP hiring demand on Hacker News 'Who is hiring?' posts. The cloud race month by month, in share and counts, with the real postings.",
    analysis: [
      "The cloud race in the 'Who is hiring?' thread is no contest at the top: AWS dominates by a wide margin, with Azure and GCP fighting over a distant second. The chart makes the scale of AWS's lead obvious - use share mode to size each cloud's slice of postings, and counts to track overall cloud hiring as adoption matured. Drill into any month to read the postings and see which roles name each platform, and how often a listing expects more than one.",
    ],
  },
  [comparisonSlug(["mysql", "mongodb", "postgres"])]: {
    title: "MySQL vs MongoDB vs Postgres Jobs - Database Demand Trend",
    description:
      "MySQL vs MongoDB vs Postgres hiring demand on Hacker News 'Who is hiring?' posts. The database era-by-era story, in share and counts, with real postings.",
    analysis: [
      "The database story in the 'Who is hiring?' thread unfolds in three acts: MySQL's early lead, the MongoDB-led NoSQL wave, and Postgres ending up on top as the default relational choice. The chart shows all three crossing over - use share mode to watch the lead change hands, and counts for absolute demand. Drill into any month to read the postings and see which stacks each database travels with: PHP and Rails for MySQL, JavaScript for MongoDB, Python and Django for Postgres.",
    ],
  },
  [comparisonSlug(["ruby", "python"])]: {
    title: "Ruby vs Python Jobs - Hacker News Demand Trend",
    description:
      "Ruby vs Python hiring demand on Hacker News 'Who is hiring?' posts. The Rails-era heyday versus Python's takeover, in share and counts, with real postings.",
    analysis: [
      "Ruby versus Python in the 'Who is hiring?' thread is a generational handover. Ruby leads in the Rails startup era; then Python takes over the same web and product roles while also owning the data and ML work Ruby never reached. The chart shows Python's slice climbing as Ruby's fades - use share mode for the relative trend, counts for absolute demand. Drill into any month to read the postings and see how the company mix shifts from Rails shops to the broad Python ecosystem.",
    ],
  },
  [comparisonSlug(["rails", "django"])]: {
    title: "Rails vs Django Jobs - Hacker News Web Framework Trend",
    description:
      "Rails vs Django hiring demand on Hacker News 'Who is hiring?' posts. The two great 2010s web frameworks compared, in share and counts, with real postings.",
    analysis: [
      "Rails versus Django is the framework rivalry of the 2010s web, and the 'Who is hiring?' thread tracks it closely. Rails leads early as the default startup stack; Django holds a steadier base that rises with Python and narrows the gap as Rails fades. The chart shows that convergence - use share mode for the relative trend, counts for absolute volume. Drill into any month to read the postings; the company profiles split along language lines, Ruby shops for Rails and the Python ecosystem for Django.",
    ],
  },
  [comparisonSlug(["scala", "kotlin", "clojure"])]: {
    title: "Scala vs Kotlin vs Clojure Jobs - JVM Demand Trend",
    description:
      "Scala vs Kotlin vs Clojure hiring demand on Hacker News 'Who is hiring?' posts. Three JVM challengers compared, in share and counts, with real postings.",
    analysis: [
      "Scala, Kotlin and Clojure are three different bets on going beyond plain Java, and the 'Who is hiring?' thread gives each its moment. Scala rides the big-data wave, Clojure holds a small functional-purist niche, and Kotlin surges latest on the back of Android. The chart lets you compare their slices directly - use share mode for the relative trend and counts for absolute demand. Drill into any month to read the postings and see the distinct worlds each language hires from.",
    ],
  },
  [comparisonSlug(["aws", "heroku"])]: {
    title: "AWS vs Heroku Jobs - Hacker News PaaS-to-Cloud Trend",
    description:
      "AWS vs Heroku hiring demand on Hacker News 'Who is hiring?' posts. The PaaS-to-cloud migration month by month, in share and counts, with real postings.",
    analysis: [
      "AWS versus Heroku in the 'Who is hiring?' thread is the story of teams growing out of a managed platform and onto raw cloud. Heroku has an early presence as the easy way to ship; AWS then dominates as products scale and need more control. The chart shows that migration - use share mode to watch Heroku's slice shrink against AWS, and counts for absolute demand. Drill into any month to read the postings and see the company stages each platform attracts.",
    ],
  },
  [comparisonSlug(["machine learning", "blockchain"])]: {
    title: "Machine Learning vs Blockchain Jobs - Hacker News Hype Trend",
    description:
      "Machine learning vs blockchain hiring demand on Hacker News 'Who is hiring?' posts. Two hype waves compared, in share and counts, with the real postings.",
    analysis: [
      "Machine learning versus blockchain is a study in two very different hype curves. Blockchain spikes sharply and fades just as fast when the crypto market cools; machine learning builds steadily and then surges again with generative AI, ending far ahead. The chart shows both shapes side by side - use share mode to compare how much of the market each briefly or durably claimed, and counts for absolute demand. Drill into any month to read the postings behind each wave and see how the roles changed as the cycles turned.",
    ],
  },
  [comparisonSlug(["ios", "android"])]: {
    title: "iOS vs Android Jobs - Hacker News Mobile Demand Trend",
    description:
      "iOS vs Android hiring demand on Hacker News 'Who is hiring?' posts. The mobile duopoly month by month, in share and counts, with the real postings.",
    analysis: [
      "iOS versus Android in the 'Who is hiring?' thread is the mobile duopoly, year by year. The two move roughly together as the app economy boomed and then cooled, trading small leads while the underlying languages shifted - Objective-C to Swift on one side, Java to Kotlin on the other. The chart lets you compare their slices directly: use share mode for the relative trend and counts for absolute mobile demand. Drill into any month to read the postings and see how often a role wants both, or a cross-platform framework instead.",
    ],
  },
  [comparisonSlug(["docker", "terraform", "ansible"])]: {
    title: "Docker vs Terraform vs Ansible Jobs - Infra Demand Trend",
    description:
      "Docker vs Terraform vs Ansible hiring demand on Hacker News 'Who is hiring?' posts. Infra-as-code tools compared, in share and counts, with real postings.",
    analysis: [
      "Docker, Terraform and Ansible chart the rise of infrastructure-as-code in the 'Who is hiring?' thread. Docker comes first as containers go mainstream; Terraform climbs as declarative cloud provisioning becomes the norm; Ansible holds a steadier configuration-management niche. The chart shows the order of adoption - use share mode for the relative trend and counts for absolute DevOps demand. Drill into any month to read the postings and the wider platform stack these tools sit in.",
    ],
  },
  [comparisonSlug(["startup", "enterprise"])]: {
    title: "Startup vs Enterprise Jobs - Hacker News Hiring Trend",
    description:
      "Startup vs enterprise framing in Hacker News 'Who is hiring?' posts. How companies pitch themselves over time, in share and counts, with the real postings.",
    analysis: [
      "Startup versus enterprise in the 'Who is hiring?' thread is less about technology than about how companies sell themselves. The chart tracks which framing dominates the postings over time - the scrappy 'early-stage startup' pitch versus the stability of 'established enterprise' - and how that balance shifts with the funding climate. Use share mode for the relative trend and counts for absolute volume. Drill into any month to read the postings and see the language each kind of employer leans on to attract candidates.",
    ],
  },
  // OR-group editorial stories: the generic template would produce a 100-char
  // title from the joined parts, so these get hand-written, tighter copy.
  [comparisonSlug(["backend|sre|devops|infra", "frontend|web design|ui|css"])]: {
    title: "Backend vs Frontend Jobs - Hacker News Demand Trend",
    description:
      "Backend and infra demand versus frontend demand on Hacker News 'Who is hiring?' posts, each side folded into one bar, in share and counts, with real postings.",
    analysis: [
      "This page folds a cluster of near-synonyms into two bars - backend, SRE, DevOps and infra on one side, frontend, web design, UI and CSS on the other - to chart the broad backend-versus-frontend balance of the 'Who is hiring?' thread rather than any single keyword. The chart shows how that balance shifts as infra and platform work grew. Use share mode for the relative trend and counts for absolute demand, and drill into any month to read the postings behind each side.",
    ],
  },
  [comparisonSlug(["ai|machine learning|llm", "blockchain|crypto|web3"])]: {
    title: "AI vs Crypto Jobs - Hacker News Hype-Cycle Demand Trend",
    description:
      "The AI/ML hiring wave versus the blockchain/crypto wave on Hacker News 'Who is hiring?' posts, each bucket as one bar, in share and counts, with real postings.",
    analysis: [
      "This is the two great hype cycles head to head, each gathered into one bucket: AI, machine learning and LLM on one side; blockchain, crypto and web3 on the other. The chart shows their very different shapes - crypto's sharp spike and fade against AI's steady build and post-2022 surge - so you can see which wave actually translated into durable hiring. Use share mode for the relative trend and counts for absolute demand, and drill into any month to read the postings behind each bucket.",
    ],
  },
  [comparisonSlug(["security", "cryptography", "penetration testing"])]: {
    title: "Security vs Cryptography vs Pentest Jobs - Demand Trend",
    description:
      "Security, cryptography and penetration-testing hiring demand on Hacker News 'Who is hiring?' posts, in share-of-voice and raw counts, with the real postings.",
    analysis: [
      "Security work in the 'Who is hiring?' thread spans three overlapping specialties: general security engineering, applied cryptography, and offensive penetration testing. The chart compares their slices of the market over time, showing how broad security roles dominate while crypto and pentest stay smaller, focused niches. Use share mode for the relative trend and counts for absolute demand, and drill into any month to read the postings and see the kinds of teams hiring for each.",
    ],
  },
};

/* ----------------------------------------------------- public selectors */

/** SEO copy for a single-skill page. Returns the curated entry if one exists,
 *  otherwise a keyword-led template ("<term> jobs ...") that is always factual
 *  and never invents numbers. */
export function jobsTermSeo(term: string): JobsSeoEntry {
  const slug = termToSlug(term);
  const curated = TERM_SEO[term.toLowerCase()] ?? TERM_SEO[slug];
  if (curated) return curated;

  const name = display(term);
  // A handful of "<term> jobs" queries collide with an unrelated meaning; for
  // those we lead with the disambiguated "<Name> demand" framing instead.
  const measured = KEYWORD_VOLUMES.find((k) => k.keyword === `${term.toLowerCase()} jobs`);
  const collides = measured?.collision ?? false;
  const title = collides
    ? `${name} Demand on Hacker News - Who Is Hiring Trend`
    : `${name} Jobs on Hacker News - Who Is Hiring Demand Trend`;
  const description = `How demand for ${name} trended in Hacker News 'Who is hiring?' posts since 2011: a live monthly mention chart in share and raw counts, plus the real job postings behind every bar.`;
  return {
    title,
    description,
    analysis: [
      `This page charts how often ${name} appears in the monthly Hacker News 'Who is hiring?' thread, one bar per calendar month across the whole history. Switch between share mode - ${name}'s slice of the market each month - and raw counts for absolute hiring volume, narrow the window to the last year, 5 or 10 years, and click any month to read the actual postings that mention ${name}: the companies, the seniority, and the rest of the stack they ask for.`,
    ],
  };
}

/** SEO copy for a head-to-head page. Returns the curated entry if one exists,
 *  otherwise a keyword-led "X vs Y" template. Handles OR-group terms (parts
 *  joined with "/") gracefully for the title/prose. */
export function jobsComparisonSeo(terms: string[]): JobsSeoEntry {
  const slug = comparisonSlug(terms);
  const curated = COMPARISON_SEO[slug];
  if (curated) return curated;

  // Display each series. For an OR-group ("ai|ml|llm") lead with just the first
  // part so the title stays short ("AI vs ...") rather than joining every part.
  const labels = terms.map((t) =>
    t.includes("|") ? display(t.split("|")[0].trim()) : display(t),
  );
  const vs = labels.join(" vs ");
  // Keep the title under ~70 chars: drop the brand tail when the "X vs Y" head
  // is already long (3-term or wordy pairs).
  const title =
    vs.length <= 34
      ? `${vs} Jobs - Hacker News Who Is Hiring Demand Trend`
      : `${vs} Jobs - Hacker News Hiring Trend`;
  const description = `${vs} hiring demand on Hacker News 'Who is hiring?' posts since 2011: a live monthly comparison in share-of-voice and raw counts, with the real postings behind each bar.`;
  return {
    title,
    description,
    analysis: [
      `This page puts ${vs} head to head across the monthly Hacker News 'Who is hiring?' thread, one stacked bar per calendar month. Use share mode to see how each one's slice of the market moved relative to the others, switch to raw counts for absolute hiring volume, narrow the window to recent years, and click any month to read the actual postings - so you can see not just which term led, but the kinds of teams hiring for each.`,
    ],
  };
}

/* --------------------------------------------- enumeration + indexing (T17) */

/** Every term that has a CURATED single-skill page (keyed by termToSlug). These
 *  are the highest-value `/who-is-hiring/[term]` pages and the ones we prebuild
 *  + index; anything else still renders via the keyword-led template but is
 *  noindex,follow (crawlable, kept out of the sitemap so it doesn't dilute). */
export function curatedJobsTermSlugs(): string[] {
  return Object.keys(TERM_SEO);
}

/** Every comparison slug that has a CURATED head-to-head page. */
export function curatedJobsComparisonSlugs(): string[] {
  return Object.keys(COMPARISON_SEO);
}

/** True when this term slug has bespoke (non-template) SEO copy. Used to decide
 *  whether the `/who-is-hiring/[term]` page is indexed + listed in the sitemap. */
export function hasCuratedJobsTerm(termOrSlug: string): boolean {
  const slug = termToSlug(termOrSlug);
  return slug in TERM_SEO || termOrSlug.toLowerCase() in TERM_SEO;
}

/** True when this comparison slug has bespoke (non-template) SEO copy. */
export function hasCuratedJobsComparison(slug: string): boolean {
  return slug in COMPARISON_SEO;
}

/* ============================================================================
 * GALLERY QUESTION PAGES (T18)
 *
 * Each gallery card - the "Top N <category>" cards AND the head-to-head
 * comparisons in jobs-gallery.ts - gets its own SEO page with a HIGH-INTENT,
 * GOOGLE-SEARCHABLE, QUESTION-STYLE title + custom meta description, because a
 * question phrasing is what people actually type and what wins the featured
 * snippet / AI-overview answer this niche dataset can realistically rank for.
 *
 * Phrasings were sanity-checked against Ahrefs US volumes (2026-06-17):
 *   - "most popular programming languages" ~2800/mo, "most used ..." ~800,
 *     "most in demand programming languages" ~300 (KD 47), "which programming
 *     language is most in demand" ~100. The bare "most popular <X>" heads for
 *     databases/devops/clouds measure 20-100/mo - thin, but the question framing
 *     is the right intent and the long tail compounds across the catalog.
 *   - Comparison heads carry the real volume: "pytorch vs tensorflow" ~6300,
 *     "typescript vs javascript" ~6200, "react native vs flutter" ~1000,
 *     "react vs vue vs angular" ~150, "remote vs onsite" ~50. So comparison
 *     titles LEAD with the "X vs Y" phrase, then add the curiosity hook.
 *
 * Where a card has no measurable head we still write a strong, specific question
 * from domain knowledge (noted in the copy, never with invented numbers - the
 * page's static chart + deterministic stat strip carry the hard data).
 *
 * Keyed by the gallery card's `title` (unique within each gallery), so re-running
 * discovery (which may reorder/retitle cards) naturally re-keys. A card without a
 * curated entry falls back to a question-led template.
 * ========================================================================== */

/** The span every "Who is hiring?" page covers (the first thread is Apr 2011). */
const HIRING_SPAN = "2011-2026";

/** URL slug for a "Top N <category>" card. Routed under `/who-is-hiring/top/`,
 *  kept separate from the `compare` namespace so the two galleries never collide
 *  on a slug. Lossy but stable (same rules as `termToSlug`). */
export function categorySlug(card: GalleryCard): string {
  return termToSlug(card.title);
}

const CATEGORY_BY_SLUG: Map<string, GalleryCard> = (() => {
  const m = new Map<string, GalleryCard>();
  for (const c of CATEGORY_CARDS) m.set(categorySlug(c), c);
  return m;
})();

/** Resolve a `/who-is-hiring/top/[slug]` request back to its category card. */
export function categoryCardBySlug(slug: string): GalleryCard | undefined {
  return CATEGORY_BY_SLUG.get(slug.toLowerCase());
}

/** Every category slug (one `/who-is-hiring/top/[slug]` page each). */
export function allJobsCategorySlugs(): string[] {
  return CATEGORY_CARDS.map(categorySlug);
}

/* ---- curated question copy for the "Top N <category>" cards -------------- */
/* Keyed by card title. The h1/<title> is the question; the description is the
 * lift-able answer-shaped sentence; the analysis is the page's unique prose. */

const CATEGORY_QUESTION_SEO: Record<string, JobsSeoEntry> = {
  "Top 8 locations": {
    title: "Where Are the Most Tech Jobs? Hacker News Hiring by City (2011-2026)",
    description:
      "Which cities (and remote) get the most Hacker News 'Who is hiring?' postings: San Francisco, New York, London, Seattle, Berlin and more, charted by share since 2011.",
    analysis: [
      "For more than a decade the Hacker News 'Who is hiring?' thread has been a running census of where tech companies actually staff up, and the chart tells a clear two-act story. Through the 2010s the classic hubs - San Francisco first, then New York, London and Seattle - carry most of the postings. Then 'remote' erupts in 2021 and never gives the share back, reshaping the whole stack so that location is now as much about remote-versus-hub as about one city versus another. Read the relative bands to see how each city's slice rose or faded, and skim the sample postings to see how companies describe the location requirement itself.",
    ],
  },
  "Top 8 languages": {
    title: "Which Programming Languages Are Most in Demand on Hacker News? (2011-2026)",
    description:
      "The most-requested programming languages in Hacker News 'Who is hiring?' posts: Python, JavaScript, TypeScript, Java, Ruby, Go and more, ranked by share of postings since 2011.",
    analysis: [
      "This is the language demand question answered with real hiring data instead of a survey: every bar is the share of that month's 'Who is hiring?' postings that named each language. Python and JavaScript anchor the top throughout, TypeScript climbs almost vertically as teams migrate off plain JavaScript, and the older workhorses - Ruby, PHP, Java, Scala - trade the long tail as fashions turn over. Because it is a relative stack you can see not just who leads but who is gaining: a band that widens year over year is a language whose demand is outpacing the field. Drill into the sample postings to see the stacks each language travels with.",
    ],
  },
  "Top 8 frontend frameworks": {
    title: "Which Frontend Framework Is Most in Demand? React vs Angular vs Vue on Hacker News",
    description:
      "Which frontend framework gets hired most in Hacker News 'Who is hiring?' posts: React's dominance over Angular, Vue, Svelte, Next.js and the rest, charted by share since 2011.",
    analysis: [
      "The frontend-framework race has a decisive answer in the hiring data. React pulls clearly ahead and stays there, claiming the large majority of framework-tagged postings, while Angular and Vue settle into much smaller, steadier niches and Next.js and Svelte appear later as the modern additions. The early jQuery and Backbone bands fade as the single-page-app era matures. Watch the relative bands to see how lopsided the demand actually is, then read the sample postings to see which frameworks each role pairs - React with TypeScript and Next.js is by far the most common modern combination.",
    ],
  },
  "Top 8 backend frameworks": {
    title: "Which Backend Framework Is Most in Demand on Hacker News? (Rails, Django, Spring, Laravel)",
    description:
      "Which backend/web framework companies hire for in Hacker News 'Who is hiring?' posts: Rails, Django, Flask, Express, Spring, Laravel and Phoenix, charted by share of postings since 2011.",
    analysis: [
      "Backend frameworks map almost one-to-one onto their language ecosystems, and the chart shows the generational handoff. Rails leads the early startup years as the default way to ship a web product; Django rises with Python and holds a durable base; Express tracks the Node wave; Spring carries the enterprise JVM demand; Laravel and Phoenix anchor the PHP and Elixir niches. Read the relative bands as a map of which server-side stack was fashionable when, and use the sample postings to see the kinds of companies that still hire for each - mature product shops for Rails, a broad startup-to-scale-up spread for Django and Express.",
    ],
  },
  "Top 6 mobile": {
    title: "Which Mobile Skills Are Most in Demand? iOS vs Android vs React Native on Hacker News",
    description:
      "Mobile hiring demand in Hacker News 'Who is hiring?' posts: native iOS and Android against Swift, Kotlin, React Native and Flutter, charted by share of postings since 2011.",
    analysis: [
      "Mobile hiring in the 'Who is hiring?' thread is a story of native versus cross-platform. iOS and Android move roughly together as the app economy booms and then cools, while the language underneath each shifts - Objective-C to Swift on one side, Java to Kotlin on the other. React Native and later Flutter carve out the cross-platform slice for web-leaning teams that want one codebase. The relative bands show how that mix has rebalanced over time; the sample postings reveal whether a given role wants deep native expertise or a single cross-platform skill set.",
    ],
  },
  "Top 7 databases": {
    title: "Which Databases Are Most in Demand on Hacker News? (Postgres, MySQL, MongoDB, Redis)",
    description:
      "The most-requested databases in Hacker News 'Who is hiring?' posts: Postgres, MySQL, MongoDB, Redis, Elasticsearch and more, charted by share of postings since 2011.",
    analysis: [
      "The database demand chart captures three eras in one picture. MySQL leads the early years, the NoSQL wave lifts MongoDB to a real share in the mid-2010s, and Postgres steadily climbs to become the default relational choice teams reach for now. Redis rides alongside as the near-universal cache, while Elasticsearch, Cassandra and DynamoDB hold specialist slices. Read the relative bands to see the lead change hands era by era, and the sample postings to see which databases each stack pairs - Postgres with Python and Django, MongoDB with JavaScript, Redis with almost everything.",
    ],
  },
  "Top 6 infra & devops": {
    title: "Which DevOps Tools Are Most in Demand on Hacker News? (Docker, Kubernetes, Terraform)",
    description:
      "The DevOps and infrastructure tools companies hire for in Hacker News 'Who is hiring?' posts: Docker, Kubernetes, Terraform, Ansible, Jenkins and Prometheus, charted by share since 2011.",
    analysis: [
      "DevOps hiring follows the arc of infrastructure-as-code going mainstream. Docker appears first and spikes as containers become table stakes; Kubernetes climbs behind it to become the orchestration skill teams actually advertise; Terraform rises as declarative cloud provisioning becomes the norm; Ansible and Jenkins hold steadier configuration and CI niches; Prometheus tracks the observability build-out. The relative bands show the order of adoption clearly. Read the sample postings to see the wider platform stack these tools sit in - almost always next to a cloud (usually AWS) and a backend language like Go.",
    ],
  },
  "Top 5 clouds": {
    title: "Which Cloud Is Most in Demand on Hacker News? AWS vs Azure vs GCP (2011-2026)",
    description:
      "Cloud-platform demand in Hacker News 'Who is hiring?' posts: AWS's dominant lead over Azure, GCP, Heroku and Cloudflare, charted by share of postings since 2011.",
    analysis: [
      "There is no contest at the top of the cloud chart: AWS dominates the cloud-tagged postings by a wide margin across nearly the whole history, with Azure and GCP fighting over a distant second and Heroku fading as teams outgrow the managed-platform tier. Cloudflare appears later as the edge-and-network specialist. Read the relative bands to see exactly how lopsided the demand is, and the sample postings to see which roles name each platform - and how often a listing expects you to know more than one.",
    ],
  },
  "Top 6 functional languages": {
    title: "Do Functional Languages Get Hired? Scala, Elixir, Clojure & Haskell on Hacker News",
    description:
      "How much the functional-programming world actually hires, measured in Hacker News 'Who is hiring?' posts: Scala, Elixir, Clojure, Haskell, Erlang and OCaml, charted by share since 2011.",
    analysis: [
      "The functional-language chart answers a question developers argue about constantly: do these languages actually get you hired? The honest answer in the data is 'yes, but in specific niches'. Scala rides the big-data wave and leads the group; Elixir holds a small, loyal base around the Phoenix framework; Clojure keeps a steady functional-purist slice; Haskell, Erlang and OCaml appear in smaller, research-leaning or infrastructure roles. The relative bands show each language's moment, and the sample postings reveal the distinct worlds each hires from - data platforms for Scala, product teams for Elixir.",
    ],
  },
  "Top 6 ai & ml skills": {
    title: "Which AI & ML Skills Are Most in Demand on Hacker News? (LLM, PyTorch, TensorFlow)",
    description:
      "The machine-learning and generative-AI skills companies hire for in Hacker News 'Who is hiring?' posts: AI, machine learning, NLP, PyTorch, TensorFlow and LLM, charted by share since 2011.",
    analysis: [
      "This is the AI hiring wave, measured. For years 'machine learning' and 'NLP' carry a steady research-flavored slice, with PyTorch overtaking TensorFlow as the framework teams name. Then the generative-AI surge after 2022 reshapes the whole group: 'AI' and 'LLM' climb fast as the work shifts from training models to building products around them. The relative bands separate genuine, durable demand from hype; the sample postings show the move from research roles to applied LLM, retrieval and AI-product engineering.",
    ],
  },
  "Top 5 data engineering": {
    title: "Which Data Engineering Skills Are Most in Demand? (Kafka, Spark, Airflow, Snowflake)",
    description:
      "The data-pipeline stack companies hire for in Hacker News 'Who is hiring?' posts: Kafka, Spark, Hadoop, Airflow and Snowflake, charted by share of postings since 2011.",
    analysis: [
      "The data-engineering chart tracks how the pipeline stack modernized. Hadoop and Spark lead the early big-data years; Kafka becomes the near-default streaming backbone; Airflow rises as orchestration standardizes; Snowflake climbs as the cloud-warehouse era arrives and Hadoop fades. Read the relative bands as a timeline of how teams moved data, and the sample postings to see which tools cluster together - Kafka and Spark on the streaming side, Airflow and Snowflake on the warehouse side.",
    ],
  },
  "Top 4 low-level skills": {
    title: "Who Hires for Embedded & Firmware? Low-Level Jobs on Hacker News (2011-2026)",
    description:
      "Bare-metal and hardware-adjacent hiring in Hacker News 'Who is hiring?' posts: embedded, firmware, assembly and FPGA roles, charted by share of postings since 2011.",
    analysis: [
      "Away from the web and cloud churn, the low-level skills chart shows a smaller but remarkably stable corner of hiring. Embedded and firmware roles persist steadily across the whole history - hardware always needs software close to the metal - while assembly and FPGA hold specialist slices tied to performance-critical and silicon work. The relative bands show how that mix holds up against the broader market's swings, and the sample postings reveal the kinds of companies hiring here: hardware startups, robotics, aerospace and chip shops rather than the typical SaaS employer.",
    ],
  },
};

/* ---- curated question copy for the head-to-head comparison cards --------- */
/* Keyed by card title. These OVERRIDE the older statement-style COMPARISON_SEO
 * titles with question-style heads where a question reads stronger; for the
 * high-volume "X vs Y" cards we keep the keyword lead and add a curiosity hook.
 * A comparison card with no entry here falls back to COMPARISON_SEO, then to the
 * keyword template - so every comparison page still has a sensible title. */

const COMPARISON_QUESTION_SEO: Record<string, JobsSeoEntry> = {
  "onsite vs remote vs hybrid": {
    title: "Remote vs Onsite vs Hybrid: How Tech Hiring Shifted on Hacker News",
    description:
      "Remote vs onsite vs hybrid hiring on Hacker News 'Who is hiring?' posts: onsite leads a decade, remote erupts in 2021, hybrid emerges after. Charted by share with real postings.",
    analysis: [
      "This is the single most dramatic shift in the whole 'Who is hiring?' dataset, and the question it answers is the one every job-seeker now asks first. For a decade onsite dominates and remote is a steady minority. Then 2021 inverts the picture almost overnight as companies go remote-first, and 'hybrid' emerges afterward as the negotiated middle. The relative bands show the step-change vividly. Read the sample postings to watch the language itself evolve, from 'remote OK' to 'remote-first' to the careful hybrid framing that followed.",
    ],
  },
  "react vs vue vs angular": {
    title: "React vs Vue vs Angular: Which Is Most in Demand in HN Job Posts?",
    description:
      "React vs Vue vs Angular hiring demand on Hacker News 'Who is hiring?' posts. The frontend-framework race charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "React vs Vue vs Angular is the frontend question developers debate endlessly, and the hiring data gives a blunt answer: React wins, decisively and durably. It claims the clear majority of framework-tagged postings while Vue and Angular settle into much smaller, steadier niches. The relative bands show just how lopsided the demand is and that the gap is not closing. Read the sample postings to see the modern React stack employers actually ask for - almost always TypeScript, frequently Next.js.",
    ],
  },
  "tensorflow vs pytorch": {
    title: "PyTorch vs TensorFlow: Which Is More in Demand in HN Job Posts?",
    description:
      "PyTorch vs TensorFlow hiring demand on Hacker News 'Who is hiring?' posts. The ML-framework changing of the guard charted by share of postings since 2011, with real listings.",
    analysis: [
      "The PyTorch-versus-TensorFlow question has a clear answer in hiring data: a changing of the guard. TensorFlow leads the early machine-learning postings, then PyTorch overtakes it as research and increasingly production teams standardize on it. The relative bands show the crossover plainly, lifted by the overall ML hiring boom that grows both. Read the sample postings to see which framework each team names and whether the role leans research or applied.",
    ],
  },
  "aws vs azure vs gcp": {
    title: "AWS vs Azure vs GCP: Which Cloud Is Most in Demand in HN Job Posts?",
    description:
      "AWS vs Azure vs GCP hiring demand on Hacker News 'Who is hiring?' posts. The cloud race charted by share of postings since 2011, with the real job listings behind each bar.",
    analysis: [
      "Asked of hiring data, the AWS-versus-Azure-versus-GCP question is barely a contest: AWS dominates by a wide margin, with Azure and GCP splitting a distant second. The relative bands make the scale of AWS's lead obvious and show it holding across the whole history as cloud adoption matured. Read the sample postings to see which roles name each platform - and how often a listing expects more than one cloud.",
    ],
  },
  "mysql vs mongodb vs postgres": {
    title: "MySQL vs MongoDB vs Postgres: Which Database Wins in HN Job Posts?",
    description:
      "MySQL vs MongoDB vs Postgres hiring demand on Hacker News 'Who is hiring?' posts. The database story, era by era, charted by share of postings since 2011, with real listings.",
    analysis: [
      "The database question unfolds in three acts in the hiring data: MySQL's early lead, the MongoDB-led NoSQL wave, and Postgres ending up on top as the default relational choice. The relative bands show the lead changing hands era by era - exactly the kind of trend a single snapshot hides. Read the sample postings to see which stacks each database travels with: PHP and Rails for MySQL, JavaScript for MongoDB, Python and Django for Postgres.",
    ],
  },
  "scala vs kotlin vs clojure": {
    title: "Scala vs Kotlin vs Clojure: Which JVM Language Gets Hired Most on Hacker News?",
    description:
      "Scala vs Kotlin vs Clojure hiring demand on Hacker News 'Who is hiring?' posts. Three JVM challengers charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "Scala, Kotlin and Clojure are three different bets on going beyond plain Java, and the hiring data gives each its moment. Scala rides the big-data wave, Clojure holds a small functional-purist niche, and Kotlin surges latest on the back of Android. The relative bands let you compare their slices directly. Read the sample postings to see the distinct worlds each language hires from - data platforms, boutique consultancies and mobile teams respectively.",
    ],
  },
  "docker vs terraform vs ansible": {
    title: "Docker vs Terraform vs Ansible: Which Infra Tool Is Most in Demand on HN?",
    description:
      "Docker vs Terraform vs Ansible hiring demand on Hacker News 'Who is hiring?' posts. Infrastructure-as-code tools charted by share of postings since 2011, with real listings.",
    analysis: [
      "Docker, Terraform and Ansible chart the rise of infrastructure-as-code. Docker comes first as containers go mainstream, Terraform climbs as declarative cloud provisioning becomes the norm, and Ansible holds a steadier configuration-management niche. The relative bands show the order of adoption. Read the sample postings to see the wider platform stack these tools sit in, almost always alongside a cloud and Kubernetes.",
    ],
  },
  "javascript vs typescript": {
    title: "TypeScript vs JavaScript: Which Is More in Demand in HN Job Posts?",
    description:
      "TypeScript vs JavaScript hiring demand on Hacker News 'Who is hiring?' posts. Watch the TypeScript takeover charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "TypeScript versus JavaScript is the clearest takeover in the dataset, and the question 'which should I learn' answers itself in the trend. For years JavaScript dominates the front-end and full-stack postings; then TypeScript appears and climbs almost vertically as teams migrate codebases and make it the default for new work. The relative bands show the handover directly. Read the sample postings and you will see how many listings that say 'JavaScript' now effectively mean TypeScript in practice.",
    ],
  },
  "golang vs rust": {
    title: "Rust vs Go: Which Systems Language Is More in Demand on Hacker News?",
    description:
      "Rust vs Go (Golang) hiring demand on Hacker News 'Who is hiring?' posts. The systems-language race charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "Rust versus Go is the systems-language question of the moment, and the hiring data shows two trajectories. Go builds an early, durable base on cloud-native infrastructure and holds a steady plateau; Rust starts later and climbs steadily as crypto, infra and systems teams adopt it. The relative bands show Rust narrowing the gap without overtaking Go's installed demand. Read the sample postings to see which teams hire for each - backend and platform for Go, systems and infrastructure for Rust.",
    ],
  },
  "python vs java": {
    title: "Python vs Java: Which Is More in Demand in HN Job Posts? (2011-2026)",
    description:
      "Python vs Java hiring demand on Hacker News 'Who is hiring?' posts. Two workhorse languages charted by share of postings since 2011, with the real job listings behind each bar.",
    analysis: [
      "Python versus Java pits two workhorses with very different bases. Java carries deep, enterprise-heavy demand; Python climbs relentlessly on the back of web, data and machine-learning work, gradually closing and often surpassing Java's slice. The relative bands show that long convergence. Read the sample postings to see the different company profiles behind each - large established teams for Java, a broad startup-to-scale-up spread for Python.",
    ],
  },
  "ruby vs python": {
    title: "Ruby vs Python: Which Took Over in HN Job Posts?",
    description:
      "Ruby vs Python hiring demand on Hacker News 'Who is hiring?' posts. The Rails-era heyday versus Python's takeover, charted by share of postings since 2011, with real listings.",
    analysis: [
      "Ruby versus Python is a generational handover in the hiring data. Ruby leads in the Rails startup era; then Python takes over the same web and product roles while also owning the data and ML work Ruby never reached. The relative bands show Python's slice climbing as Ruby's fades. Read the sample postings to see the company mix shift from Rails shops to the broad Python ecosystem.",
    ],
  },
  "rails vs django": {
    title: "Rails vs Django: Which Web Framework Gets Hired More on Hacker News?",
    description:
      "Rails vs Django hiring demand on Hacker News 'Who is hiring?' posts. The two great 2010s web frameworks charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "Rails versus Django is the web-framework rivalry of the 2010s. Rails leads early as the default startup stack; Django holds a steadier base that rises with Python and narrows the gap as Rails fades. The relative bands show that convergence. Read the sample postings to see the company profiles split along language lines - Ruby shops for Rails, the Python ecosystem for Django.",
    ],
  },
  "docker vs kubernetes": {
    title: "Docker vs Kubernetes: Which DevOps Skill Is More in Demand on Hacker News?",
    description:
      "Docker vs Kubernetes hiring demand on Hacker News 'Who is hiring?' posts. The container handoff charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "Docker versus Kubernetes is a handoff, not a fight. Docker rises first as containers go mainstream and becomes assumed; then Kubernetes climbs to be the orchestration skill teams actually advertise. The relative bands show the baton pass clearly. Read the sample postings to see the surrounding infra stack - Terraform, AWS, Prometheus and Go.",
    ],
  },
  "postgres vs mysql": {
    title: "Postgres vs MySQL: Which Relational Database Is More in Demand on Hacker News?",
    description:
      "Postgres vs MySQL hiring demand on Hacker News 'Who is hiring?' posts. The relational-database swing charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "Postgres versus MySQL is the relational-database swing of the last decade. MySQL holds the early lead; Postgres steadily pulls ahead to become the default teams reach for. The relative bands show the crossover. Read the sample postings to see the stacks each pairs with - PHP and legacy web apps for MySQL, Python, Django and modern startups for Postgres.",
    ],
  },
  "aws vs heroku": {
    title: "AWS vs Heroku: How the PaaS-to-Cloud Migration Shows Up in HN Hiring",
    description:
      "AWS vs Heroku hiring demand on Hacker News 'Who is hiring?' posts. The PaaS-to-cloud migration charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "AWS versus Heroku is the story of teams growing out of a managed platform and onto raw cloud. Heroku has an early presence as the easy way to ship; AWS then dominates as products scale and need more control. The relative bands show Heroku's slice shrinking against AWS. Read the sample postings to see the company stages each platform attracts.",
    ],
  },
  "machine learning vs blockchain": {
    title: "Machine Learning vs Blockchain: Which Hype Wave Actually Hired? (Hacker News)",
    description:
      "Machine learning vs blockchain hiring demand on Hacker News 'Who is hiring?' posts. Two hype waves charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "Machine learning versus blockchain is a study in two very different hype curves. Blockchain spikes sharply and fades just as fast when the crypto market cools; machine learning builds steadily and surges again with generative AI, ending far ahead. The relative bands show both shapes side by side, answering which wave actually translated into durable hiring. Read the sample postings behind each to see how the roles changed as the cycles turned.",
    ],
  },
  "ios vs android": {
    title: "iOS vs Android: Which Mobile Platform Is Hired More on Hacker News?",
    description:
      "iOS vs Android hiring demand on Hacker News 'Who is hiring?' posts. The mobile duopoly charted by share of postings since 2011, with the real job listings behind each bar.",
    analysis: [
      "iOS versus Android is the mobile duopoly, year by year. The two move roughly together as the app economy booms and cools, trading small leads while the languages shift underneath - Objective-C to Swift, Java to Kotlin. The relative bands let you compare the slices directly. Read the sample postings to see how often a role wants both, or a cross-platform framework instead.",
    ],
  },
  "startup vs enterprise": {
    title: "Startup vs Enterprise: How Do HN Job Posts Pitch Themselves?",
    description:
      "Startup vs enterprise framing in Hacker News 'Who is hiring?' posts. How companies sell themselves over time, charted by share of postings since 2011, with the real listings.",
    analysis: [
      "Startup versus enterprise is less about technology than about how companies sell themselves to candidates. The chart tracks which framing dominates over time - the scrappy 'early-stage startup' pitch versus the stability of 'established enterprise' - and how that balance moves with the funding climate. The relative bands show the swing. Read the sample postings to see the language each kind of employer leans on.",
    ],
  },
  "backend / infra vs frontend": {
    title: "Backend vs Frontend: Which Side Is Hired More on Hacker News?",
    description:
      "Backend and infra demand versus frontend demand on Hacker News 'Who is hiring?' posts, each side folded into one bar, charted by share since 2011, with the real listings.",
    analysis: [
      "This page folds a cluster of near-synonyms into two bars - backend, SRE, DevOps and infra on one side, frontend, web design, UI and CSS on the other - to answer the broad backend-versus-frontend question rather than any single keyword. The relative bands show how the balance shifts as infra and platform work grew. Read the sample postings behind each side to see the kinds of roles in each bucket.",
    ],
  },
  "AI wave vs crypto wave": {
    title: "AI vs Crypto: Which Hype Cycle Actually Created Jobs on Hacker News?",
    description:
      "The AI/ML hiring wave versus the blockchain/crypto wave on Hacker News 'Who is hiring?' posts, each bucket as one bar, charted by share since 2011, with the real listings.",
    analysis: [
      "Here are the two great hype cycles head to head, each gathered into one bucket: AI, machine learning and LLM on one side; blockchain, crypto and web3 on the other. The relative bands show their very different shapes - crypto's sharp spike and fade against AI's steady build and post-2022 surge - answering which wave actually became durable hiring. Read the sample postings behind each bucket to see how the roles differed.",
    ],
  },
  "systems languages": {
    title: "Systems Programming Jobs on Hacker News: Go vs Rust Demand (2011-2026)",
    description:
      "Systems-programming hiring on Hacker News 'Who is hiring?' posts: Go versus Rust demand charted by share of postings since 2011, with the real job listings behind each bar.",
    analysis: [
      "Systems-programming demand on Hacker News comes down to two languages: Go's early, durable base on cloud-native infrastructure, and Rust's steady climb from crypto, infra and systems teams. The relative bands show Rust gaining without displacing Go's installed demand. Read the sample postings to see the teams hiring for low-level and systems work - and the rest of the stack they expect.",
    ],
  },
  "gpu & shader skills": {
    title: "Who Hires for GPU & Shader Work? Metal, OpenGL & CUDA on Hacker News",
    description:
      "GPU, graphics and shader hiring on Hacker News 'Who is hiring?' posts: Metal, OpenGL and CUDA demand charted by share of postings since 2011, with the real job listings.",
    analysis: [
      "GPU and graphics work is a small but distinctive corner of hiring. CUDA tracks the compute and machine-learning build-out, while Metal and OpenGL mark the graphics-and-rendering roles. The relative bands show how that mix shifts as GPU compute grows alongside the AI wave. Read the sample postings to see the kinds of companies hiring here - games, rendering, scientific computing and ML infrastructure.",
    ],
  },
  security: {
    title: "Security Engineering Jobs on Hacker News: Demand for Security, Crypto & Pentest",
    description:
      "Security hiring on Hacker News 'Who is hiring?' posts: general security engineering, applied cryptography and penetration testing, charted by share of postings since 2011.",
    analysis: [
      "Security work spans three overlapping specialties, and the chart sizes each. General security engineering dominates the postings, while applied cryptography and offensive penetration testing hold smaller, focused niches. The relative bands show how the mix moves over time. Read the sample postings to see the kinds of teams hiring for each - product-security roles at scale-ups, crypto roles at infrastructure and fintech shops, pentest roles at security consultancies.",
    ],
  },
};

/* ---- selectors for the gallery question pages --------------------------- */

/** Question-style SEO copy for a "Top N <category>" card. Curated where written,
 *  else a question-led template that names the category from the card title. */
export function jobsCategorySeo(card: GalleryCard): JobsSeoEntry {
  const curated = CATEGORY_QUESTION_SEO[card.title];
  if (curated) return curated;
  // Template: turn "Top 8 languages" into a question about that category.
  const noun = card.title.replace(/^top\s+\d+\s+/i, "").trim() || "skills";
  const title = `Which ${noun} Are Most in Demand on Hacker News? (${HIRING_SPAN})`;
  const description = `The most-requested ${noun} in Hacker News 'Who is hiring?' posts since 2011: ${card.terms
    .filter((t) => !t.includes("|"))
    .slice(0, 6)
    .join(", ")} and more, charted by share of postings with the real job listings.`;
  return {
    title,
    description,
    analysis: [
      `This page ranks the ${noun} companies hire for across the monthly Hacker News 'Who is hiring?' thread, one relative-stacked bar per calendar month since 2011. Each band is a term's share of that month's postings, so a band that widens over time is one whose demand is outpacing the rest. Read the sample postings to see the stacks each pairs with and the kinds of teams doing the hiring.`,
    ],
  };
}

/** Question-style SEO copy for a comparison card. Prefers the curated question
 *  copy, then the older statement-style curated copy (COMPARISON_SEO via
 *  `jobsComparisonSeo`), so every comparison page keeps a sensible title. */
export function jobsComparisonQuestionSeo(card: GalleryCard): JobsSeoEntry {
  return COMPARISON_QUESTION_SEO[card.title] ?? jobsComparisonSeo(card.terms);
}

/** True when this category slug has bespoke question copy (all curated category
 *  cards do today). Drives indexing - every category page is indexed. */
export function hasJobsCategory(slug: string): boolean {
  return categoryCardBySlug(slug) !== undefined;
}
