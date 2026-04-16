# qsearch — 7-day build-in-public roadmap

**Commitment:** *["Planning to build a search API with QVAC SDK"](https://x.com/TheTieTieTies/status/2044039772981576181)*
(Posted from [@TheTieTieTies](https://x.com/TheTieTieTies), reposted by [@WDK_tether](https://x.com/WDK_tether) on 2026-04-14.)

**Pitch day:** 2026-04-21 (Tether hiring conversation).

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

**Output:** [`docs/day2-demo.json`](./docs/day2-demo.json) — live Brave response captured from the running server. First hit on `"qvac sdk release notes"`: *Show HN: QVAC SDK*. Commit: `40996e8`.

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

## Days 5.5 — 2026-04-16 through 2026-04-18 · Polish & prep

Buffer zone — code is shipped, launch is Saturday. Use for:

- [ ] Publish blog post on Dev.to / Medium
- [ ] Finalize HN Show post ([draft](./docs/HN_POST_DRAFT.md))
- [ ] Second upstream PR to `tetherto/*` (docs, examples, or issue repro)
- [ ] Tweet thread recap: "Days 1-5 shipped in 48h — here's the pipeline"
- [ ] Polish pitch note and outreach materials

---

## Day 6 — 2026-04-19 · Public launch

- HN Show post: *"qsearch — OSS search API where cleaning runs on your local LLM"*
- Blog post published
- Thread recap in the WDK-reposted thread: "Day 6 recap — here's what shipped"
- Second PR opportunity into a Tether repo (QVAC docs fix, WDK example, or issue repro)

**Output:** HN submission + thread recap + second upstream PR.

## Day 7 — 2026-04-20 · Portfolio + pitch prep

- Portfolio landing page / README top-level pointer collecting: repo, blog, thread, upstream PRs
- Pitch note drafted (why Tether, what qsearch proves, what a week of build-in-public looked like)
- Final thread recap: "Week 1 done. Here's everything."

**Output:** one link that collects everything, ready to drop into a DM/email.

## Day 8 — 2026-04-21 · Pitch day

- Tether conversation.

---

## Rules of the build

- **One post per day minimum**, all anchored to the original [WDK-reposted thread](https://x.com/TheTieTieTies).
- **Every post ties back to a concrete artifact**: a commit, a screenshot, a clip, a diff. No vibes posts.
- **Tag sparingly.** `@WDK_tether` / `@paoloardoino` only when there's a real milestone, not every post.
- **Screenshots > prose.** Terminal output, diffs, clips — they carry further than explanation.
- **No venting, no meta.** The thread is a build log, not a diary.
- **Scope discipline.** If something isn't on this roadmap, it goes to `v2-ideas.md` and ships after Apr 21.
