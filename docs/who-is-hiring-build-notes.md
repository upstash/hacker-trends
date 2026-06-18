# "Who is hiring?" search - build notes

Final verification summary for the `who-is-hiring-search` feature (the
"Hacker News: Who Is Hiring? Search" page, its programmatic SEO routes, the
galleries, and the dedicated `hnjobs` postings index). Written at the close of
the build loop (T21). All build tasks T01-T21 are implemented on this branch.

## What shipped

- **Hub page** `src/app/who-is-hiring/page.tsx` + `WhoIsHiringSearch.tsx`:
  keyword-led metadata, HN header, one-paragraph pitch (no "reviving
  hacker-job-trends" line), the compare chips, the big stacked-bar chart, the
  comment drill-down, and both galleries.
- **Chart** `JobsStackedBars.tsx`: one stacked bar per calendar month, relative
  (100%) by default with a `share % / count` toggle, `all / 10y / 5y / 1y`
  window presets, gap-free months (no white gaps), macOS-dock magnification in
  both axes (written to the DOM per `requestAnimationFrame`, never React state),
  a zoom-strength slider, and a replay-on-change entrance animation.
- **Compare chips** `JobsCompareChips.tsx`: auto-width inputs, a colored dot +
  live total per series, `|` OR-groups, `MAX_SERIES = 8`, the 10-color palette.
- **Drill-down** `JobsComments.tsx`: hover (debounced ~90ms) / click a segment
  streams that series' postings for that month, top 10, author + highlighted
  excerpt only, ranked by `relevance + log(1 + replyCount)`.
- **Galleries** `JobsMiniCard.tsx` + `JobsMiniStacked.tsx`: "Top categories" and
  "Popular comparisons" from `src/lib/jobs-gallery.ts`, lazy-fetched on scroll,
  hoverable, click-to-load-into-the-big-chart. Backed by the CDN-cached
  `/who-is-hiring/examples.json` route with a live lazy-fetch fallback.
- **SEO routes** `src/app/who-is-hiring/[term]/page.tsx` and
  `.../compare/[slug]/page.tsx`: per-page keyword-led titles/meta + custom
  analysis from `src/lib/jobs-seo.ts`, canonical URLs, internal links, sitemap
  entries. The build prerenders 88 term pages + 22 comparison pages.
- **Pure utilities** `src/lib/jobs-trends.ts` (binning, normalization, OR-group
  summation, dock falloff, ranking) - all unit-tested by
  `scripts/test-jobs-trends.ts`.
- **Dedicated index** `scripts/ingest-jobs.ts` builds the `hnjobs` postings
  index with a precomputed direct-children reply count (single parent->count
  pass). The drill-down reads it when present and falls back to the `hn`
  scope=jobs search otherwise.

## Verification (T21)

- `bunx tsc --noEmit` - clean.
- `bun run build` - passes; all routes render (hub, both programmatic route
  families, the `examples.json` route, sitemap). 474 static pages generated.
- `bun scripts/test-jobs-trends.ts` - all pure-function assertions pass.
- `bun --env-file=.env.local scripts/validate-jobs-gallery.ts` - against the
  LIVE jobs-scoped index: 98 distinct gallery terms all live (0 dead, floor 150
  mentions), 23 comparisons all tell a story (0 flat), every card gap-free (0
  holes). Exit 0.
- No em-dash characters anywhere in the feature's files; no "reviving
  hacker-job-trends" copy (the only match is a guardrail comment noting its
  absence).

### `bun run lint`

`lint` is NOT clean, but every remaining problem is in files that are
**byte-identical to `main`** (`git diff main` over them is empty) - pre-existing
debt from the stricter `eslint-config-next` 16 rules (`react-hooks/purity`,
`react-hooks/set-state-in-effect`, `no-explicit-any`, `no-require-imports`):

- `src/app/HackerTrends.tsx`, `src/app/archived/[id]/ArchivedItem.tsx`,
  `src/app/components/DataFreshness.tsx`, `src/app/components/StaticTrend.tsx`,
  `src/app/compare/[slug]/opengraph-image.tsx`
- `scripts/probe-trends.ts`, `scripts/dump-comparison-shock.ts`

Every file this feature OWNS lints clean. The `who-is-hiring/useJobSeries.ts`
`set-state-in-effect` error and the `jobs-seo.ts` unused-var warning that the
feature introduced were both fixed in this round. Fixing the remaining `main`
debt is out of scope for this feature branch (it would touch unrelated pages).

## Iteration 2 close-out (PERF-FIX + FINALIZE) - 2026-06-18

The perf fix shipped and the index is live. See `docs/perf-investigation.md` for
the full before/after table.

- **`hnjobs` full backfill: DONE.** `bun scripts/ingest-jobs.ts --all` completed:
  **93,683 postings across 180/180 thread-months** (11,651 had >=1 direct reply).
  Verified the index is fully populated and that `python` aggregates to the same
  186 buckets / 20,421 docs as `hn`+scope (byte-identical results).
- **Aggregate path routed to `hnjobs` + flag flipped.** `buildAggregateArgs` is
  index-aware, callers route via `drillIndex()`, and `NEXT_PUBLIC_JOBS_INDEX_READY=1`.
  Chart aggregate ~557-630ms -> ~194-257ms (~2.5-3x); drill-down ~3750ms -> ~268ms
  (~14x). Same data, every gallery card + hover drill-down lands sub-300ms.
- **Prototype deleted.** The `job-trends-proto` worktree + branch were removed
  (`git worktree remove --force` + `git branch -D`); `git worktree list` confirms.
- **SEO routes added.** Single-skill `/who-is-hiring/[term]` (28 in sitemap) and
  gallery question pages `/who-is-hiring/top/[slug]` (12 in sitemap), plus the
  hub (1) and curated comparisons (22) -> 63 who-is-hiring entries / 282 total.

### Remaining follow-up (needs a human / CI run, not done in the loop)

- **Confirm the daily `hnjobs` refresh runs green once.** `.github/workflows/ingest.yml`
  already has the sibling steps wired (00:30 UTC): "Refresh the dedicated hnjobs
  postings index (current month)" and a month-boundary "Finalize hnjobs for the
  previous month", both using the writable token. They have not been triggered
  from CI yet - confirm one green run (`gh workflow run "Ingest HN data"` or wait
  for the next scheduled run).
- **Pre-existing `main` lint debt** (unchanged by this branch) is still red; see
  the `bun run lint` note above. Out of scope for this feature branch.
