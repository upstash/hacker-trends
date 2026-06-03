/**
 * Dump the real landing data (stats + peak + top stories) for every Tier-1 term,
 * as compact JSON, so the per-term analysis paragraphs in
 * `src/lib/trend-analysis.ts` can be authored from actual numbers (never made
 * up). Read-only; safe with the deployed token.
 *
 *   bun --env-file=.env.local scripts/dump-tier1.ts > /tmp/tier1-data.json
 */
export {};
import { TIER1_SLUGS } from "../src/lib/tiers";
import { slugToTerm } from "../src/lib/site";
import { getTermLanding } from "../src/lib/landing-data";

async function main() {
  const slugs = [...TIER1_SLUGS];
  const out: unknown[] = [];
  for (const slug of slugs) {
    const term = slugToTerm(slug);
    const { stats, stories } = await getTermLanding(term);
    out.push({
      slug,
      term,
      total: stats.total,
      peakLabel: stats.peakLabel,
      peakCount: stats.peakCount,
      firstYear: stats.firstYear,
      lastYear: stats.lastYear,
      topStories: stories.slice(0, 6).map((s) => ({
        title: s.title,
        score: s.score,
        year: s.time ? new Date(s.time).getUTCFullYear() : null,
      })),
    });
    process.stderr.write(`.`);
  }
  process.stderr.write(`\n`);
  process.stdout.write(JSON.stringify(out, null, 2));
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
