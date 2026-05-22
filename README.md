# Hacker Trends - full-text search across 18 years of Hacker News

A search + trends explorer over 45 million Hacker News posts and comments. Search
any term, see how often it's mentioned per each month, and drill into the
results: the actual posts and comments behind each spike, who wrote them, and
how the conversation splits between stories and comments. Live at
**[hacker-trends-seven.vercel.app](https://hacker-trends-seven.vercel.app)**.

This whole UI is a thin shell over a handful of
[`@upstash/redis`](https://upstash.com/docs/redis/search) search calls. There's
no separate search cluster: you store plain Redis hashes and define an index
over them.

## How it works

**1. Ingest.** `scripts/ingest.ts` streams monthly Hacker News Parquet files
from HuggingFace and `HSET`s each item as a plain `hn:<id>` hash in Upstash
Redis.

**2. Index.** Before loading, `scripts/ingest.ts` also defines one search index
over those hashes:

```ts
await redis.search.createIndex({
  name: "hn",
  dataType: "hash",
  prefix: "hn:",
  schema: s.object({
    title: s.string(),
    text: s.string(),
    by: s.keyword(),
    type: s.keyword(),
    time: s.date().fast(),
    score: s.number("F64"),
    ndesc: s.number("F64"),
  }),
});
```

**3. Query.** Every search the UI runs is one `hn.query({ filter, ... })`, and
every trend line is one `hn.aggregate({ filter, aggregations })`. Both are built
from the same opts in `src/lib/hn-query.ts`.

```ts
const hn = redis.search.index({ name: "hn", schema });

// matching posts, newest first
const { documents } = await hn.query({
  filter: { title: { $eq: "rust" }, time: { $gte: "2024-01-01" } },
  orderBy: { time: "DESC" },
  limit: 30,
});
```

```ts
// mentions per month, plus top authors and the story/comment split
const { aggregations } = await hn.aggregate({
  filter: { title: { $eq: "rust" } },
  aggregations: {
    by_month: { $dateHistogram: { field: "time", fixedInterval: "30d" } },
    top_authors: { $terms: { field: "by", size: 6 } },
    by_type: { $terms: { field: "type", size: 4 } },
  },
});
```

## Getting started

Add your Upstash Redis REST creds (`UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`) to `.env`, then:

```bash
bun i

bun scripts/ingest.ts 2026 Q1

bun dev
```

## Stack

- **[Upstash Redis Search](https://upstash.com/docs/redis/search)** via `@upstash/redis`
- Hacker News data from monthly Parquet dumps on HuggingFace
- Next.js (App Router) + React on Vercel
