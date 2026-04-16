# qsearch — Go-to-Market One-Pager

*v0.1 launch · 2026-04-15 → HN Show post · 2026-04-19*

---

## Who we're talking to

**Primary: QVAC/WDK developers** — builders already using `@qvac/sdk` or `wdk-node`. They've accepted the local-first contract. The moment they add web search, they face the half-sovereign problem. qsearch is the only drop-in that doesn't break their architecture.

**Secondary: local-AI hobbyists + privacy engineers** — building offline agents, air-gapped tools, edge inference apps. Not necessarily QVAC users yet, but the architecture argument lands. They're active on HN and OSS Discord communities.

**Not targeting (v0.1):** product teams building SaaS apps. They want hosted, zero-ops, better snippet quality. Exa/Tavily serve them better and we should say so.

---

## Positioning (one line)

> **"The only search API where the cleaning step runs on your hardware."**

Everything else (Exa, Tavily, Sonar) cleans server-side. qsearch cleans locally via `@qvac/sdk`. This is the wedge. Not better snippets — better architecture for the local-AI stack.

**Proof point that fits in one tweet:**
- `curl localhost:8080/search` → `cleaned_markdown` generated on your CPU, not theirs
- `clean_ms: 1420` is your inference. `brave_ms: 819` is the only outbound hop.

---

## Acquisition — Day 6 launch plan

### Channel 1: Hacker News — Show HN post

**Title:** `Show HN: qsearch – search API where cleaning runs on your local LLM`

**Body structure (≤300 words):**
1. Problem: QVAC/WDK agents are edge-first, but web search forces a cloud call
2. Solution: Brave for fetch (BYOK, your quota), `@qvac/sdk` for cleaning (364MB Qwen3, your CPU)
3. Architecture proof: `brave_ms` = their latency, `clean_ms` = yours
4. Honest trade-offs: snippet quality < cloud LLMs, cold start, Brave-only in v0.1
5. Link: github.com/theYahia/qsearch + link to BLOG.md for the full writeup

**Target landing:** >30 points, HN front page for the QVAC/local-AI thread. Apache-2.0 + working code + honest trade-offs = HN-friendly framing.

**Submit time:** Sunday 2026-04-19, ~16:00–18:00 UTC (peak US afternoon, HN algo window). Two days before pitch day — Tether team sees live points by Monday morning, not the same day as the conversation.

### Channel 2: X thread — Day 6 recap

From [@TheTieTieTies](https://x.com/TheTieTieTies), anchored to the WDK-reposted thread.

**Structure:**
- Day 6/7: shipped
- One-line why it matters
- Link to HN post (drives HN votes)
- Tag `@WDK_tether` — earned with a real milestone

### Channel 3: QVAC GitHub / issues

Post as a comment in a relevant QVAC issue (e.g. "web search / agent examples"). Not spam — a pointer: "built a primitive that closes the open-web hop, here's the architecture". Keep it factual, no self-promotion language.

### Channel 4: QVAC/WDK Discord (if accessible)

`#projects` or `#show-and-tell` channel. Same framing as HN body, shorter.

---

## Launch KPIs (Day 6–7)

| Metric | Target | Source |
|--------|--------|--------|
| HN points | ≥30 | HN submission |
| GitHub stars by Apr 21 | ≥20 | GitHub repo |
| GitHub clones (unique) | ≥15 | GitHub Insights |
| X thread impressions | ≥2 000 | Twitter Analytics |
| WDK_tether like/repost | 1 | Twitter |

These aren't vanity metrics — they're evidence the build actually reached the target community. All referenced in the PRD (user engagement KPI category).

---

## v0.2 hook (for launch message)

> Star to get notified: PII redaction + configurable model (`QWEN3_1_7B` for better quality, `LLAMA_3_2_1B` as drop-in) + SearXNG self-hosted provider — coming v0.2.

This gives the reader a reason to star now, not later.

---

## What we're NOT doing for v0.1 launch

- **No Product Hunt** — audience overlap is worse, SaaS bias, no QVAC community there
- **No cold DMs** to QVAC team — the WDK repost is the intro; the HN post is the follow-up
- **No "privacy-first" framing** — pivoted 2026-04-14; Exa/Sonar both claim ZDR, the claim is noise
- **No blog cross-post to Medium/Substack** — BLOG.md in the repo is the artifact; cross-posting later if traction warrants

---

*Lead time: HN submit Day 6 (Apr 19) → pitch day (Apr 21). Two days for organic points + Tether team to see it.*
