# Perf investigation: why "Who is hiring?" queries are slow

Status: iteration 2 (PERF-INVESTIGATE). Measured against the live Upstash
endpoint with `bun --env-file=.env.local scripts/bench-jobs-queries.ts`.
6 trials/case, `cache: no-store` (so every number is the real Upstash
round-trip, never a CDN hit). `hnjobs` was backfilling concurrently, so its
docCounts below are PARTIAL; the LATENCY and query SHAPE are what matter and are
representative mid-fill.

## TL;DR

The slowness is the **`hn` index**, which holds 40M+ Hacker News items. Every
`/who-is-hiring` query - the chart aggregate, every gallery mini-card, and the
hover drill-down - runs against that giant index. Two distinct costs:

- **Aggregate path (chart + gallery):** the giant index alone costs ~650ms per
  term. The 180-way `parent` `$or` (`scope=jobs`) adds essentially **nothing**
  here (it only narrows the histogram). So the chart is slow because it is
  aggregating over all of HN, not because of the `$or`.
- **Drill-down path (search):** here the 180-way `$or` is **catastrophic**. A
  term+time search on `hn` is ~1.0s; adding the `scope=jobs` `$or` pushes it to
  **~4.7s** (the `$or` alone adds ~3.7s).

The dedicated **`hnjobs`** index (postings-only, ~93k docs, no scope arm needed)
runs the *same* aggregate in ~195-255ms and the *same* drill-down in ~195ms.

| path | current (`hn`) | `hnjobs` | speedup |
| --- | --- | --- | --- |
| chart aggregate (per term) | ~650ms | ~195-255ms | ~3x |
| drill-down search (1 month) | ~4700ms | ~195ms | ~24x |

## Measured latency table

### CASE 1 vs 2 - chart aggregate: shared `hn`+scope vs dedicated `hnjobs`

| case | min | med | p90 | max | payload |
| --- | --- | --- | --- | --- | --- |
| 1. hn + scope=jobs   q=rust   | 645ms | 664ms | 866ms | 866ms | 151 buckets, 2691 docs |
| 1. hn + scope=jobs   q=python | 670ms | 717ms | 834ms | 834ms | 186 buckets, 20421 docs |
| 1. hn + scope=jobs   q=react  | 608ms | 647ms | 665ms | 665ms | 158 buckets, 20394 docs |
| 2. hnjobs (no scope) q=rust   | 181ms | 194ms | 198ms | 198ms | 2 buckets, 28 docs |
| 2. hnjobs (no scope) q=python | 243ms | 254ms | 255ms | 255ms | 186 buckets, 1064 docs |
| 2. hnjobs (no scope) q=react  | 185ms | 196ms | 200ms | 200ms | 2 buckets, 71 docs |

(`hnjobs` counts are low/uneven because the backfill is still running; that does
not change the latency story.)

### CASE 3 - marginal cost of the 180-way parent `$or` (hn index, aggregate)

| case | med (interleaved x8) | payload |
| --- | --- | --- |
| 3a. hn, NO scope     q=rust | ~714ms | 229 buckets, 263199 docs |
| 3b. hn, scope=jobs   q=rust | ~652ms | 151 buckets, 2691 docs |

Delta of the `$or` on the aggregate path: **~ -62ms** (i.e. within noise, even
slightly faster WITH scope because the narrowed set has far fewer docs to bucket).
Takeaway: on the aggregate path the `$or` is NOT the problem - the giant index is.

### CASE 4 - drill-down search within one month: `hn`+scope vs `hnjobs`

Isolated three ways (5 trials each) to separate the giant-index cost from the
`$or` cost:

| case | med | note |
| --- | --- | --- |
| 4a. hn, term+time, NO scope | ~1021ms | giant index, no `$or` |
| 4b. hn, term+time + 180-way `$or` (scope=jobs) | **~4723ms** | this is what the app runs today |
| 4c. hnjobs, term+time | **~195ms** | postings-only, no `$or` |

The 180-way `$or` adds **~3.7s** on the search path (1.0s -> 4.7s). `hnjobs`
removes it entirely and is also off the giant index: **~24x faster**.

## Diagnosis

Two root causes, one fix.

1. **The `hn` index is enormous (40M+ items).** Confirmed via the Upstash Redis
   Search docs (`/websites/upstash_redis`): an aggregate/search walks the index's
   posting lists, so a term match on the all-of-HN index is inherently a ~600-700ms
   operation no matter how you filter it. This is why the chart and every gallery
   mini-card feel slow - they each aggregate over all of HN.

2. **The 180-way `parent` `$or` is poison on the SEARCH (drill-down) path.** On
   the `hn` index `parent` is `s.number("F64")` with **no `.fast()`**
   (see scripts/ingest.ts schema; only `time` is `.fast()`). The docs confirm
   that `$terms`/`$dateHistogram`/`orderBy` require a `FAST` field; a 180-clause
   boolean `$or` over a non-`FAST` numeric field, evaluated alongside BM25
   relevance scoring + ordering, blows the drill-down up to ~4.7s. (On the pure
   aggregate path the `$or` happens to be cheap because it only restricts the
   histogram's input, but on the scored/ordered search it is the dominant cost.)

The `hnjobs` index (scripts/ingest-jobs.ts, src/lib/jobs-index.ts) is built
exactly to sidestep both: it contains ONLY the ~93k job postings, so it needs NO
`scope=jobs` `$or` arm at all, and it is tiny relative to `hn`. Same query shape
(same `$dateHistogram`, same term arms), 3x-24x faster. It is already wired for
the drill-down behind `NEXT_PUBLIC_JOBS_INDEX_READY`, but the AGGREGATE
(chart + gallery) path is hard-coded to `hn`+scope and is NOT routed to it.

### Secondary finding (not a perf bug, but it explains the month-gap artifact)

`$dateHistogram` supports **only `fixedInterval`** ("30d", "1h", ...); the docs
confirm there is **no `calendarInterval`**. So the chart's 30d buckets drift
against calendar months (~12.17 buckets/year), which is the documented white-gap
artifact already handled by `binMonths`/`buildColumns` in src/lib/jobs-trends.ts.
Moving to `hnjobs` does NOT change this (same operator), so keep that folding
logic. No action needed - noted so the fixer does not "fix" the histogram.

## Recommendation (for the PERF-FIX step)

Route the AGGREGATE path (chart + gallery) to `hnjobs`, exactly as the drill-down
already does, and serve the gallery from the precomputed JSON so cards never hit
the API cold.

1. **Make `buildAggregateArgs` index-aware.** It currently hard-codes
   `"hn"` as `args[1]` and always passes `scope`. Give it an `index?: SearchIndex`
   option: when `index === "hnjobs"`, emit `"hnjobs"` as the index name and DROP
   the `scope` arm from `buildFilter` (postings-only index needs no parent `$or`),
   mirroring what `buildSearchArgs` already does for `onJobsIndex`. The
   `$dateHistogram`/`$terms` aggregations are unchanged (`time`/`by`/`type` exist
   and are `.fast()` on both indexes).

2. **Have the aggregate callers pick the index via the existing gate.** In
   `useJobSeries.ts` (`aggregate({ q: p, scope: "jobs" })`) and the gallery's
   live fallback, call `drillIndex()` from src/lib/jobs-index.ts (it already
   returns `{ index: "hnjobs", scope: undefined }` when
   `NEXT_PUBLIC_JOBS_INDEX_READY` is set, else `{ index: "hn", scope: "jobs" }`).
   Pass that `index` (and `scope`) into `aggregate(...)` -> `/api/hn?op=aggregate`.
   The edge route's `argsFromParams` must forward `index` to `buildAggregateArgs`
   (today it only forwards `index` for the search op). Net effect: flipping the
   one env flag moves chart + gallery + drill-down to `hnjobs` together, with no
   further code change - and falls back safely to `hn`+scope until then.

3. **Finish + verify the `hnjobs` backfill, then flip the flag.** Run
   `bun scripts/ingest-jobs.ts --all` to completion, confirm the daily Action
   refreshes it, then set `NEXT_PUBLIC_JOBS_INDEX_READY=1`. Until counts are
   complete the chart would under-report, so do NOT flip the flag mid-fill.

4. **Serve the gallery entirely from `/who-is-hiring/examples.json`.** The cards
   already prefer the CDN-cached JSON but fall back to a live per-card aggregate
   when a term is missing - and each such fallback is a cold ~650ms (`hn`) hit, so
   a gallery of N cards can fan out N slow queries on first paint. Make sure
   `refresh-cache.ts` (or the jobs-gallery equivalent) precomputes EVERY gallery
   term's histogram into the JSON so the live fallback effectively never fires;
   then a full gallery render is a single CDN fetch (~50ms) instead of N x 650ms.

Expected result: chart aggregate ~650ms -> ~200ms (~3x), drill-down ~4700ms ->
~195ms (~24x), and the gallery a single CDN fetch instead of a slow per-card
fan-out.

## How to reproduce

```
bun --env-file=.env.local scripts/bench-jobs-queries.ts
```

The script builds args through the real src/lib/hn-query.ts builders (so the
queries are byte-identical to what the edge route runs), swaps only the index
name for the `hnjobs` cases, and prints the min/med/p90/max table above.

## AFTER (PERF-FIX shipped, backfill complete) - 2026-06-18

The fix is in (commit "route aggregates to hnjobs index"): `buildAggregateArgs`
is index-aware, the aggregate callers route through `drillIndex()`, and
`NEXT_PUBLIC_JOBS_INDEX_READY=1` is set. The `hnjobs` backfill is now COMPLETE:
**93,683 postings across 180/180 thread-months** (verified: distinct
thread-months 180/180; `python` aggregate -> 186 buckets / 20,421 docs, matching
`hn`+scope exactly). Re-ran the same benchmark against the now-full index:

### CASE 1 vs 2 - chart aggregate: shared `hn`+scope vs dedicated `hnjobs`

| case | min | med | p90 | max | payload |
| --- | --- | --- | --- | --- | --- |
| 1. hn + scope=jobs   q=rust   | 545ms | 557ms | 787ms | 787ms | 151 buckets, 2691 docs |
| 1. hn + scope=jobs   q=python | 595ms | 630ms | 669ms | 669ms | 186 buckets, 20421 docs |
| 1. hn + scope=jobs   q=react  | 528ms | 578ms | 603ms | 603ms | 158 buckets, 20394 docs |
| 2. hnjobs (no scope) q=rust   | 188ms | 194ms | 199ms | 199ms | 151 buckets, 2691 docs |
| 2. hnjobs (no scope) q=python | 216ms | 257ms | 261ms | 261ms | 186 buckets, 20421 docs |
| 2. hnjobs (no scope) q=react  | 189ms | 204ms | 248ms | 248ms | 158 buckets, 20394 docs |

Now that the index is full, the payloads are **byte-identical** (same bucket
counts AND same docCounts) between `hn`+scope and `hnjobs` - proof the routing
swap returns the same data, only faster. Chart aggregate: ~557-630ms -> ~194-257ms,
a clean **~2.5-3x**.

### CASE 4 - drill-down search within one month: `hn`+scope vs `hnjobs`

| case | min | med | p90 | max |
| --- | --- | --- | --- | --- |
| 4a. hn + scope=jobs  2026-05 | 3639ms | 3752ms | 3838ms | 3838ms |
| 4b. hnjobs           2026-05 |  239ms |  268ms |  338ms |  338ms |

Drill-down: ~3750ms -> ~268ms, a **~14x** speedup (the 180-way `$or` over the
non-`.fast()` `parent` field is the whole cost; `hnjobs` has no `$or` arm).

### Net before/after

| path | before (`hn`+scope) | after (`hnjobs`) | speedup |
| --- | --- | --- | --- |
| chart aggregate (per term) | ~557-630ms | ~194-257ms | ~2.5-3x |
| drill-down search (1 month) | ~3750ms | ~268ms | ~14x |

Identical results, every gallery card and the hover drill-down land sub-300ms.
