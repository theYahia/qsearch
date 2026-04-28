# Launch thread — copy-paste ready

> 8-tweet thread for X. Calibrated to the 5 viral patterns from research:
> 1. "Open-source alternative to [paid incumbent]"
> 2. Specific number in title
> 3. Known surface (MCP) × novel angle (trust)
> 4. Apache 2.0 + research depth
> 5. Comments > points (controversy-but-defensible takes)
>
> Schedule for post-coffee tomorrow morning (US Pacific). Crosspost to LinkedIn.

---

## Tweet 1 (the hook)

> Stanford measured production RAG: agents hallucinate 17–33% of facts because they read 200-char snippets, not pages.
>
> I built qsearch — open-source search layer that gives AI agents *full content with multi-engine provenance*, locally.
>
> 🧵👇

[image: Pareto chart cost × accuracy × provenance, qsearch in upper-right vs Tavily/Exa/Brave]

---

## Tweet 2 (the problem)

> Every AI agent today does the same dance:
>
> Tavily / Exa / Serper API → 20 ranked snippets → agent invents the rest
>
> Three failures:
> 1. Snippets aren't enough
> 2. No "which engines agreed" signal
> 3. No memory across sessions

---

## Tweet 3 (the missing primitive)

> Existing search APIs hide the most valuable signal: which engines actually agreed on this URL?
>
> qsearch exposes `engines: [google, ddg, brave, qwant, startpage]` per result.
>
> URL found by 5/5 engines = real signal. URL found by Google only = SEO trash. Already shipped.

[image: terminal screenshot showing "Engines: google, duckduckgo, brave (count=3)" in qsearch sweep output]

---

## Tweet 4 (the architecture, simply)

> ```
> Agent → qsearch → Brave + SearXNG (Google, DDG, Brave, Qwant…)
>        ↓
> Local corpus (Meilisearch + Qdrant) accumulates per-URL trust
>        ↓
> trust = log(sweep_count+1) × engine_diversity × topic_diversity
>        ↓
> Re-ranked, full-content, provenance-tagged results back
> ```

---

## Tweet 5 (the data backing it)

> Why full content matters:
>
> Wikipedia QA: full-context beats snippet-RAG by +7.3pp (arxiv 2501.01880).
> Production RAG hallucinates 17-33% (Stanford 2024 — Lexis+ AI, Westlaw).
>
> Tavily/Exa/Serper return snippets. qsearch passes full pages. That's the difference.

---

## Tweet 6 (the honest limits)

> What I'm NOT promising:
>
> - "Decentralized validator network" — Bittensor stake concentration is academically refuted (Gini 0.98, arxiv 2507.02951). I won't ship that theater.
> - "RLHF self-learning" — doesn't scale (arxiv 2412.06000).
>
> Federation = research direction. Local mesh first. Honesty over hype.

---

## Tweet 7 (the differentiation)

> qsearch vs the field:
>
> ✅ Open source (Apache 2.0)
> ✅ BYOK (Brave key on your machine)
> ✅ Self-hosted (Docker compose, 5 minutes)
> ✅ MCP-ready (Claude Code, Workbench, OpenClaw)
> ✅ Multi-engine attribution (`engines[]` field)
> ✅ Persistent corpus
>
> No tokens. No vendor lock-in. No data exfiltration.

---

## Tweet 8 (the CTA)

> 5-minute setup:
>
> ```
> git clone github.com/theYahia/qsearch
> cp .env.example .env.local && set BRAVE_API_KEY
> docker compose up -d && npm install && npm start
> ```
>
> ⭐ Star: github.com/theYahia/qsearch
> 📖 Vision: github.com/theYahia/qsearch/blob/main/docs/VISION.md
> 🐦 Build log: @TheTieTieTies

---

## HN Show HN draft

**Title:** Show HN: qsearch – Open-source trust layer for AI agent search (engines[] attribution)

**Body:**

I've been frustrated by how every AI agent search API hides the most useful signal — *which underlying engines agreed on a result*. Tavily, Exa, Serper all return ranked lists with no provenance.

qsearch is a self-hosted search server that fixes this. It uses Brave Search API + SearXNG (which itself aggregates Google, DuckDuckGo, Brave, Qwant, Startpage, etc.) and exposes the per-result `engines[]` field downstream.

A URL found by 4 engines is dramatically more trustworthy than one found by Google alone. Existing search APIs throw this signal away. qsearch propagates it through the corpus (Meilisearch) so you can filter `engine_count >= 3` for high-trust subsets.

Stack: Node.js + Meilisearch + Qdrant + SearXNG (Docker) + optional Crawl4AI for full-content fetching. MCP-over-HTTP for Claude Code / Workbench / OpenClaw integration. Apache 2.0.

Stanford's 2024 production RAG audit measured 17-33% hallucination on Lexis+ AI and Westlaw — agents reading snippets pretend they read pages. qsearch fetches full content + provides multi-engine provenance so agents have the real grounding.

What's NOT promised: I'm explicitly not pitching "decentralized validator network" — Bittensor stake concentration is academically refuted (arxiv 2507.02951 — Gini 0.98 across 64 subnets). I'm not pitching RLHF self-learning either — it doesn't scale (arxiv 2412.06000). Federation is a research direction; local trust mesh ships today.

Vision doc explains the full architecture and roadmap, including what we explicitly reject and why. I'd love feedback on the trust formula and the validated-feedback design (Bidirectional RAG approach for v0.5).

Repo: https://github.com/theYahia/qsearch
Vision: https://github.com/theYahia/qsearch/blob/main/docs/VISION.md
Live demo: https://qsearch.pro

---

## LinkedIn variant

> Just shipped qsearch v0.3.1 — open-source trust layer for AI agent search.
>
> Stanford's 2024 audit measured production RAG systems hallucinating 17-33% of facts. AI agents read 200-char snippets and invent the rest.
>
> qsearch fixes this with three things existing search APIs hide:
>
> 1. `engines[]` field per URL (which engines agreed?)
> 2. Persistent local corpus (URLs accumulate trust across sweeps)
> 3. Full content fetching, not snippets
>
> All Apache 2.0, BYOK, self-hosted. MCP-ready for Claude Code today.
>
> What I'm NOT pitching: another "decentralized validator network." That's academically refuted (Bittensor stake concentration, Gini 0.98). Local trust mesh ships first; federation only if it can be done honestly.
>
> Repo: github.com/theYahia/qsearch
> Vision doc with research backing: github.com/theYahia/qsearch/blob/main/docs/VISION.md
>
> Star, fork, criticize — all welcome.
