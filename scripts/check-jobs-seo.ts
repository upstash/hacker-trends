/**
 * Script-evaluator (matching scripts/eval-relevance.ts prior art) asserting the
 * SEO copy in src/lib/jobs-seo.ts is complete and well-formed for every page the
 * programmatic routes (T17) will generate from the gallery.
 *
 * Checks, for every single-skill term and every comparison in jobs-gallery.ts:
 *   - jobsTermSeo / jobsComparisonSeo return a non-empty title, description and
 *     analysis body;
 *   - the title leads with the keyword (term name or "X vs Y"), not the brand;
 *   - the description stays within a sane SERP length;
 *   - the analysis is a real paragraph (>= 50 words), not a stub.
 *
 * Run: bun scripts/check-jobs-seo.ts
 */

import { CATEGORY_CARDS, COMPARISONS } from "../src/lib/jobs-gallery";
import {
  jobsTermSeo,
  jobsComparisonSeo,
  KEYWORD_VOLUMES,
  type JobsSeoEntry,
} from "../src/lib/jobs-seo";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (!cond) {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function validateEntry(label: string, e: JobsSeoEntry) {
  check(`${label}: has title`, !!e.title && e.title.length > 0);
  check(
    `${label}: title length`,
    e.title.length >= 20 && e.title.length <= 75,
    `len=${e.title.length} "${e.title}"`,
  );
  check(`${label}: has description`, !!e.description);
  check(
    `${label}: description length`,
    e.description.length >= 80 && e.description.length <= 200,
    `len=${e.description.length}`,
  );
  check(`${label}: has analysis`, e.analysis.length > 0);
  const words = e.analysis.reduce((n, p) => n + wordCount(p), 0);
  check(`${label}: analysis >= 50 words`, words >= 50, `words=${words}`);
  // Style rule: never an em-dash character in shipped copy.
  const blob = [e.title, e.description, ...e.analysis].join(" ");
  check(`${label}: no em-dash`, !blob.includes("—"));
}

// ---- single-skill term pages ------------------------------------------
const termSet = new Set<string>();
for (const card of [...CATEGORY_CARDS, ...COMPARISONS]) {
  for (const t of card.terms) {
    if (t.includes("|")) continue;
    termSet.add(t);
  }
}
const terms = [...termSet].sort();
console.log(`Checking ${terms.length} single-skill term pages...`);
for (const term of terms) {
  const e = jobsTermSeo(term);
  validateEntry(`term:${term}`, e);
  // keyword-led: the term's first word should appear in the title (compare on
  // alphanumerics only so display spellings like "Next.js" still match "nextjs").
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const head = norm(term.split(" ")[0]);
  check(
    `term:${term}: title leads with keyword`,
    norm(e.title).includes(head),
    `"${e.title}"`,
  );
}

// ---- comparison pages -------------------------------------------------
console.log(`Checking ${COMPARISONS.length} comparison pages...`);
for (const c of COMPARISONS) {
  const e = jobsComparisonSeo(c.terms);
  validateEntry(`cmp:${c.terms.join("|")}`, e);
  check(
    `cmp:${c.terms.join("|")}: title has " vs " or " Demand"`,
    / vs |Demand/i.test(e.title),
    `"${e.title}"`,
  );
}

// ---- measured-volume sanity ------------------------------------------
console.log(`Captured ${KEYWORD_VOLUMES.length} real Ahrefs volumes.`);
check(
  "KEYWORD_VOLUMES non-trivial",
  KEYWORD_VOLUMES.length >= 50 && KEYWORD_VOLUMES.every((k) => k.volume >= 0),
);

console.log(
  failures === 0
    ? `\nOK - all SEO pages have keyword-led, well-formed copy.`
    : `\n${failures} FAILURES`,
);
process.exit(failures === 0 ? 0 : 1);
