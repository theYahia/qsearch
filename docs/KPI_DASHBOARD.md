# qsearch — KPI Dashboard

*Tracking window: v0.1 launch (2026-04-15) → pitch day (2026-04-21)*

---

## Launch KPIs (Day 6–7)

| Metric | Target | Actual | Status | Source |
|--------|--------|--------|--------|--------|
| HN points | ≥30 | — | ⏳ | HN submission |
| HN comments | ≥5 | — | ⏳ | HN submission |
| GitHub stars by Apr 21 | ≥20 | — | ⏳ | github.com/theYahia/qsearch |
| GitHub forks | ≥3 | — | ⏳ | GitHub Insights |
| GitHub clones (unique) | ≥15 | — | ⏳ | GitHub Insights → Traffic |
| X thread impressions | ≥2 000 | — | ⏳ | Twitter Analytics |
| WDK_tether like/repost | 1 | — | ⏳ | Twitter |

---

## Build KPIs (Days 1–5, complete)

| Milestone | Target | Actual | Status |
|-----------|--------|--------|--------|
| Repo live + README | Day 1 (Apr 14) | 2026-04-14 | ✅ |
| Brave fetch end-to-end | Day 2 (Apr 15) | 2026-04-15 | ✅ |
| QVAC local cleaning working | Day 3 (Apr 15) | 2026-04-15 | ✅ (shipped early) |
| v0.1.0 tagged + install docs | Day 4 (Apr 15) | 2026-04-15 | ✅ (shipped early) |
| Blog post live in repo | Day 5 (Apr 15) | 2026-04-15 | ✅ (shipped early) |
| `npm install && npm start` works on Windows 11 | Day 3 | 2026-04-15 | ✅ |

---

## Performance KPIs (live pipeline, v0.1 measured)

| Metric | Target | Measured | Notes |
|--------|--------|----------|-------|
| Brave fetch latency | ≤1 500ms | ~819ms | Laptop, London → Brave CDN |
| Local clean per result | ≤3 000ms | ~1 200ms avg | Qwen3-0.6B Q4, laptop CPU |
| Total for 2 results | ≤10 000ms | ~3 500ms | Sequential: brave + 2× clean |
| Graceful degradation | on LLM error | ✅ | Returns raw snippet if QVAC fails |
| Cold start (warm cache) | — | a few seconds | 364MB gguf + bare worker init |

*Source: Day 3 terminal run captured in `docs/day2-demo.json` + BLOG.md Section 3.*

---

## Pipeline reliability (Day 3 run)

| Check | Result |
|-------|--------|
| Brave API returns results | ✅ |
| QVAC model loads from cache | ✅ (cached after first download) |
| `cleaned_markdown` populated | ✅ |
| `<think>` tags suppressed | ✅ (`/no_think` + regex) |
| Server survives QVAC error | ✅ (graceful degradation) |
| `.env.local` key override | ✅ (always overwrites shell env) |

---

## How to update after Day 6 launch

1. After HN post goes live — paste final points + comments into Launch KPIs table
2. After 24h — check GitHub Insights → Traffic → Clones (unique visitors)
3. After 48h (pitch day) — final snapshot for portfolio landing page

*All KPIs feed back to PRD.md Section 7 (Success Metrics).*
