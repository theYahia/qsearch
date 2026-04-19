# qsearch — 7-day build-in-public roadmap

**Commitment:** *["Planning to build a search API with QVAC SDK"](https://x.com/TheTieTieTies/status/2044039772981576181)*
(Posted from [@TheTieTieTies](https://x.com/TheTieTieTies), reposted by [@WDK_tether](https://x.com/WDK_tether) on 2026-04-14.)

**Target:** 2026-04-21 — week 1 complete.

This roadmap is the public accountability contract. Every day ships one visible artifact. Every day the thread updates.

---

## Day 1 — 2026-04-14 (today) · Thesis locked

- [x] Public repo: `theYahia/qsearch`
- [x] README.md — thesis, three differentiators, MVP API shape
- [x] ROADMAP.md — this file
- [x] LICENSE — Apache-2.0
- [x] Follow-up tweet in the WDK-reposted thread linking this repo
- [x] QVAC issue #1508 technical reproduction comment (stretch ✅)

**Output to the world:** "Repo is live. Here's the thesis. Code ships this week."

## Day 2 — 2026-04-15 · Bare + Brave working ✅

- [x] HTTP server skeleton: `POST /search` returning raw Brave JSON (Node runtime; Bare port lands Day 3 with `@qvac/sdk`)
- [x] First real Brave API call wired through the server, end-to-end
- [x] Raw pipe works — `curl localhost:8080/search` returns live Brave results
- [ ] `@qvac/sdk` install on Windows — **deferred to Day 3**, lands together with the cleaning layer

**Output:** live Brave response from the running server. First hit on `"qvac sdk release notes"`: *Show HN: QVAC SDK*. Commit: `40996e8`.

## Day 3 — 2026-04-15 · QVAC cleaning integrated ✅ (shipped early)

- [x] `@qvac/sdk` 0.8.3 installed — bare worker bundled, no system install needed
- [x] Model: `QWEN3_600M_INST_Q4` (Qwen3-0.6B Q4, ~364MB, cached to `~/.qvac/models/`)
- [x] Cleaning prompt template — single system prompt, plain prose output, `/no_think`
- [x] Pipeline: Brave raw → sequential QVAC local inference → `cleaned_markdown` per result
- [x] Graceful degradation: QVAC failure returns raw Brave snippet, server stays up
- [x] End-to-end live: `brave_ms` ~800ms + `clean_ms` ~1.1s per result on laptop CPU

**Output:** live JSON with `cleaned_markdown` — full pipeline on local machine. Shipped Day 2 night (ahead of schedule).

## Day 4 — 2026-04-15 · v0.1 ships ✅ (shipped early, same day as Day 3)

- [x] README updated with real `curl` output (live `cleaned_markdown`, real latency numbers)
- [x] Tag `v0.1.0` — pushed to GitHub, visible in Releases
- [x] `npm install && npm start` bootstrap documented — bare worker bundled, no system install
- [x] `git clone && npm install && npm start` works on Windows 11 x64, tested

**Output:** `v0.1.0` tag live on GitHub. Full pipeline: Brave fetch → Qwen3-0.6B local cleaning → structured JSON.

## Day 5 — 2026-04-15 · Write the blog post ✅ (shipped early)

- [x] Technical write-up: *"Why cleaning needs to run on your hardware, not ours"*
- [x] Covers: half-sovereign problem, three-step pipeline, vs Exa/Tavily, cleaning step line-by-line, honest trade-offs
- [x] Code snippets from actual `src/server.js` — no aspirational examples

**Output:** [`BLOG.md`](./BLOG.md) — shipped as part of the repo.

## Days 5.5 — 2026-04-16 · v0.2 shipped

- [x] `POST /news` — Brave News API, up to 50 results, source attribution
- [x] `POST /context` — Brave LLM Context API, 2-28 snippets per result (deep page extraction)
- [x] `GET /health` — status endpoint
- [x] MCP tool wrapper (`src/mcp.js`) — 3 tools: web_search, news_search, context_search
- [x] `freshness` parameter — filter by day/week/month/year/date range
- [x] `search_lang` + `country` — multilingual search support
- [x] `extra_snippets` enabled by default — 5x more content for cleaning
- [x] Cleaning prompt rewritten based on prompt engineering research (24 Brave queries)
- [x] Model retry on failure (server no longer bricks permanently)
- [x] `n_results` max raised from 10 to 20

**Output:** v0.2.2 — 4 endpoints, MCP tool, all working.

---

## Days 5.5b — 2026-04-17 through 2026-04-18 · Launch prep

- [x] Push v0.2.2 to GitHub
- [x] VISION_V4 document — full strategic framing with 4-phase roadmap
- [ ] Publish blog post on Dev.to / Medium
- [ ] Finalize HN Show post ([draft](./docs/HN_POST_DRAFT.md))
- [ ] Second upstream PR to `tetherto/*` (docs, examples, or issue repro)
- [ ] Tweet thread recap
- [x] Polish documentation and demos

---

## Day 6 — 2026-04-19 · Live at qsearch.pro ✅

- [x] **Production deploy** — VPS with Nginx reverse proxy + Cloudflare HTTPS
- [x] **Custom domain** — [qsearch.pro](https://qsearch.pro) live with Full Strict SSL
- [x] **QVAC on production** — `@qvac/sdk` running on VPS, model loaded, `cleaned_markdown` generated in ~25s on CPU
- [x] **Frontend** — human search UI + agent onboarding card, mobile-responsive, OG/Twitter meta tags
- [x] **46 automated tests** passing (server + frontend coverage)
- [x] Graceful loading UX — staged progress text with timer for slow LLM inference
- [x] Day 6 tweet in build thread

**Output:** qsearch.pro live — first public-facing QVAC-powered search with working UI.

## Day 7 — 2026-04-20 · Week 1 wrap-up

- Portfolio landing page / README top-level pointer collecting: repo, blog, thread, upstream PRs
- Final thread recap: "Week 1 done. Here's everything."

**Output:** one link that collects everything.

---

## Rules of the build

- **One post per day minimum**, all anchored to the original [WDK-reposted thread](https://x.com/TheTieTieTies).
- **Every post ties back to a concrete artifact**: a commit, a screenshot, a clip, a diff. No vibes posts.
- **Tag sparingly.** `@WDK_tether` / `@paoloardoino` only when there's a real milestone, not every post.
- **Screenshots > prose.** Terminal output, diffs, clips — they carry further than explanation.
- **No venting, no meta.** The thread is a build log, not a diary.
- **Scope discipline.** If something isn't on this roadmap, it goes to `v2-ideas.md` and ships after Apr 21.

---

## What's next

### v0.3 — Own corpus

*Planned — scope and timeline may evolve.*

Curated, crawled knowledge base starting with core crypto/DeFi protocols (Tether, USDT, WDK, QVAC, Holepunch, Keet, LayerZero, and others) and expanding from there. Replaces Brave dependency for covered topics — queries hit a local index first (<10ms), Brave only for uncovered queries.

- **Index:** Tantivy (full-text) + Qdrant (vector)
- **Embeddings:** QVAC Qwen3-Embed-0.6B on-device
- **Crawl:** Scrapling, incremental, robots.txt honored
- **License:** Apache-2.0 end-to-end

### v0.4 — [WDK x402 USDT](https://x.com/WDK_tether) payments

Pay-per-query micropayments via WDK x402 facilitator. Agents pay 0.01 USDT per search — same HTTP 402 flow the ecosystem already uses, but USDT-native.

### v1.0 — [HyperDHT](https://x.com/paoloardoino/status/2041507715046887589) decentralized search

P2P sharing of qsearch's own crawled corpus via Hyperswarm. Brave results are never cached or shared. Federated multi-writer with trusted operators — progressive decentralization, not full P2P on day one.
