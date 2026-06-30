/**
 * SEO-ONLY trend terms: an additional set of high-volume Hacker News tech topics
 * that get their own programmatic `/trends/[term]` landing page, WITHOUT being
 * part of the `/examples` gallery catalog.
 *
 * WHY A SEPARATE FILE (read before touching anything):
 *   These terms feed `allTrendTerms()` in site.ts ONLY. They are deliberately
 *   kept OUT of `allExampleTerms()` (examples.ts). That separation is the whole
 *   point of this file and protects a cache invariant:
 *
 *     - The gallery's histograms are precomputed for EVERY term in
 *       `allExampleTerms()` and stored as one big Redis blob keyed by
 *       `examples:<CATALOG_VERSION>` (currently examples:v5). Adding terms there
 *       (or bumping CATALOG_VERSION) busts that key and triggers a regeneration
 *       fan-out - one date-histogram per distinct catalog term - which is exactly
 *       the load spike that nearly caused a SEV-1. We do NOT want these ~50 new
 *       SEO terms anywhere near that blob.
 *     - A `/trends/[term]` page, by contrast, computes its histogram with a
 *       single live per-render Upstash aggregate (`getTermLanding`) and is then
 *       CDN-cached per URL. So a new SEO term costs exactly one query on its
 *       first request, amortized by the CDN - no fan-out, no shared cache key.
 *
 * THEREFORE, hard rules for editing this file:
 *   - DO put new high-volume SEO landing terms here.
 *   - Do NOT copy these into EXAMPLE_GROUPS / allExampleTerms() in examples.ts.
 *   - Do NOT bump CATALOG_VERSION for changes made here - it has nothing to do
 *     with the examples:v* blob and bumping it would needlessly recompute the
 *     gallery cache.
 *   - These terms become "known" catalog slugs (via TERM_BY_SLUG), so the route's
 *     `notFound()` zero-volume guard will NOT save a thin term - every term below
 *     was probe-verified (scripts/probe-trends.ts, READ-ONLY) for real volume and
 *     a genuine multi-year span before being added, so its page is never empty.
 *
 * TIERING: all terms here are Tier 2 by default (indexed + templated). Tier is
 * computed in site.ts from tiers.ts: a term is Tier 2 unless its slug is listed
 * in TIER1_SLUGS (custom analysis) or TIER3_SLUGS (noindex). None of the slugs
 * below appear in those sets, so they all resolve to Tier 2 - exactly what we
 * want for a templated long-tail SEO page. Promote/demote by editing tiers.ts,
 * NOT this file.
 *
 * The `ExampleGroup` shape is reused verbatim (id/title/blurb/terms) so these
 * groups can flow through the same site.ts helpers (groupOfTerm, siblingTerms)
 * and render a "More from <title>" siblings block on each trend page. The
 * gallery page itself still reads EXAMPLE_GROUPS directly, so it never shows
 * these groups.
 */

import type { ExampleGroup } from "./examples";

export const SEO_TREND_GROUPS: ExampleGroup[] = [
  {
    id: "seo-languages",
    title: "Programming languages",
    blurb:
      "The languages HN argues about release by release: each one's rise, plateau and the eternal rewrite debate.",
    terms: [
      "rust", "golang", "python", "javascript", "java", "php", "ruby", "perl",
      "lua", "erlang", "fortran", "cobol", "node.js",
    ],
  },
  {
    id: "seo-databases",
    title: "Databases & data infrastructure",
    blurb:
      "Stores, streams and query engines: the data backbone HN benchmarks, migrates to, and occasionally rage-quits.",
    terms: [
      "sqlite", "duckdb", "clickhouse", "kafka", "elasticsearch", "rabbitmq",
      "cockroachdb", "dynamodb",
    ],
  },
  {
    id: "seo-systems",
    title: "Operating systems & infrastructure",
    blurb:
      "Kernels, distros and the plumbing underneath: each release, flame war and CVE that lit up the front page.",
    terms: [
      "linux", "git", "freebsd", "openbsd", "debian", "ubuntu", "arch linux",
      "systemd", "wireguard", "ffmpeg", "raspberry pi", "ipv6",
    ],
  },
  {
    id: "seo-companies",
    title: "Big tech companies",
    blurb:
      "The giants whose earnings, launches, layoffs and scandals reliably crest the timeline.",
    terms: [
      "google", "apple", "microsoft", "facebook", "amazon", "intel", "tesla",
      "spacex", "boeing", "stripe", "gitlab", "oracle", "netflix", "twitter",
    ],
  },
  {
    id: "seo-ai",
    title: "AI tools & frameworks",
    blurb:
      "The model runners, agent frameworks and AI-native editors riding the post-ChatGPT wave, each on its own launch spike.",
    terms: [
      "ollama", "langchain", "whisper", "windsurf", "replit",
    ],
  },
  {
    id: "seo-roles",
    title: "Engineering disciplines",
    blurb:
      "The job-shaped words that crest with the hiring cycle: where the industry says the work (and the openings) are.",
    terms: [
      "frontend", "backend", "devops", "full stack",
    ],
  },
];
