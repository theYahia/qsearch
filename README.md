# qsearch

> *"[Planning to build a search API with QVAC SDK.](https://x.com/TheTieTieTies/status/2044039772981576181)"*

This repo is the follow-through. **A search API built on the QVAC SDK**, where Brave results get cleaned by your own local QVAC LLM — never a cloud server — so agents running on Tether's edge stack can read the live web without breaking the *"data never leaves your hardware"* principle.

We call it **the open-web hop for QVAC agents**.

> 🚧 **Day 1 of a 7-day public build.** This README is the thesis; code ships this week.
> Daily log: [@TheTieTieTies](https://x.com/TheTieTieTies) · Roadmap: [ROADMAP.md](./ROADMAP.md) · Pitch day: **2026-04-21**

---

## Why qsearch exists

Tether just shipped an edge-first open-source stack:

- **QVAC SDK** (2026-04-09) — local LLM inference on phones, laptops, Raspberry Pi
- **WDK** (2026-04-13) — self-custodial wallet toolkit
- **QVAC Workbench** — local-document Q&A desktop app

What's missing: the **open-web hop**. An agent running on QVAC can answer from its own files, but the moment it needs to read the live web, it either (a) calls Exa/Tavily/Sonar — which means sending the query and seeing the cleaned result *through a cloud server* — or (b) parses raw HTML by hand.

qsearch is the primitive that fills that gap:

```
Brave API  →  raw results  →  QVAC local LLM (on your hardware)  →  clean JSON  →  agent
```

The LLM cleaning step — the part that reads the page, extracts the answer, decides what matters — **runs on the user's device**. It is architectural, not a privacy policy promise. You can verify it by reading the code.

## The three differentiators (locked)

|  | Exa | Tavily | Sonar | Brave API | SearXNG | **qsearch** |
|---|---|---|---|---|---|---|
| OSS core | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| LLM cleaning | ✅ (cloud) | ✅ (cloud) | ✅ (cloud) | ❌ | ❌ | ✅ (**local**) |
| Agent-first JSON | ≈ | ≈ | ≈ | ❌ | ❌ | ✅ |
| Self-hostable | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| QVAC-native | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| BYOK upstream | ❌ | ❌ | ❌ | N/A | ✅ | ✅ |

1. **Local cleaning via QVAC.** Raw Brave results enter the pipeline as HTML/snippets and get cleaned by a QVAC local LLM. No cloud ever sees the cleaning step.
2. **OSS auditable core.** Apache-2.0, every line readable, self-hostable. SearXNG has OSS but no LLM layer. Exa/Tavily/Sonar have LLM layers but are closed. qsearch is the first intersection.
3. **Agent-first primitive.** Composable like a Unix pipe (`fetch → clean → filter → output`), structured JSON by default, cheap enough to call 100× per agent task. Not a "search product with a UI" — a building block for builders.

## MVP API (shipping this week)

```bash
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -d '{"query": "latest QVAC SDK release notes", "n_results": 5}'
```

```json
{
  "results": [
    {
      "url": "https://...",
      "title": "...",
      "cleaned_markdown": "QVAC SDK 0.9.0 shipped on 2026-04-09...",
      "source_score": 0.87
    }
  ]
}
```

- **Runtime:** Node.js via Bare (required by `@qvac/sdk`)
- **Backend:** Brave Search API, BYOK (`BRAVE_API_KEY` env var)
- **LLM:** `@qvac/sdk` with a small quantized model (Llama 3.2 1B or Qwen 0.5B)
- **License:** Apache-2.0

## Honest trade-offs

- **Cold start.** Loading a local LLM takes seconds. qsearch is best run as a long-lived local daemon, not a cold-fired lambda.
- **Single provider (v1).** Brave only. Adding SearXNG / others is v2.
- **Self-host only.** No hosted tier. If you want zero-ops, Exa and Tavily exist and are good.
- **The wedge is architecture, not ranking.** qsearch won't out-rank Exa on snippet quality. It wins when *you* care that cleaning runs on your hardware, not theirs.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) — 7-day build, daily artifacts, pitch day 2026-04-21.

## License

Apache-2.0. See [LICENSE](./LICENSE).
