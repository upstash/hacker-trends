/**
 * Precomputed, per-term editorial analysis - two short paragraphs of real,
 * non-templated prose about what the mention curve actually shows (the spikes,
 * the story behind the peak, the trajectory).
 *
 * This is the content that turns a top /trends page from a templated
 * data-swap into something with genuinely unique value - the single biggest
 * defense against being lumped in with "scaled content" by search engines, and
 * the prose an LLM answer is most likely to quote. It's authored ahead of time
 * from each term's real histogram + top stories (dump the data with
 * `scripts/dump-tier1.ts`) for the highest-value Tier-1 terms only; everything
 * else falls back to the deterministic `trendSummary` one-liner.
 *
 * Keyed by `termToSlug(term)`.
 */

export type TrendAnalysis = {
  /** 1–2 short paragraphs. Rendered as separate <p> blocks. */
  paragraphs: string[];
};

export const TREND_ANALYSIS: Record<string, TrendAnalysis> = {
  "gpt-4": {
    paragraphs: [
      "Mentions of gpt-4 first appear on Hacker News back in 2009, but the term only became common with OpenAI’s model releases. The curve peaks in March 2023 with 6,511 mentions, coinciding with the launch of GPT-4, and the lifetime total stands at 76,775 mentions.",
      "The discussion tracks each subsequent model: top threads include GPT-4o, GPT-4.5, and later GPT-5 releases, alongside open-weights announcements. Interest remained active through 2026, though the conversation increasingly shifted toward newer GPT-5-series models rather than GPT-4 itself.",
    ],
  },
  chatgpt: {
    paragraphs: [
      "ChatGPT first showed up on Hacker News in 2022, the year of its launch, and mentions climbed sharply. The curve peaks in March 2023 with 7,776 mentions, during the early wave of public adoption, and the lifetime total reaches 109,979 mentions - among the highest in this set.",
      "Discussion spans product features (ChatGPT Search, Canvas) and controversies, including a court order over retaining deleted chat logs and threads on the model confidently inventing features that don’t exist. Activity stayed high through 2026, making it one of the most persistently discussed terms on the site.",
    ],
  },
  deepseek: {
    paragraphs: [
      "DeepSeek first appears in 2023 but was a minor presence until early 2025. The curve spikes hard in January 2025 with 3,512 mentions, coinciding with the release of DeepSeek-R1, and the lifetime total is 10,115 mentions - most of it concentrated in that single surge.",
      "The conversation centered on R1’s reasoning approach and its open release, with threads on the reinforcement-learning paper, code performance, and competitive friction with OpenAI. Later 2025 releases like DeepSeek OCR and v3.2 kept the term active through 2026.",
    ],
  },
  "apple-silicon": {
    paragraphs: [
      "The phrase apple silicon registers as early as 2007, but only became a real topic with Apple’s Mac transition. Mentions peak in November 2020 with 851, when the M1 chip shipped, and benchmark threads showing the M1 MacBook Air outperforming higher-end Intel Macs dominated. The lifetime total is 14,102 mentions.",
      "Early discussion mixed performance astonishment with porting problems - Docker failing to launch, Firefox being ported, and the Asahi Linux effort to run Linux on the new hardware. The term stayed active through 2026 as the platform matured.",
    ],
  },
  crowdstrike: {
    paragraphs: [
      "CrowdStrike was a low-volume term from 2012 onward until a single event dominated its history. Mentions peak in July 2024 with 2,543, driven by the global Windows bluescreen-and-boot-loop outage caused by a faulty CrowdStrike update, with the top thread alone scoring 4,489 points. The lifetime total is 4,171 mentions.",
      "Nearly all the top stories cluster around that outage: technical post-mortems of the CSAgent.sys crash, reports that quality control was lacking, and the company’s DMCA dispute with a parody site. After the incident, attention faded, leaving July 2024 as a clear isolated spike.",
    ],
  },
  "section-230": {
    paragraphs: [
      "Section 230 first appears on Hacker News in 2008 and recurs whenever platform-liability law is in the news. The curve peaks in January 2021 with 492 mentions, and the lifetime total is 4,622 mentions, spread across many smaller bursts rather than one dominant event.",
      "Discussion is largely explanatory and legal: threads correcting common misconceptions about the statute, proposed DOJ legislation, and arguments that repealing it would not achieve what advocates expect. The topic stayed active through 2026 as the legal shield kept being litigated and debated.",
    ],
  },
  "glp-1": {
    paragraphs: [
      "GLP-1 shows up as early as 2009 in a clinical context, but mention volume rose with the weight-loss drug wave. The curve peaks in July 2025 with 185 mentions, and the lifetime total is 2,365 mentions - a steady recent climb rather than a single spike.",
      "The conversation is broad and medical: threads on GLP-1 drugs as an economic disruptor, effects on life insurance, and emerging research links to substance-use disorders, colon-cancer survival, and migraine frequency. Interest remained active heading into 2026.",
    ],
  },
  "vision-pro": {
    paragraphs: [
      "The term vision pro registers from 2008 but only became a genuine topic with Apple’s headset. Mentions peak in January 2024 with 1,321, coinciding with the Apple Vision Pro launch, and the lifetime total is 6,494 mentions.",
      "Early reviews dominated the discussion - assessments calling it magic “until it’s not,” reflections from former Oculus staff on what Apple got right, and practical notes on traveling with the device and third-party apps like a YouTube client. After the 2024 launch wave, attention declined.",
    ],
  },
  nvidia: {
    paragraphs: [
      "Nvidia has been discussed on Hacker News since 2007 and accumulated 73,668 lifetime mentions, one of the larger totals here. The curve peaks in January 2025 with 1,391 mentions, against a backdrop of sustained interest tied to the company’s central role in the AI hardware boom.",
      "Top threads span the company’s open-source GPU kernel modules, the attempted Arm acquisition, its $5B Intel investment, and critical commentary like “Nvidia won, we all lost.” The term remained heavily active through 2026.",
    ],
  },
  "james-webb": {
    paragraphs: [
      "James Webb appears from 2007 as the telescope was developed, but mentions were sparse until deployment. The curve peaks in June 2022 with 141 mentions, when the first full-resolution images were released, and the lifetime total is 1,608 mentions.",
      "The top stories cluster tightly around late 2021 and 2022 milestones: the December launch, full deployment, the telescope reaching its destination a million miles out, and the first images exceeding expectations. Activity dropped sharply after that initial run of events.",
    ],
  },
  "elden-ring": {
    paragraphs: [
      "Elden Ring first appears in 2019 around its announcement, and mentions peak in February 2022 with 161, the month the game released. The lifetime total is a modest 1,045 mentions, concentrated almost entirely in that launch window.",
      "Discussion was design- and craft-focused for a games topic: pieces on how it ignored two decades of open-world convention, a technical “Behind the Pretty Frames” breakdown, and a note on its anti-piracy SEO tactics. Mentions faded quickly after early 2022.",
    ],
  },
  "elon-musk": {
    paragraphs: [
      "Elon Musk has been a Hacker News fixture since 2007, totaling 43,917 lifetime mentions. The curve peaks in October 2022 with 1,851 mentions, around his moves to take Twitter private, with the top thread covering his $43B unsolicited bid.",
      "Coverage is wide-ranging across his ventures: deleting SpaceX and Tesla Facebook pages, his 2024 lawsuit against Sam Altman and OpenAI, and earlier essays like “How to Build the Future.” The term stayed consistently active through 2026.",
    ],
  },
  "sam-altman": {
    paragraphs: [
      "Sam Altman appears from 2007, first in a Y Combinator context, and accumulated 9,663 lifetime mentions. The curve peaks in November 2023 with 889 mentions, coinciding with his brief ousting from OpenAI and rapid reinstatement.",
      "Top threads span that boardroom episode - including a former board member’s account - alongside his 2024 lawsuit from Elon Musk, critical commentary on taking him at his word, and earlier YC-era AMAs. Discussion remained active through 2026.",
    ],
  },
  claude: {
    paragraphs: [
      "Mentions matching claude go back to 2007, but volume is dominated by Anthropic’s model and tooling releases. The curve peaks in February 2026 with 9,935 mentions - its most recent and largest month - and the lifetime total is 76,349 mentions.",
      "Top threads track the product line: Claude 3.7 Sonnet with Claude Code, Claude 4, Sonnet 4.5, computer use, 1M-token context, and web search. The term was at its peak right at the end of the observed window in 2026, indicating still-rising attention.",
    ],
  },
  gemini: {
    paragraphs: [
      "The term gemini predates Google’s model (appearing from 2007), but recent volume reflects the AI product. The curve peaks in February 2026 with 2,699 mentions, and the lifetime total is 34,119 mentions.",
      "Top discussion clusters around Google’s releases - Gemini 1.5, 2.0, Gemini 3, and the Gemini CLI - including a widely upvoted Show HN imagining a future HN front page. Activity was still climbing at the end of the window in 2026.",
    ],
  },
  copilot: {
    paragraphs: [
      "The word copilot appears from 2007 in various senses, but the coding-assistant meaning took over in mid-2021. The curve peaks in July 2021 with 1,457 mentions, when GitHub Copilot launched, and the lifetime total is 30,262 mentions.",
      "Discussion quickly turned contentious: threads on Copilot regurgitating Quake code, framing it as open-source “code laundering,” and the fact that all public GitHub code was used in training. The topic stayed active through 2026 as AI coding tools proliferated.",
    ],
  },
  grok: {
    paragraphs: [
      "Mentions of grok span back to 2007, partly from unrelated programming usage, but recent volume reflects xAI’s assistant. The curve peaks in January 2026 with 838 mentions, and the lifetime total is 20,437 mentions.",
      "On-topic threads track the product line - the initial Grok release, Grok 4, and Grok Code Fast 1 - plus discussion of its behavior when queried about politically charged topics on X. The term remained active into 2026.",
    ],
  },
  bitcoin: {
    paragraphs: [
      "Bitcoin first appears on Hacker News in 2009, the year of its launch, and is the highest-volume term in this set at 193,938 lifetime mentions. The curve peaks in February 2021 with 6,979 mentions, during that year’s bull run, after more than a decade of recurring discussion.",
      "Top threads are eclectic: a from-scratch tour of Bitcoin in Python, large unexplained wallet transfers, recovering lost coins, and Stripe’s decision to end Bitcoin support. The term stayed active through 2026, well past its 2021 peak.",
    ],
  },
  web3: {
    paragraphs: [
      "Web3 appears from 2007 in older senses but spiked as a crypto buzzword. The curve peaks in December 2021 with 1,468 mentions, at the height of the hype cycle, and the lifetime total is 11,121 mentions.",
      "The discussion was overwhelmingly skeptical: Moxie Marlinspike’s widely read “My First Impressions of Web3,” plus threads arguing it is centralized, inefficient, and expensive peer-to-peer. After the 2022 crypto downturn, mention volume fell off.",
    ],
  },
  kubernetes: {
    paragraphs: [
      "Kubernetes first appears in 2014, around the project’s launch, and built up 56,637 lifetime mentions. The curve peaks in May 2020 with 829 mentions, part of a long plateau of infrastructure discussion rather than one dominant event.",
      "On-topic threads are pragmatic and often critical: why Coinbase keeps Kubernetes out of its stack, the “now you have eight problems” warning, Google’s cluster-management fee, and recurring questions about why it got so popular. Discussion remained active through 2026.",
    ],
  },
  tsmc: {
    paragraphs: [
      "TSMC appears from 2008 and accumulated 15,015 lifetime mentions as semiconductor supply chains drew attention. The curve peaks in November 2020 with 376 mentions, around the company’s plans to build advanced fabs in the U.S.",
      "Top threads track geographic expansion: Apple processors made in America by TSMC, new fabs in Japan and a possible German plant, and price hikes amid supply shortages. The term stayed active through 2026 as chip-manufacturing geopolitics persisted.",
    ],
  },
  nft: {
    paragraphs: [
      "NFTs first appear on Hacker News in 2011 but only became prominent during the 2021 boom. The curve peaks in December 2021 with 1,450 mentions, and the lifetime total is 14,577 mentions, heavily concentrated in that year.",
      "Discussion was largely critical or satirical: framing NFT projects as MLMs for tech elites, John Cleese “selling” the Brooklyn Bridge, Steam banning blockchain games, and a torrent collecting NFT images. After 2021 the topic declined sharply.",
    ],
  },
  layoffs: {
    paragraphs: [
      "Layoffs has been discussed since 2007 and totals 34,579 lifetime mentions, rising during downturns. The curve peaks in January 2023 with 2,471 mentions, during the wave of large tech layoffs that included Twitter and Coinbase.",
      "Recent top threads broadened the framing toward causes and aftermath: the Section 174 tax-code change blamed for fueling cuts, a personal account of how a layoff changed one’s view of work, and a developer who built a Steam hit after being laid off from Meta. The topic stayed active through 2026.",
    ],
  },
  recession: {
    paragraphs: [
      "Recession has appeared on Hacker News since 2007 and totals 29,151 lifetime mentions, rising with economic anxiety. The curve peaks in March 2020 with 807 mentions, at the onset of the pandemic-driven downturn.",
      "On-topic discussion includes a thread on the U.S. economy shrinking and signaling a recession, a canceled job interview blamed on a looming downturn, and commentary on how remote work and recession might reshape employment. The term remained active through 2026.",
    ],
  },
  tiktok: {
    paragraphs: [
      "TikTok first appears in 2010 and built up 48,230 lifetime mentions. The curve peaks in January 2025 with 3,445 mentions, coinciding with the app briefly going dark in the U.S. amid the divestiture deadline.",
      "Discussion long mixed privacy and geopolitics: iOS 14 revealing clipboard snooping, India’s ban of TikTok and other Chinese apps, an alleged illegal OBS fork, and its rise past Facebook in downloads. The term stayed heavily active through 2026.",
    ],
  },
  ozempic: {
    paragraphs: [
      "Ozempic first appears in 2020 and totals 2,397 lifetime mentions, climbing with the weight-loss drug wave. The curve peaks in September 2024 with 231 mentions.",
      "Discussion ranges from speculation about widespread use (“How long til we’re all on Ozempic?”) to reported anti-aging effects, Medicare price negotiations, and an FTC challenge to drug patents. The topic remained active heading into 2026.",
    ],
  },
  semaglutide: {
    paragraphs: [
      "Semaglutide - the compound behind Ozempic and Wegovy - first appears in 2020 and is a lower-volume term at 1,054 lifetime mentions. The curve peaks in October 2024 with 63 mentions, a modest spike in a steady upward trend.",
      "Discussion is clinical and practical: reduced alcohol addiction associations, an argument that the drug “changed the world,” patent-expiry timelines in several countries, and Ask HN threads on weight-loss experience. Interest persisted into 2026.",
    ],
  },
  openai: {
    paragraphs: [
      "OpenAI first appears in 2015, the year it was founded, and totals 91,677 lifetime mentions - one of the largest in this set. The curve peaks in November 2023 with 5,674 mentions, the month of Sam Altman’s brief ousting and reinstatement.",
      "Top threads span open-weights releases, the O3 ARC-AGI score, the Whisper speech-recognition release, the Scarlett Johansson “Sky” voice dispute, and Elon Musk’s lawsuit against the company. Discussion stayed heavily active through 2026.",
    ],
  },
  binance: {
    paragraphs: [
      "Binance first appears in 2017, around its founding, and totals 4,852 lifetime mentions. The curve peaks in October 2022 with 573 mentions, coinciding with its brief move to acquire FTX during that exchange’s collapse.",
      "Top threads track exchange turmoil and regulation: the FTX acquisition attempt, a temporary pause of Bitcoin withdrawals, a UK regulatory clampdown, and later a presidential pardon of its convicted founder. The term stayed active through 2026.",
    ],
  },
  coinbase: {
    paragraphs: [
      "Coinbase first appears in 2011 and totals 18,675 lifetime mentions. The curve peaks in November 2017 with 715 mentions, during that year’s crypto run-up.",
      "Discussion spans business and engineering: its DPO debut, an 18% layoff announcement, a warning that bankruptcy could wipe out user funds, reports of selling geolocation data to ICE, and an engineering post on why Kubernetes isn’t in its stack. The term remained active through 2026.",
    ],
  },
  amd: {
    paragraphs: [
      "AMD has been discussed on Hacker News since 2007 and totals 72,668 lifetime mentions. The curve peaks in November 2020 with 1,475 mentions, around the Zen 3 / Ryzen 5000 launch.",
      "Top threads cluster on CPUs and the GPU software stack: the Zen 3 announcement, efforts to run CUDA unmodified on AMD GPUs, the open-sourced ROCm-based CUDA implementation, and Linux driver work. The term stayed active through 2026.",
    ],
  },
  snowflake: {
    paragraphs: [
      "The word snowflake appears on Hacker News from 2007 across many unrelated topics, which complicates the curve. Mentions peak in May 2024 with 240, and the lifetime total is 10,716 - though only some of that is about the data-cloud company rather than literal snowflakes or other uses.",
      "Among the clearly on-topic threads are discussions of why Snowflake is so expensive and reporting on the Snowflake-linked customer-data extortions in 2024. Because much of the matching content is off-topic, the trend here is best read quantitatively; genuine company discussion continued through 2026.",
    ],
  },
  neuralink: {
    paragraphs: [
      "Neuralink first appears in 2017, around its public unveiling, and totals 2,576 lifetime mentions. The curve peaks in November 2022 with 171 mentions.",
      "Top threads track the company’s milestones: early live-stream and progress-update events, the goal of boosting the brain to keep up with AI, a patient controlling games by thinking, and the first participant describing how his life changed. The term remained active through 2026.",
    ],
  },
  "elizabeth-holmes": {
    paragraphs: [
      "Elizabeth Holmes first appears in 2013, as Theranos drew scrutiny, and totals 1,888 lifetime mentions. The curve peaks in October 2022 with 107 mentions, around her sentencing, after the January 2022 guilty verdict drove the highest-scoring thread.",
      "The discussion follows the legal arc: criminal charges against Holmes and Balwani, the guilty verdict, the 11-plus-year sentence, and reporting that she urged employees to hide lab equipment from inspectors. Mentions tapered after the case concluded.",
    ],
  },
  sbf: {
    paragraphs: [
      "SBF - Sam Bankman-Fried - first registers in 2010 but became prominent only with FTX’s collapse. The curve peaks sharply in October 2022 with 1,433 mentions, as the exchange imploded, and the lifetime total is 5,716 mentions.",
      "Top threads cover his arrest by Bahamian authorities, a secret “back door” to move billions off the books, his legal defense funding, and a since-deleted Sequoia profile calling him a future trillionaire. Discussion concentrated around the 2022–2023 collapse and trial.",
    ],
  },
  ethereum: {
    paragraphs: [
      "Ethereum first appears in 2014, around its launch, and totals 28,539 lifetime mentions. The curve peaks in June 2017 with 899 mentions, during that year’s ICO and crypto boom.",
      "A large share of top discussion concerns the move to proof-of-stake: threads on the Merge being done and projections that it would cut energy use by roughly 99.95%, alongside explainers and the Ethereum 2.0 launch. The term stayed active through 2026.",
    ],
  },
  crypto: {
    paragraphs: [
      "The term crypto spans both cryptography and cryptocurrency on Hacker News, appearing from 2007 and totaling 154,681 lifetime mentions - one of the highest here. The curve peaks in October 2022 with 5,006 mentions, during the FTX collapse and broader market turmoil.",
      "Reflecting the dual meaning, top threads cover cryptography topics - NSA-related stories, post-quantum work, and the CIA’s Crypto AG operation - alongside cryptocurrency disillusionment like “I wasted years of my life in crypto.” The term stayed active through 2026.",
    ],
  },
  metaverse: {
    paragraphs: [
      "The word metaverse appears from 2007 but surged after Facebook’s rebrand to Meta. The curve peaks in October 2021 with 1,048 mentions, and the lifetime total is 10,201 mentions, heavily concentrated in that period.",
      "Discussion was overwhelmingly skeptical: “The metaverse is bullshit,” arguments that it already exists as Minecraft or simply the internet, comparisons to the Second Life boom, and a flagged YC-backed metaverse game. After 2021 the topic faded.",
    ],
  },
  gamestop: {
    paragraphs: [
      "GameStop first appears in 2008 but was minor until the 2021 short squeeze. The curve spikes in January 2021 with 977 mentions, when Robinhood limited purchases of GameStop and related stocks, and the lifetime total is 3,500 mentions.",
      "Nearly all top threads come from that episode: Robinhood’s trading halt and the resulting class action, the r/wallstreetbets mania around u/DeepFuckingValue, and framing it as “Rage Against the Financial Machine.” Attention dropped sharply after early 2021.",
    ],
  },
  ftx: {
    paragraphs: [
      "FTX first appears in 2016, around the exchange’s founding, and totals 8,243 lifetime mentions. The curve spikes in October 2022 with 3,062 mentions - most of its lifetime volume - as the exchange collapsed.",
      "The top stories trace the implosion in sequence: Binance’s proposed acquisition and its withdrawal, FTX tapping customer accounts for risky bets, mysterious $600M+ outflows, the U.S. bankruptcy filing, and analysis of its balance sheet. Discussion concentrated almost entirely around late 2022.",
    ],
  },
};

export function analysisForSlug(slug: string): TrendAnalysis | undefined {
  return TREND_ANALYSIS[slug];
}
