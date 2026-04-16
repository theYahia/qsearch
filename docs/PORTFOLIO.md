# qsearch — Portfolio Pointer

*One link that collects everything. For DM/email drop before or after pitch day.*

---

## The link

**`github.com/theYahia/qsearch`**

Everything lives in the repo. No separate landing page needed.

---

## What's in the repo (index for the reader)

| What | Where |
|------|-------|
| Working search API | root — `npm install && npm start` |
| How it works + why | [README.md](../README.md) |
| 7-day public roadmap | [ROADMAP.md](../ROADMAP.md) |
| Blog: "Why cleaning needs to run on your hardware" | [BLOG.md](../BLOG.md) |
| PRD (TPM-grade, Tether KPI language) | [docs/PRD.md](PRD.md) |
| Workbench integration doc | [docs/WORKBENCH_INTEGRATION.md](WORKBENCH_INTEGRATION.md) |
| Go-to-market plan | [docs/GTM.md](GTM.md) |
| HN Show post draft | [docs/HN_POST.md](HN_POST.md) |
| Pitch note (internal) | [docs/PITCH_NOTE.md](PITCH_NOTE.md) |

---

## One-paragraph summary (for email / DM body)

```
I spent 7 days building qsearch on QVAC SDK — a search API for
QVAC agents where the LLM cleaning step runs locally on your
hardware via @qvac/sdk, not through a cloud endpoint. Brave for
the fetch (BYOK), Qwen3-0.6B Q4 for cleaning (364MB, your CPU).
Apache-2.0, full pipeline: npm install && npm start.

The architecture argument: an agent running on QVAC with local
health data is half-sovereign the moment it calls Exa for search.
qsearch closes that gap — brave_ms is their latency, clean_ms is yours.

github.com/theYahia/qsearch
```

---

## Build-in-public thread

All daily updates: [@TheTieTieTies](https://x.com/TheTieTieTies)
Original commitment (reposted by @WDK_tether): https://x.com/TheTieTieTies/status/2044039772981576181

---

## Second upstream contribution (Day 6)

*To be filled after Day 6 PR/comment is posted.*

- QVAC issue #1508 technical reproduction comment — posted Day 1
- Day 6 upstream: [ link to second PR/comment ]

---

## v0.2 roadmap (what's next)

- `redact-pii-core@4.0.2` PII redaction before inference call
- Configurable model: `QWEN3_1_7B_INST_Q4` (1008MB, better quality) or `LLAMA_3_2_1B_INST_Q4_0` (737MB)
- SearXNG self-hosted provider — no API key, runs on your own index
- Parallel inference (after validating bare worker concurrency model)
