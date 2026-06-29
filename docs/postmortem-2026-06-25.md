# Post-mortem: Upstash Search overload during the HN/Reddit viral spike

**Date of incident:** 2026-06-25
**Author:** reconstructed 2026-06-26 from Vercel request logs (`vercel-logs` CLI + internal dashboard logs API) + deploy history + source. v2 adds per-endpoint forensics that resolve the `/examples.json` question.
**Severity:** SEV-1 (core feature - search & trend charts - down/degraded for ~6 hours under peak traffic)
**Status:** Resolved 2026-06-25 ~21:00 UTC; hardening shipped 2026-06-26 morning

> All times **UTC**. (Author is UTC+3; `vercel-logs` row view prints local, `timeseries`/`vl_helper.py` print UTC. Local = UTC + 3h.)
> Per-bucket counts are EXACT (server-side aggregated). Op-split / query-diversity / UA / durations are SAMPLED (noted inline).

---

## 0. Capacity at a glance (TL;DR)

The single Upstash Search DB could sustain only **~9-10 live Search queries/sec** (each a `search`/`aggregate`
over 44.8M docs, ~0.6-1.5s of DB work). The viral spike drove **~40 queries/sec at the `/api/hn` origin**.
Past the knee it went into **congestion collapse** - pushed harder, it completed *fewer* queries, not more -
and then the DB hard-rejected everything. Each row below = live origin queries (cache-MISS) on `/api/hn`:

| time (UTC) | DB state | attempted q/s | **succeeded q/s** | errors/s | error % | errored queries in window |
|---|---|--:|--:|--:|--:|--|
| ≤14:55 | healthy | ≤3 | ≤3 | 0 | **0%** | 0 |
| 15:00 | **knee** - first errors | 14 | 7.3 | 6.9 | 48% | 2,066 × 504 (5 min) |
| 15:05 | **ceiling reached** | 24 | **9.0 (max ever)** | 14.9 | 62% | 4,458 × 504 (5 min) |
| 15:10 | collapsing | 34 | 5.6 | 28.4 | 84% | 8,521 × 504 (5 min) |
| 15:15 | collapse | 38 | 0.2 | 38.0 | **99.5%** | 11,408 × 504 (5 min) |
| 15:20 | total meltdown | 41 | **0.0** | 41.1 | **100%** | 12,334 × 504 (5 min) |
| 15:25-16:00 | DB hard-rejecting | ~20-30 | ~0 | ~20-30 | ~100% | 502 fast-fails take over (45,451 × 502 in 15:30-16:00) |
| ~21:00 | **DB scaled up** | ~6 | 5.9 | 0 | **0%** | 0 |

So: **0 errors up to ~10 q/s; saturation at ~10-14 q/s; ~100% failure by ~40 q/s.** Whole incident:
**64,993 × 504** (overload timeouts) + **65,999 × 502** (hard rejects) = **~131k failed queries**, plus 13,916
× 503 from the kill-switch. (q/s are averaged over each window; instantaneous peaks were higher. Full
breakdown in §4-5.)

---

## 1. Summary

The site hit the HN front page (via `/?q=openai&q=anthropic`) and Reddit, driving ~100x traffic (~13.9k
users that day, 99.6% new, peak **6,381 req/min** at 15:10 UTC). The core endpoint **`/api/hn` runs a live
Upstash Search query on every request** against a ~44.8M-doc index. A single Upstash DB could not sustain
the query rate and saturated in two stages:

- **Overloaded but accepting** -> queries queue past the 25s function limit -> **64,993 × HTTP 504**.
- **Hard ceiling, rejecting fast** -> **65,999 × HTTP 502** (confirmed fast-fails, 148-659ms).

Total over the incident (~14:40-21:00 UTC): **~730k requests, ~145k failures** (~20% overall; worst 30-min
window **95%**). The fix was **scaling up the Upstash DB** (~21:00 UTC, errors -> 0 with **no deploy**).
Per-IP rate limiting and a durable Redis result cache were added **the next morning**.

**On `/examples.json` (the headline question of this revision):** it does NOT call `/api/hn` - its ~aggregate
fan-out is direct Upstash SDK calls, invisible in request logs - so by request count it looks tiny, but its
*hidden* DB load could in principle be 308x its request count. We verified from function durations that it
**did NOT fan out during this incident** (its cache key was primed), so it contributed ~0 hidden aggregates
and was **not** a primary cause. **But it was one stale cache key away from being THE primary cause** (see §6).
`/api/hn` was the confirmed killer.

---

## 2. Impact

| Metric | Value |
|---|---|
| Incident window | ~14:40 - 21:00 UTC; acute 15:00-16:00 and 18:30-20:30 |
| Total requests | ~730,000 |
| Failed requests | ~145,000 (502: 65,999 / 504: 64,993 / 503: 13,916 kill-switch; 429: **0**) |
| Peak throughput | **6,381 req/min** (15:10 UTC bucket) |
| Worst 30-min error rate | **95%** (`/api/hn`, 15:30-16:00) |
| `/api/hn` visible DB-query attempts (MISS+STALE) | ~268k total; **65,504 in the 15:00-15:30 peak half-hour** |
| Healthy live-query latency | ~1.5s; at peak ~73% hit the 25s timeout |
| Function concurrency | p50 **28** / max **110** at peak (vs 5 / 15 recovered) |

---

## 3. Architecture: which paths touch the DB, and how

All Upstash access goes through one `runAggregate`/`runQuery` (`hn-index.ts` -> `.aggregate()`/`.query()`)
against **one** Search index. Per-request DB cost:

| Endpoint | DB work per request | Cached by | Visible in Vercel logs? |
|---|---|---|---|
| **`/api/hn`** | **1 live query** per cache-MISS/STALE (`op=search`/`aggregate`/`thread`) | Edge CDN (s-maxage) | Yes - 1 request = ~1 query |
| **`/examples.json`** | On CDN-MISS: **1 GET** of a primed Redis blob; on a key-MISS: **fan-out of 308 aggregates** (concurrency 8) | Edge CDN **+** a single Redis key `examples:v5` | **NO** - the 308 aggregates are direct SDK calls, invisible. 1 request can hide 308 queries |
| `/`, `/how-it-works` | none (static shell; gallery data is client-fetched after paint) | static/CDN | n/a |
| `/who-is-hiring`, `/who-is-hiring/examples.json` | own CDN-cached gallery (twin of `/examples.json`) | CDN + Redis key | mostly CDN |
| `/opengraph-image`, `/trends/*`, `/compare/*` | small/none; programmatic pages, negligible volume (single digits during peak) | CDN | n/a |

**Key consequence:** request-count comparisons *understate* `/examples.json` because its fan-out is hidden.
Resolving its true load needs function-duration analysis, not request counts (see §6).

`QUERYING_DISABLED` (a hardcoded `const` in `maintenance.ts`, so toggling needs a commit + deploy) makes
`/api/hn` return **503 `{error:"querying is disabled"}`** and `/examples.json` serve a baked snapshot. The
503 count is an exact fingerprint of when querying was off.

---

## 4. Master timeline (per-bucket, UTC)

10-min buckets over the acute onset, 30-min after. `req/min` and `%` rounded; counts exact.
`err% = (504+502+503)/req`. OTHER = TOTAL - /api/hn - /examples.json (≈ homepage/HTML/OG, negligible DB).

| bucket | min | TOTAL | req/min | err% | /api/hn | hn err% | /examples.json | ex err% | OTHER | event in bucket |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|
| 14:40 | 10 | 2,033 | 203 | 0.0 | 1,653 | 0.0 | 17 | 0.0 | 363 | baseline |
| 14:50 | 10 | 7,285 | 728 | 0.0 | 3,346 | 0.0 | 156 | 0.0 | 3,783 | ramp begins |
| 15:00 | 10 | 36,140 | 3,614 | 18.1 | 22,829 | 28.6 | 1,099 | 0.0 | 12,212 | **504s appear** (overload) |
| 15:10 | 10 | 63,808 | **6,381** | 31.7 | 41,545 | 48.0 | 2,333 | 1.3 | 19,930 | **peak traffic** |
| 15:20 | 10 | 53,864 | 5,386 | 44.4 | 33,119 | 70.3 | 2,320 | **26.0** | 18,425 | **15:23 deploy** purges CDN -> examples.json origin spike |
| 15:30 | 10 | 36,091 | 3,609 | 50.0 | 18,445 | **97.7** | 1,886 | 0.0 | 15,760 | **502s take over** (DB fast-rejects) |
| 15:40 | 10 | 35,602 | 3,560 | 52.3 | 19,290 | 96.5 | 1,797 | 0.0 | 14,515 | sustained 502 storm |
| 15:50 | 10 | 27,647 | 2,765 | 41.5 | 12,693 | 90.3 | 1,659 | 0.0 | 13,295 | 15:52 failed build; 15:55 deploy; first 503s |
| 16:00 | 30 | 48,259 | 1,609 | 10.4 | 4,982 | 100.0 | 4,655 | 0.0 | 38,622 | **16:01 kill-switch ON #1** (api/hn->503) |
| 16:30 | 30 | 42,660 | 1,422 | 9.9 | 4,221 | 100.0 | 4,160 | 0.0 | 34,279 | kill-switch still ON |
| 17:00 | 30 | 84,200 | 2,807 | 3.1 | 53,402 | 4.9 | 3,200 | 0.0 | 27,598 | **17:00 re-enable** + wire cache |
| 17:30 | 30 | 47,306 | 1,577 | 13.6 | 27,780 | 23.2 | 1,869 | 0.0 | 17,657 | 17:31/17:37 deploys; **17:51 kill-switch ON #2** |
| 18:00 | 30 | 21,836 | 728 | 13.0 | 4,959 | 57.2 | 1,424 | 0.0 | 15,453 | kill-switch #2 ON |
| 18:30 | 30 | 48,603 | 1,620 | 21.2 | 34,184 | 30.2 | 1,241 | 0.0 | 13,178 | **18:26 re-enable** (stays on) |
| 19:00 | 30 | 46,382 | 1,546 | 17.5 | 32,867 | 24.7 | 1,137 | 0.0 | 12,378 | live; 504+502 mix |
| 19:30 | 30 | 45,901 | 1,530 | 14.4 | 32,777 | 20.2 | 1,076 | 0.0 | 12,048 | errors easing |
| 20:00 | 30 | 41,419 | 1,381 | 3.7 | 29,438 | 5.3 | 991 | 0.0 | 10,990 | near-clean |
| 20:30 | 30 | 38,877 | 1,296 | 12.8 | 27,838 | 17.9 | 925 | 0.0 | 10,114 | brief 504 relapse |
| 21:00 | 30 | 35,905 | 1,197 | **0.0** | 25,614 | 0.0 | 821 | 0.0 | 9,470 | **~21:00 Upstash DB scaled up (NO deploy)** -> recovered |

Reading it: error onset 15:00; **504 regime 15:00-15:20** (DB overloaded), **502 regime 15:30-15:50** (DB
rejecting); kill-switch ON #1 16:01-17:00 (errors drop, traffic 503'd); re-enable 17:00 healthy-ish; kill #2
17:51-18:26; re-enable 18:26 still failing because the DB was still small; **clean at 21:00** once the DB was
scaled. `/api/hn` err% tracks the DB; `/examples.json` is ~0% everywhere **except the single 15:20 bucket**
(the 15:23 CDN purge) - the one moment it touched the struggling origin.

### 4b. Cache erosion (why so much hit the DB)

`/api/hn` origin-rate = (MISS+STALE)/req = its query-amplification. It climbs toward 100% as each deploy
purges the CDN and as the saturated origin can't refill the cache before `s-maxage` expiry:

| bucket | /api/hn HIT | MISS | STALE | origin% | /examples.json HIT | MISS | origin% |
|---|--:|--:|--:|--:|--:|--:|--:|
| 15:00 | 11,085 | 11,420 | 324 | 51% | 1,097 | 2 | 0.2% |
| 15:10 | 15,191 | 21,662 | 4,692 | 63% | 2,303 | 30 | 1.3% |
| 15:20 | 5,713 | 23,423 | 3,983 | **83%** | 1,476 | **844** | **36%** |
| 15:30 | 411 | 18,034 | 0 | **98%** | 1,885 | 1 | 0.1% |
| 16:00 | 0 | 4,982 | 0 | 100% (kill-switch, 503) | 4,635 | 20 | 0.4% |
| 17:00 | 29,132 | 24,270 | 0 | 45% | 3,174 | 26 | 0.8% |
| 21:00 | 13,854 | 10,524 | 1,236 | 41% | 821 | 0 | 0% |

`/api/hn` MISS-rate went 58% -> 95% during the spike: a **self-reinforcing spiral** - the slower the
saturated origin got, the longer keys stayed unrefilled, the more the next wave MISSed. `/examples.json`
stayed CDN-served (origin% <4%) except the one post-deploy cold window.

---

## 5. `/api/hn` anatomy (the primary cause)

- **op split (sampled):** roughly balanced, search slightly ahead at peak (~**60% search / 40% aggregate**;
  `thread`≈0 at peak). So *user searches*, not chart aggregates, led - but both cost the same (~1.5s).
- **Per-page fan-out is the real multiplier:** one default homepage view (`/?q=openai&q=anthropic`) fires
  ~**4** `/api/hn` calls (a chart `aggregate` + a `search` per term). Viral page views -> 4x DB calls each.
- **Query mix (sampled, peak):** the 2 homepage defaults (anthropic, openai) = ~**49%** of requests but only
  ~2-3 cache keys - yet they MISSed ~58% (**thundering-herd stampede** on hot-key expiry). The other ~51% is
  a genuine **long tail** (91 distinct terms in 350 sampled rows) that is structurally uncacheable. Both
  compounded.
- **Not abuse:** 350/350 sampled = real browsers, **0 bots, 0 prefetch**, spread across 8+ edge regions, all
  referred from the site's own homepage. Broad organic surge.
- **Concurrency/latency:** healthy query ~1.5s; at peak the distribution went bimodal - a lucky few got a DB
  slot (<3s), **~73% queued to the 25s function limit and 504'd**; function concurrency p50 28 / max 110.
- **Visible DB-query attempts (MISS+STALE):** ~**268k** across the incident (upper bound; subtract the
  16:00-17:00 503s that never reached Upstash and a share of the 502 fast-fails), **65.5k in the peak half-hour**
  against one DB.

---

## 6. `/examples.json` forensics - did the hidden fan-out fire? (NO - but a near-miss)

**Does `/examples.json` call `/api/hn`?** No. It calls `runAggregate(redis, {q})` **directly via the SDK**
inside its own function (no HTTP self-call). Its fan-out is therefore **invisible in request logs** - which is
exactly why request-count analysis can't see it and why this section exists.

**Fan-out size:** `allExampleTerms()` = **308 distinct terms** (227 from EXAMPLE_GROUPS + 81 more from
COMPARISONS; the `examples-data.ts` "~150" comment is stale). At `BUILD_CONCURRENCY=8` that's **39 sequential
Upstash waves** - a hard floor of ~0.6s even at a fictional 15ms/agg, ~6-23s at realistic latency, and
**cannot finish** under the saturated DB.

**Did it fan out? NO. Confidence: HIGH.** Decisive evidence = function durations:

| `/examples.json` cache=MISS window | DB state | completed-200 durations | 504s |
|---|---|---|---|
| 15:00-15:10 (pre-saturation) | ok | 120-126 ms | 0 |
| **15:20-15:30 (acute spike, 844 MISS)** | saturated | 574 ms / p50 ~5,098 ms / **max ~11,068 ms** | 603 |
| 16:05-16:30 (post kill-switch) | snapshot path | 15-101 ms | 0 |
| 21:00-21:30 (recovered) | warm CDN | no origin hits | - |

A 308-aggregate fan-out **cannot complete in 120ms-3s**, yet hundreds of MISS invocations completed 200 at
those latencies on identical code -> every MISS was **one GET of the primed multi-MB `examples:v5` blob +
transcode**, not a fan-out. The 5-11s tail and the 603 × 504 are *slow/stalled GETs of that big value*
against the same Upstash instance the `/api/hn` flood was crushing - they mirror `/api/hn`'s 504 pattern. No
completions in a "finished fan-out" band; failures jump straight to a gateway 504.

**Why the key was primed:** `CATALOG_VERSION = "v5"` since 2026-06-01 (commit d978015), **stable 24 days**;
terms unchanged since; primed once with a writable token (30-day TTL, not yet expired). So during the
incident `getExamplesData()` hit the key and returned after one GET.

**Hidden vs visible DB load, 15:00-15:30:**
- `/examples.json`: ~**876 large-value GETs** (1 Redis op each), **0 aggregate queries**.
- `/api/hn`: **56,505 aggregate/search queries**.
- So `/examples.json` was a minor *bandwidth* load on the shared DB, **not** a hidden aggregate amplifier. It
  did not meaningfully contribute to the saturation.

**THE NEAR-MISS (why the instinct was right):** the non-fan-out outcome hinged entirely on `examples:v5`
being present. Had the key been absent - via a **CATALOG_VERSION bump without re-prime**, a **TTL lapse**, or
an **eviction** - the design would have fanned out catastrophically, because all of these are true:
- prod token is **read-only** -> the best-effort `redis.set` no-ops -> an absent key **never self-heals in prod**;
- **no single-flight** -> every concurrent MISS independently fans out all 308;
- **CDN purges on every deploy** -> the 15:23 deploy already produced an 844-MISS cold window.

Worst case in that 15:20-15:30 cold window: **844 MISS × 308 = ~259,952 aggregate queries in 10 minutes** -
~**4.6×** the entire visible `/api/hn` aggregate load for the surrounding 30-min window, and **entirely
invisible in Vercel logs**. That is the hidden amplifier to fear; it did not fire on 2026-06-25 only because
v5 had been stable for 24 days. **`/examples.json` was one stale cache key away from being the primary cause.**

---

## 7. Root cause

**Primary:** one Upstash Search DB with insufficient throughput for ~100x traffic, behind an architecture
where **every `/api/hn` request is a live query**, amplified by (a) ~4 `/api/hn` calls per page view, (b) a
58-95% cache-MISS rate (long-tail queries + hot-key stampede + CDN purges from ~8 deploys), and (c) the
single DB shared by everything. Two failure signatures (504 overload-timeout, 502 hard-reject), same root.

**Not the cause this time (but a latent primary cause):** the `/examples.json` 308-aggregate hidden fan-out -
dormant only because its cache key was primed and stable (§6).

**Why recovery had no deploy:** errors went 5k/window -> 0 at ~21:00 UTC with no deployment between 18:26 UTC
and the next morning -> the Upstash DB was **scaled up in place** (higher limits, same endpoint, no
connection change). *Exact Upstash-side action/timestamp to be confirmed from the Upstash console for
~20:00-21:00 UTC - not visible in Vercel logs.*

---

## 8. Myth-busting

- **App-level rate limiting was NOT active during the incident.** Zero 429s. Per-IP `@upstash/ratelimit`
  shipped **07:03 UTC the next morning (06-26)**. "Rate limiting the Redis DB" = the *database's own plan
  limits* throttling us (the 502 fast-fails), not our limiter.
- **`/examples.json` was not the killer** - and importantly, not even via hidden load (§6). It was a near-miss.
- **Not abuse / bots / a few IPs** - broad organic browser traffic (§5).
- **Chart aggregates were not the dominant op** - searches slightly led; the multiplier was per-page fan-out.

---

## 9. Action items

Shipped 2026-06-26 AM:
- [x] **`/api/hn` -> Node + durable Redis result cache** (06:44 UTC) - the biggest structural fix.
- [x] **Per-IP rate limiting on `/api/hn`** (07:03 UTC).
- [x] **Bigger Upstash DB** (in-place scale-up, ~21:00 UTC 06-25).
- [x] CI-only build / wire-cache priming for the gallery.

Recommended next (priority order):
- [ ] **Single-flight + guaranteed prime for `/examples.json`** (and `/who-is-hiring/examples.json`): never
  let a cold key fan out 308 aggregates concurrently; fail closed to the snapshot if the key is missing. This
  closes the §6 near-miss.
- [ ] **Make `QUERYING_DISABLED` an env / Edge Config flag** so the kill-switch flips in seconds (it was
  toggled via 4 deploys = long messy MTTR).
- [ ] **Alerting** on 5xx-rate and on Upstash throughput nearing plan limits (incident was noticed by traffic).
- [ ] **Confirm DB autoscaling / set headroom** for known launch events; record plan limits.
- [ ] **Don't deploy during an incident unless the deploy IS the mitigation** (each purges the CDN - directly
  caused the 15:20 examples.json origin spike and reset `/api/hn` hit-rate).
- [ ] **Cap/cache the per-page `/api/hn` fan-out** (batch the chart series into one cached call).
- [ ] CI must re-prime `examples:<CATALOG_VERSION>` on every version bump (and verify in prod).

---

## 10. Method / reproduce

Data via the `vercel-logs` CLI and the helper `scratchpad/vl_helper.py` (both hit Vercel's internal dashboard
logs API - `vercel.com/api/logs/request-logs[/filter-values|/timeseries]` - using the Vercel CLI token).
Exact per-bucket counts: `filter-values?attributeName={cache,statusCode}&search=requestPath:<path>`. Durations
/ op-split / UA: sampled rows (`functionEvents[].durationMs`, `requestSearchParams`, `clientUserAgent`).

Status-code totals 14:30-19:30 UTC: 200: 474,651 · 502: 65,999 · 504: 64,993 · 304: 19,522 · 503: 13,916 ·
404: 209 · **429: 0**. Two log APIs differ ~0.3-8% on totals (timeseries vs filter-values); timeseries totals
are treated as canonical for TOTAL/OTHER.
