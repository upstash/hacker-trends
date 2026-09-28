<div align="center">

# 📈 Hacker Trends

**Search 18 years of Hacker News and watch any term rise and fall over time.**

[![Live Demo](https://img.shields.io/badge/Live_Demo-FF6600?style=for-the-badge&logo=ycombinator&logoColor=white)](https://hackernewstrends.com)
[![Powered by Upstash Redis Search](https://img.shields.io/badge/Powered_by-Upstash_Redis_Search-DC2626?style=for-the-badge&logo=upstash&logoColor=white)](https://upstash.com/docs/redis/search/introduction)
[![Deploy on Vercel](https://img.shields.io/badge/Deploy_on-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fhacker-trends&env=UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN&envDescription=Upstash%20Redis%20REST%20credentials&envLink=https%3A%2F%2Fupstash.com%2Fdocs%2Fredis%2Ffeatures%2Frestapi&project-name=hacker-trends&repository-name=hacker-trends)


<img src=".github/assets/demo.webp" width="640" alt="Searching a term on Hacker Trends and watching its mention count trend across 18 years of Hacker News" />

</div>

---

Type a word and you get two things at once: a month-by-month trend line of how
often Hacker News talked about it, and the real posts and comments behind every
spike. Search one term, or stack several on the same chart to see which one the
internet actually cared about.

The whole thing is a thin UI over **[Upstash Redis Search](https://upstash.com/docs/redis/search/introduction)**.
There's no separate search engine to run - you store plain Redis hashes and
define one index over them, and every search and every trend line is a single
`@upstash/redis` call.

## What you can do

- 🔎 **Search** ~45M Hacker News posts and comments, full-text, in milliseconds.
- 📈 **See the trend** - mentions per month for any term, so you know exactly when it took off.
- 🆚 **Compare** several terms on one chart and watch them rise and fall against each other.
- 🧵 **Drill in** to the actual stories and comments behind each spike - who wrote them, and how the conversation splits between posts and replies.

## How it works

**1. Ingest.** `scripts/ingest.ts` streams monthly Hacker News Parquet files
from HuggingFace for backfills, and a daily GitHub Action pulls new items from
the official [HN API](https://github.com/HackerNews/API) (`--live`). Each item
is `HSET` as a plain `hn:<id>` hash in Upstash Redis.

**2. Index.** Before loading, the same script defines one search index over
those hashes:

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
    parent: s.number("F64"),
  }),
});
```

**3. Query.** Every search the UI runs is one `hn.query({ filter, ... })`, and
every trend line is one `hn.aggregate({ filter, aggregations })`. Both are built
from the same options in `src/lib/hn-query.ts`.

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
// mentions per month
const { aggregations } = await hn.aggregate({
  filter: { title: { $eq: "rust" } },
  aggregations: {
    by_month: { $dateHistogram: { field: "time", fixedInterval: "30d" } },
  },
});
```

## Run it locally

Add your Upstash Redis REST credentials to `.env.local`:

```bash
UPSTASH_REDIS_REST_URL="..."
UPSTASH_REDIS_REST_TOKEN="..."
```

Then install, load some data, and start the dev server:

```bash
bun install

# ingest one quarter to play with (creates the index on first run)
bun scripts/ingest.ts 2026 Q1

# build the "Who is hiring?" postings index for the same months
# (/who-is-hiring reads it by default; set NEXT_PUBLIC_JOBS_INDEX_READY=0 to skip)
bun scripts/ingest-jobs.ts 2026-01 2026-03

bun dev
```

Open [localhost:3000](http://localhost:3000) and start searching.

## Tech stack

- **[Upstash Redis Search](https://upstash.com/docs/redis/search/introduction)** via [`@upstash/redis`](https://github.com/upstash/redis-js) - the entire search + analytics backend.
- **[Next.js](https://nextjs.org)** (App Router) + React, deployed on **[Vercel](https://vercel.com)**.
- Hacker News data from the monthly Parquet dumps on HuggingFace, kept current from the official HN Firebase API.

## License

[MIT](LICENSE) © Upstash
