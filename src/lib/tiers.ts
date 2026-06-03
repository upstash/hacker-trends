/** SEO indexing tiers derived from a click-potential proxy score
 *  (recognizability + recency + comparison-participation + group volume), i.e.
 *
 *    score = 40·recognizability   // 0–3 search-demand / brand proxy
 *          + 22·recency           // 0–2: peaked 2023–26 / 2016–22 / pre-2016
 *          + 12·min(comparisons,3)// how many curated A-vs-B charts it joins
 *          + 10·groupVolume       // 0–3 category-level demand (ai/crypto/people=3)
 *
 *  Tier 1 (score ≥ 172) = custom analysis + top sitemap priority.
 *  Tier 2 (110 ≤ score < 172) = indexed/templated — IMPLICIT: any known catalog
 *    term/comparison not listed below.
 *  Tier 3 (score < 110) = noindex,follow + dropped from sitemap.
 *
 *  Hand-curated and meant to be edited — bump a term up/down by moving its slug
 *  between sets. Slugs are in termToSlug() form (site.ts): lowercase,
 *  non-alphanumeric runs collapsed to "-", outer dashes trimmed. Comparison
 *  slugs are comparisonSlug() form: each term slugged, joined with "-vs-". */

/** Tier 1: highest click-potential — get model-authored analysis paragraphs and
 *  sitemap priority 0.7. (~40 terms) */
export const TIER1_SLUGS: ReadonlySet<string> = new Set([
  "gpt-4", "chatgpt", "deepseek", "apple-silicon", "crowdstrike", "section-230",
  "glp-1", "vision-pro", "nvidia", "james-webb", "elden-ring", "elon-musk",
  "sam-altman", "claude", "gemini", "copilot", "grok", "bitcoin", "web3",
  "kubernetes", "tsmc", "nft", "layoffs", "recession", "tiktok", "ozempic",
  "semaglutide", "openai", "binance", "coinbase", "amd", "snowflake",
  "neuralink", "elizabeth-holmes", "sbf", "ethereum", "crypto", "metaverse",
  "gamestop", "ftx",
]);

/** Tier 3: long-tail insider terms that can't realistically rank — kept crawlable
 *  (robots index:false, follow:true) but removed from the sitemap so they don't
 *  dilute the site's quality average. (~107 terms) */
export const TIER3_SLUGS: ReadonlySet<string> = new Set([
  "framework-laptop", "ai-bubble", "zirp", "founder-mode", "quiet-quitting",
  "the-great-resignation", "soft-landing", "hustle-culture", "four-day-week",
  "unionization", "nicotine", "standing-desk", "blue-light", "circadian-rhythm",
  "angular", "npm", "microservices", "serverless", "linode", "rackspace",
  "sopa", "stuxnet", "qwen", "gleam", "nostr", "x-rebrand", "age-verification",
  "room-temperature-superconductor", "gpu-prices", "scala", "mysql", "flash",
  "html5", "skype", "jenkins", "haskell", "apache", "django", "ruby-on-rails",
  "mongodb", "litecoin", "jquery", "angularjs", "piracy", "rss",
  "hashicorp-license", "opentofu", "redis-license", "valkey", "stadia",
  "ai-winter", "jax", "microsoft-teams", "elixir", "rest-api", "grpc",
  "oculus", "google-assistant", "julia", "lsp", "fediverse", "activitypub",
  "content-moderation", "ad-blocker", "dark-patterns", "clubhouse", "speedrun",
  "denuvo", "supply-chain-attack", "backbone", "ember", "monorepo",
  "linux-gaming", "open-core", "react-license", "audacity", "elastic-license",
  "mongodb-license", "capacitor", "sublime", "atom", "chef", "puppet",
  "ansible", "clojure", "google-glass", "couchdb", "cassandra", "xamarin",
  "meteor", "digg", "rust-rewrite", "agile", "parcel", "esbuild", "rollup",
  "cookie-banner", "deplatforming", "shadowban", "right-to-be-forgotten",
  "whiteboard-interview", "leftpad", "sspl", "coffeescript", "grunt", "gulp",
  "phonegap", "cordova", "tdd", "scrum", "10x-engineer", "yaml",
  "technical-debt", "waterfall", "pair-programming", "code-review",
  "semantic-versioning", "conway-s-law",
]);

/** Curated comparisons too thin/obscure to index — noindex,follow, out of
 *  sitemap. Either the strongest term scores below the Tier-2 floor, or it's a
 *  build-tool / dev-relic relay (bundlers, config-mgmt, old NoSQL/editors,
 *  cross-platform mobile, API-protocol and JVM-language successions) whose
 *  matchup is insider history that won't rank even when one famous term lifts
 *  the max-score. (~18 comparisons) */
export const COMPARE_NOINDEX_SLUGS: ReadonlySet<string> = new Set([
  "flash-vs-html5",
  "chef-vs-puppet-vs-ansible",
  "clojure-vs-haskell-vs-elixir",
  "backbone-vs-ember-vs-angular",
  "couchdb-vs-cassandra-vs-mongodb",
  "selenium-vs-cypress-vs-playwright",
  "phonegap-vs-cordova-vs-capacitor",
  "parcel-vs-esbuild-vs-rollup",
  "prometheus-vs-grafana-vs-datadog",
  "grunt-vs-gulp-vs-webpack",
  "coffeescript-vs-typescript",
  "sublime-vs-atom-vs-vscode",
  "apache-vs-nginx-vs-caddy",
  "rest-api-vs-grpc-vs-graphql",
  "xamarin-vs-react-native-vs-flutter",
  "scala-vs-swift-vs-kotlin",
  "django-vs-ruby-on-rails-vs-laravel",
  "jenkins-vs-github-actions",
]);
