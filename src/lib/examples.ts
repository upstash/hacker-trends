/**
 * The /examples gallery catalog: every term whose Hacker News mention-histogram
 * we show, grouped into sections, plus the curated "A vs B" comparison pairs.
 *
 * This is the single source of truth for BOTH:
 *   - the cached data fetcher (`examples-data.ts`), which runs one date-histogram
 *     per distinct term here (see `allExampleTerms`) and caches the lot under a
 *     single Redis key, and
 *   - the gallery page (`/examples`), which renders a section per group with a
 *     table-of-contents that jumps to each `id`.
 *
 * Every term was vetted with scripts/probe-trends.ts (and several probe-driven
 * discovery sweeps) for VOLUME + multiple tall, distinct spikes ("peakiness").
 * Flat high-volume words (open source, hiring, privacy, react on its own,
 * enshittification @1.8) are deliberately excluded so each line tells a story.
 * The A-vs-B pairs were chosen so the two overlaid lines show a crossover,
 * succession, or rivalry, not two unrelated wobbles.
 *
 * v4 sweep expanded the thin "general" sections (Internet & culture, Dev
 * culture, Industry zeitgeist) and added FOUR new categories: Science &
 * frontier tech, Open-source license wars, Gaming, and Health & longevity,
 * each vetted with the same peaks>=2 / spiky-not-flat bar (a handful of iconic
 * single-spike events, like lk-99 or the React BSD+Patents license fight, were
 * kept on the strength of one famous datable moment). Polluted candidates were
 * dropped: "threads" (programming threads, not Meta Threads), "pip" (the Python
 * packager, not the HR plan), "p(doom)" (tokenizes to Doom the game), "hims"
 * ("him" pronoun), "iter" (iterators, not the fusion reactor), "fork" (flat).
 *
 * CACHE NOTE: bump CATALOG_VERSION whenever the terms below change, so the
 * cached Redis key is recomputed instead of serving a stale/short set.
 */

export const CATALOG_VERSION = "v5";

export type ExampleGroup = {
  /** anchor id used by the table of contents (#people, #ai, …) */
  id: string;
  title: string;
  blurb: string;
  terms: string[];
};

export const EXAMPLE_GROUPS: ExampleGroup[] = [
  {
    id: "people",
    title: "People",
    blurb: "Founders, hackers and figures whose news moments spike the timeline.",
    terms: [
      "elon musk", "sam altman", "steve jobs", "paul graham", "john carmack",
      "richard stallman", "satoshi", "dhh", "geoffrey hinton", "julian assange",
      "elizabeth holmes", "edward snowden", "aaron swartz", "sbf",
    ],
  },
  {
    id: "ai",
    title: "AI & LLMs",
    blurb: "The launch-by-launch staircase of the generative-AI era.",
    terms: [
      "chatgpt", "gpt-4", "claude", "gemini", "agi", "copilot", "llama",
      "mistral", "deepseek", "grok", "cursor", "perplexity", "devin",
      "claude code", "mcp", "vibe coding", "generative ai", "prompt engineering",
      "stable diffusion", "midjourney", "dall-e", "sora",
    ],
  },
  {
    id: "hardware",
    title: "Products & hardware",
    blurb: "Launch-day spikes for the chips and gadgets HN couldn't stop debating.",
    terms: [
      "m1", "apple silicon", "vision pro", "macbook", "risc-v", "tsmc",
      "framework laptop", "steam deck", "stadia", "passkey",
    ],
  },
  {
    id: "devtools",
    title: "Languages & dev tools",
    blurb: "Languages, runtimes and editors rising on release-driven spikes.",
    terms: [
      "zig", "bun", "deno", "typescript", "tailwind", "neovim", "nixos", "nix",
      "julia", "gleam", "zed", "lsp", "kubernetes",
    ],
  },
  {
    id: "jsframeworks",
    title: "JS frameworks",
    blurb: "How JavaScript frameworks come and go: each era's darling, in order.",
    terms: [
      "jquery", "backbone", "ember", "meteor", "angularjs",
      "react", "vue", "svelte", "htmx", "astro",
    ],
  },
  {
    id: "startups",
    title: "Startups & companies",
    blurb: "Launches, acquisitions, license blow-ups and the occasional implosion.",
    terms: [
      "figma", "substack", "coinbase", "discord", "signal", "reddit",
      "theranos", "wework", "nvidia", "amd", "palantir",
      "hashicorp", "redis", "snowflake", "databricks",
    ],
  },
  {
    id: "cloud",
    title: "Cloud & hosting",
    blurb: "The platforms we deploy on: hyperscalers, PaaS darlings and indie hosts, each with its own outage-and-launch rhythm.",
    terms: [
      "aws", "google cloud", "azure", "cloudflare", "heroku", "vercel",
      "netlify", "fly.io", "digitalocean", "linode", "hetzner", "rackspace",
      "firebase", "supabase",
    ],
  },
  {
    id: "security",
    title: "Security incidents",
    blurb: "The sharp, datable spikes of the bugs and breaches that ruined a weekend.",
    terms: [
      "log4j", "xz", "heartbleed", "spectre", "solarwinds", "crowdstrike",
      "ransomware", "gdpr", "lastpass", "okta", "supply chain attack", "sopa",
      "equifax", "wannacry", "stuxnet", "net neutrality",
    ],
  },
  {
    id: "crypto",
    title: "Crypto & hype cycles",
    blurb: "Bull runs, blow-ups and the fads that came and went.",
    terms: [
      "bitcoin", "ethereum", "crypto", "web3", "metaverse", "gamestop", "ftx",
      "nft",
    ],
  },
  {
    id: "culture",
    title: "Internet & culture",
    blurb: "Platform exoduses, federated protocols and moderation flashpoints.",
    terms: [
      "mastodon", "bluesky", "fediverse", "activitypub", "content moderation",
      "piracy", "nostr", "x rebrand", "rss", "ad blocker", "dark patterns",
      "cookie banner", "digg", "clubhouse", "deplatforming", "shadowban",
      "right to be forgotten", "age verification",
    ],
  },
  {
    id: "devculture",
    title: "Dev culture",
    blurb: "The perennial HN arguments that resurface in waves, year after year.",
    terms: [
      "monorepo", "github actions", "tdd", "scrum", "whiteboard interview",
      "10x engineer", "npm", "leftpad", "linux gaming", "microservices",
      "serverless", "yaml", "technical debt", "agile", "waterfall",
      "pair programming", "code review", "semantic versioning", "conway's law",
      "rust rewrite",
    ],
  },
  {
    id: "zeitgeist",
    title: "Industry zeitgeist",
    blurb: "Common words that crest in waves with the mood of the tech industry.",
    terms: [
      "layoffs", "recession", "ai bubble", "h1b", "censorship", "antitrust",
      "right to repair", "return to office", "burnout", "leetcode", "tiktok",
      "section 230", "zirp", "founder mode", "quiet quitting",
      "the great resignation", "soft landing", "ai winter", "gig economy",
      "hustle culture", "four day week", "unionization",
    ],
  },
  {
    id: "science",
    title: "Science & frontier tech",
    blurb: "Lab breakthroughs and moonshots: the spikes that briefly made HN a physics forum.",
    terms: [
      "lk-99", "room temperature superconductor", "fusion energy",
      "james webb", "gravitational waves", "crispr", "quantum computing",
      "neuralink", "boston dynamics", "humanoid robot", "self-driving car",
    ],
  },
  {
    id: "licenses",
    title: "Open-source license wars",
    blurb: "Relicensings, rug-pulls and the forks they spawned: each one a datable tower of outrage.",
    terms: [
      "open core", "react license", "audacity", "elastic license", "sspl",
      "mongodb license", "terraform", "hashicorp license", "opentofu",
      "redis license", "valkey",
    ],
  },
  {
    id: "gaming",
    title: "Gaming",
    blurb: "Launch-day mania, GPU-scalping rage and the occasional licensing revolt.",
    terms: [
      "steam", "valve", "unity", "godot", "minecraft", "elden ring",
      "factorio", "gpu prices", "nintendo", "speedrun", "denuvo",
    ],
  },
  {
    id: "health",
    title: "Health & longevity",
    blurb: "The biohacking, GLP-1 and sleep-optimization waves HN can't stop relitigating.",
    terms: [
      "ozempic", "semaglutide", "glp-1", "longevity", "intermittent fasting",
      "creatine", "melatonin", "nicotine", "standing desk", "blue light",
      "vitamin d", "circadian rhythm",
    ],
  },
];

export type Comparison = {
  /** 2–4 related terms overlaid on one chart, ORDERED earliest-peak first so the
   *  color order (see COMPARE_COLORS in the gallery) reads left→right in time. */
  terms: string[];
  /** the story of how the lead changes hands */
  story: string;
};

// Curated by a probe-driven sweep for the "change places" shape: terms whose
// peaks are COMPARABLE in size (so no line goes flat on the shared y-axis) but
// OFFSET in time (so the lead visibly swaps). Each was verified to have
// min(peakMax)/max(peakMax) >= ~0.25 with offset peak months. Pairs where one
// term dwarfs the other (myspace/facebook, digg/reddit, subversion/git,
// bitcoin/ethereum, twitter/mastodon, jquery/react, hadoop/spark) were dropped:
// the small line just hugged the floor. Terms are ordered earliest-peak first,
// so the color order (COMPARE_COLORS) reads left→right in time.
//
// A later sweep added the THREE-way comparisons (chef/puppet/ansible,
// clojure/haskell/elixir, rest/grpc/graphql, sublime/atom/vscode,
// apache/nginx/caddy, backbone/ember/angular, glass/oculus/vision-pro,
// django/rails/laravel, grunt/gulp/webpack, tensorflow/pytorch/jax,
// heroku/netlify/vercel, dall-e/sd/midjourney, couchdb/cassandra/mongodb),
// applying the SAME >= ~0.25 floor across all three lines so none goes flat.
// Triples that failed it were rejected: internet-explorer/firefox/chrome (IE
// @0.06), iphone/android/blackberry (@0.15), flux/redux/mobx (@0.15),
// elasticsearch/solr/algolia (@0.13), bootstrap/sass/tailwind (@0.21).
//
// v3 sweep added more triples (selenium/cypress/playwright, xamarin/react-native/
// flutter, phonegap/cordova/capacitor, parcel/esbuild/rollup, prometheus/grafana/
// datadog, redshift/databricks/snowflake, llama/mistral/qwen, siri/google-assistant/
// alexa, litecoin/dogecoin/solana, ico/nft/defi), each verified for the >= ~0.25
// floor AND offset peak months (single tallest month per term must differ, so the
// lead actually swaps). Candidates rejected this round:
// evernote/notion/obsidian (peaks all cluster 2023, no historical handoff),
// whatsapp/telegram/signal (whatsapp & signal share the Jan-2021 exodus month +
// "signal" pollution), mongodb/dynamodb/firebase (all peak 2020-05), soap/rest-api/
// graphql ("soap" tallest month is 2020-03 COVID handwashing, not the protocol),
// jekyll/hugo/gatsby ("gatsby" tallest month is 2011-01 movie pollution + clustered),
// aws/azure/gcp (gcp @0.10, aws dwarfs), bash/zsh/fish (zsh @0.13 + "fish" pollution),
// objective-c/swift/kotlin (@0.18), go/rust/zig (@0.03), npm/yarn/pnpm (@0.07),
// hadoop/spark/flink (@0.08), windows-phone/blackberry/android (@0.14, android dwarfs).
//
// A few entries below were added by request rather than by the sweep and don't
// fully meet the bar: skype/zoom/microsoft-teams (Teams @0.13 hugs the floor next
// to Zoom's March-2020 tower) and cpu/ram/gpu (high-volume staples that wobble
// more than they spike). Kept on purpose because the matchup itself is the point.
export const COMPARISONS: Comparison[] = [
  {
    terms: ["vercel", "cloudflare"],
    story:
      "The deploy-platform rivalry: Cloudflare carries the CDN/edge conversation for years, then Vercel surges on the Next.js wave and the two trade blows as both push into edge functions and full-stack hosting.",
  },
  {
    terms: ["openai", "anthropic"],
    story:
      "David vs Goliath of the lab era: OpenAI's repeated towers lead from 2023, until a sudden 2026 Anthropic surge pulls level and the lead changes hands.",
  },
  {
    terms: ["amd", "nvidia"],
    story:
      "The silicon baton pass: AMD leads 2017–20 on the Ryzen/Zen comeback, then Nvidia overtakes with the 2020–23 GPU-and-AI surge.",
  },
  {
    terms: ["scala", "swift", "kotlin"],
    story:
      "A three-way relay across the JVM/mobile era: Scala is the hot language ~2011, Swift grabs the baton with iOS mid-decade, then Kotlin overtakes both as Android goes Kotlin-first.",
  },
  {
    terms: ["angular", "vue", "svelte"],
    story:
      "Frontend's generations in a line: Angular leads the framework wars ~2013–14, Vue rises 2016–19, then Svelte takes the newcomer crown 2020–22.",
  },
  {
    terms: ["mysql", "postgres"],
    story:
      "The database lead-swap: MySQL owns the conversation around 2009–11, then goes quiet as Postgres climbs to overtake it by 2017–20.",
  },
  {
    terms: ["tensorflow", "pytorch", "jax"],
    story:
      "ML frameworks, generation by generation: TensorFlow launches the deep-learning gold rush 2015–16, PyTorch overtakes research 2019–21, then JAX becomes the cutting-edge favorite 2021–23.",
  },
  {
    terms: ["webpack", "vite"],
    story:
      "Bundler changing of the guard: Webpack owns the build step 2015–20, then Vite arrives and overtakes it from 2022 on.",
  },
  {
    terms: ["coinbase", "binance"],
    story:
      "Crypto-exchange lead-swap: Coinbase is the exchange people talk about through 2013–21, then Binance takes over the headlines in 2022–23.",
  },
  {
    terms: ["vim", "emacs", "zed"],
    story:
      "The editor wars, old guard vs new: Vim and Emacs trade the modal-vs-extensible argument year after year, then Zed bursts in and spikes hard across 2024–26.",
  },
  {
    terms: ["mastodon", "bluesky"],
    story:
      "The Twitter-alternative relay: Mastodon spikes with the 2022 acquisition exodus, then Bluesky overtakes it as the destination in 2024–25.",
  },
  {
    terms: ["deno", "bun"],
    story:
      "Node-alternative race: Deno is the buzzy replacement 2020–22, then Bun grabs the spotlight from 2023 onward.",
  },
  {
    terms: ["flash", "html5"],
    story:
      "A textbook changing of the guard: Flash burns hot across 2010–11, then HTML5 climbs past it into 2014–15, the open web eating the plugin alive.",
  },
  {
    terms: ["docker", "kubernetes"],
    story:
      "Containerization handoff: Docker erupts 2014–15 as the new hotness, then Kubernetes inherits the spotlight from 2016 as orchestration becomes the story.",
  },
  {
    terms: ["vim", "neovim"],
    story:
      "Succession within a dynasty: vim leads through the 2010s, then its own fork neovim ignites 2021–23 and takes the lead as the community migrates.",
  },
  {
    terms: ["chatgpt", "deepseek"],
    story:
      "Two AI shockwaves, offset: ChatGPT's late-2022 launch wall, then DeepSeek's lone Jan-2025 tower, the “Sputnik moment” years later.",
  },
  {
    terms: ["coffeescript", "typescript"],
    story:
      "JS-superset succession: CoffeeScript's 2011–14 hype cools, then TypeScript's 2019+ rise shows which abstraction actually won.",
  },
  {
    terms: ["dall-e", "stable diffusion", "midjourney"],
    story:
      "The 2022 text-to-image explosion, month by month: DALL-E 2 opens the era in spring, Stable Diffusion's open-source release detonates in late summer, then Midjourney becomes the household name into 2023.",
  },
  {
    terms: ["x86", "arm"],
    story:
      "A CPU-architecture shift: x86 dominates chip talk around 2020–23, then ARM surges with Apple Silicon and data-center ARM into 2024–26.",
  },
  {
    terms: ["sublime", "atom", "vscode"],
    story:
      "The text-editor crown, passed hand to hand: Sublime Text is the beloved editor of 2012–14, GitHub's Atom takes over 2014–15, then VS Code eats the world from 2018 on.",
  },
  {
    terms: ["skype", "zoom", "microsoft teams"],
    story:
      "Video calling, dynasty to dynasty: Skype owns the 2010s, then Zoom spikes hard in the single March-2020 lockdown month while Microsoft Teams rides the same remote-work wave on Office's coattails.",
  },
  {
    terms: ["jenkins", "github actions"],
    story:
      "CI changing of the guard: Jenkins is the CI tool of the mid-2010s, then GitHub Actions takes over from 2021 on.",
  },
  {
    terms: ["cursor", "claude code", "codex"],
    story:
      "The AI-coding-tool relay: Cursor is the editor everyone talks about in late-2024, Claude Code spikes hard across mid-2025, then OpenAI's Codex takes its turn into early-2026.",
  },
  {
    terms: ["chef", "puppet", "ansible"],
    story:
      "The config-management wars: Chef leads the automate-your-servers era ~2011–12, Puppet trades blows through 2013, then Ansible's agentless approach pulls ahead 2014–15.",
  },
  {
    terms: ["clojure", "haskell", "elixir"],
    story:
      "The functional language HN couldn't stop talking about: Clojure's Lisp-on-the-JVM moment ~2009–11, Haskell's purity debates ~2012, then Elixir rides the Erlang revival 2016–18.",
  },
  {
    terms: ["rest api", "grpc", "graphql"],
    story:
      "API design, era by era: REST becomes the web's default 2012–15, then the post-REST generation splits: gRPC for service-to-service from 2016, GraphQL for the client from 2017.",
  },
  {
    terms: ["apache", "nginx", "caddy"],
    story:
      "Web servers across the decades: Apache rules the 2010–12 conversation, nginx overtakes it for the high-traffic era 2011–13, then Caddy arrives with automatic-HTTPS 2017–22.",
  },
  {
    terms: ["backbone", "ember", "angular"],
    story:
      "The front-end MVC wars: Backbone.js is the first to give the browser structure ~2011, then Ember and Angular escalate to full frameworks 2013–14, the fight that set up React.",
  },
  {
    terms: ["google glass", "oculus", "vision pro"],
    story:
      "A decade of face-computer hype, one tower each: Google Glass in 2013, Oculus with the Facebook deal in 2014, then Apple's Vision Pro in 2024: three spikes, ten years apart.",
  },
  {
    terms: ["django", "ruby on rails", "laravel"],
    story:
      "The full-stack web framework baton: Django and Rails define the 2009–15 'MVC framework' era, trading the spotlight, then Laravel inherits it for the PHP world and surges 2019–21.",
  },
  {
    terms: ["grunt", "gulp", "webpack"],
    story:
      "The JS build pipeline, three generations: Grunt's task-runner era 2013–14, Gulp's streaming rewrite 2014–15, then Webpack absorbs the whole job as bundling becomes the story from 2016 on.",
  },
  {
    terms: ["heroku", "netlify", "vercel"],
    story:
      "The 'just deploy it' platform, reinvented each era: Heroku defines push-to-deploy in the early 2010s (and spikes again at its 2022 free-tier sunset), Netlify owns the JAMstack 2018–20, then Vercel takes the Next.js era from 2023.",
  },
  {
    terms: ["couchdb", "cassandra", "mongodb"],
    story:
      "The NoSQL boom in order: CouchDB rides the early document-store wave ~2009, Cassandra carries the scale-out story 2010–12, then MongoDB becomes the era's default 2011–13.",
  },
  {
    terms: ["selenium", "cypress", "playwright"],
    story:
      "Browser test automation, three generations: Selenium is the way to drive a browser through the 2010s, Cypress reinvents it for the modern front-end ~2020, then Playwright pulls ahead and surges into 2025–26.",
  },
  {
    terms: ["xamarin", "react native", "flutter"],
    story:
      "Cross-platform mobile, baton by baton: Xamarin carries the write-once dream ~2016, React Native takes over for the JS crowd 2017–18, then Flutter overtakes both and peaks into 2024.",
  },
  {
    terms: ["phonegap", "cordova", "capacitor"],
    story:
      "The hybrid-app lineage, renamed each era: PhoneGap wraps web apps in a native shell ~2011, its open-source successor Cordova carries it 2014–15, then Capacitor inherits the job and spikes in 2024.",
  },
  {
    terms: ["parcel", "esbuild", "rollup"],
    story:
      "The post-Webpack bundler scramble: Parcel's zero-config pitch lands ~2019, esbuild's Go-speed rewrite grabs attention 2021, then Rollup re-enters as the library bundler of choice into 2022.",
  },
  {
    terms: ["prometheus", "grafana", "datadog"],
    story:
      "The observability stack, layer by layer: Prometheus owns metrics collection ~2020, Grafana takes the dashboards spotlight 2021, then Datadog rises as the all-in-one SaaS into 2023.",
  },
  {
    terms: ["redshift", "databricks", "snowflake"],
    story:
      "The cloud data-platform relay: Redshift defines the cloud warehouse ~2017, Databricks rides the lakehouse pitch into 2021, then Snowflake becomes the era's default name by 2024.",
  },
  {
    terms: ["llama", "mistral", "qwen"],
    story:
      "Open-weight LLMs, release by release: Llama opens the floodgates in early 2023, Mistral's European challenger surges late 2023, then Qwen carries the open-model crown into 2026.",
  },
  {
    terms: ["siri", "google assistant", "alexa"],
    story:
      "Voice assistants across the decade: Siri arrives first with the iPhone 4S in 2011, Google Assistant takes a turn ~2018, then Alexa peaks into 2022: three spikes, years apart.",
  },
  {
    terms: ["litecoin", "dogecoin", "solana"],
    story:
      "Altcoin generations: Litecoin is bitcoin's silver in the 2013 boom, Dogecoin spikes as the joke-coin of that same era, then Solana carries the next-gen-chain story into 2022.",
  },
  {
    terms: ["ico", "nft", "defi"],
    story:
      "Crypto's serial manias: the ICO token-sale frenzy peaks in 2017, the NFT gold rush detonates in 2021, then DeFi carries the yield-farming hype into 2022.",
  },
  {
    terms: ["unreal", "unity", "godot"],
    story:
      "Three game engines, one shared earthquake: all three spike together in the Sept-2023 Unity runtime-fee fiasco - Unity's self-inflicted blow-up, with Unreal and Godot surging the same month as developers threatened to jump ship.",
  },
  {
    terms: ["cpu", "gpu", "ram"],
    story:
      "The eternal hardware trio: CPU and RAM are the staples HN has argued about since 2007, while GPU climbs out of the pack through the crypto-mining and deep-learning booms.",
  },
];

/** Every distinct term we need a histogram for: all group terms + every term in
 *  each comparison, deduped. Drives the one-shot cache build. */
export function allExampleTerms(): string[] {
  const set = new Set<string>();
  for (const g of EXAMPLE_GROUPS) for (const t of g.terms) set.add(t);
  for (const c of COMPARISONS) for (const t of c.terms) set.add(t);
  return [...set];
}
