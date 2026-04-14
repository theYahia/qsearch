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

## Day 2 — 2026-04-15 · Bare + Brave working

- `@qvac/sdk` installed on Windows (or WSL fallback documented)
- Bare-runtime HTTP server skeleton: `POST /search` echoing the query
- First real Brave API call returning raw results to stdout
- No LLM yet — the raw pipe works end-to-end

**Output:** screenshot of `curl localhost:8080/search` returning Brave JSON.

## Day 3 — 2026-04-16 · QVAC cleaning integrated

- `@qvac/sdk` loaded with a small quantized model (Llama 3.2 1B or Qwen 0.5B)
- Cleaning prompt template written (single prompt, no pluggable interface yet)
- Pipeline: Brave raw → QVAC local clean → structured JSON out
- One real query end-to-end, recorded

**Output:** demo clip (30s) of a query → cleaned markdown, running fully local.

## Day 4 — 2026-04-17 · v0.1 ships

- `npx` bootstrap path OR `bare` command documented
- README updated with real `curl` example (not the aspirational one)
- Tag `v0.1.0`
- Post release in the WDK thread

**Output:** "qsearch v0.1 is live — `git clone && npm run start`, works on your machine."

## Day 5 — 2026-04-18 · Write the blog post

- Technical write-up: *"Why cleaning needs to run on your hardware, not ours"*
- Covers: the open-web hop gap, the architectural difference vs Exa/Tavily/Sonar, the QVAC cleaning step line-by-line
- Drafted end-of-day, reviewed, not yet published

**Output:** draft blog post, pushed as `BLOG.md` or a Gist.

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
