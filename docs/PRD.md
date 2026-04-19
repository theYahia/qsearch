# qsearch — Product Requirements Document v1

> **Status:** v0.2.2 live at [qsearch.pro](https://qsearch.pro) (2026-04-19) — living document.

---

## 1. Problem

Tether's edge-first open-source stack (QVAC SDK, WDK) lets agents run fully on-device. But the moment an agent needs live web data, it has to call a cloud API — Exa, Tavily, Sonar — and the query + results pass through a server that isn't yours.

**The gap:** there is no open-source search primitive that keeps the entire pipeline — fetch, clean, structure — on the user's machine.

---

## 2. Goal

Ship `qsearch` as the open-web hop for QVAC agents: a local HTTP search server where Brave results are cleaned by a local LLM, never a cloud server. The architecture enforces the privacy guarantee; the code makes it auditable.

**OSS primitive first.** Optimise for: working code, fit to Tether's edge-first stack, build-in-public visibility.

---

## 3. Users

| Segment | Description | Primary need |
|---|---|---|
| QVAC app developers | Building agents with @qvac/sdk on laptop/phone | Web search that doesn't break the local-first contract |
| Privacy-conscious devs | Self-hosting AI stacks | Auditable pipeline, no cloud cleaning |
| Tether ecosystem contributors | Contributors to QVAC/WDK | Open primitive they can extend |

**Out of scope (v1):** end consumers, mobile apps, hosted SaaS.

---

## 4. Requirements

### Functional

| ID | Requirement | Priority |
|---|---|---|
| F1 | `POST /search { query, n_results }` → structured JSON | P0 |
| F2 | Brave Search API fetch (BYOK, Data-for-AI tier) | P0 |
| F3 | Local LLM cleaning via @qvac/sdk (Qwen3-0.6B Q4) | P0 |
| F4 | Response: `{ query, model, brave_ms, results[{url, title, cleaned_markdown, clean_ms}] }` | P0 |
| F5 | Graceful degradation — if QVAC fails, return raw Brave snippet | P1 |
| F6 | Model loads once at startup, warm on first request | P1 |
| F7 | `BRAVE_API_KEY` via `.env.local` (never committed) | P0 |

### Non-functional

| ID | Requirement | Target |
|---|---|---|
| NF1 | Single-result latency (model warm) | < 2s per result (brave ~800ms + clean ~1.1s) |
| NF2 | First-run model download | ~364MB one-time |
| NF3 | Runs on Node.js ≥20 | No system Bare install required |
| NF4 | License | Apache-2.0 |
| NF5 | Zero cloud cleaning — verifiable in source | Architecture guarantee |

---

## 5. API Shape (v0.1 target)

```bash
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -d '{"query": "qvac sdk release notes", "n_results": 3}'
```

```json
{
  "query": "qvac sdk release notes",
  "model": "QWEN3_600M_INST_Q4",
  "brave_ms": 740,
  "results": [
    {
      "url": "https://...",
      "title": "Show HN: QVAC SDK, a universal JavaScript SDK...",
      "description": "The project is fully open source...",
      "cleaned_markdown": "QVAC SDK is a universal JavaScript SDK for local AI...",
      "clean_ms": 1840
    }
  ]
}
```

---

## 6. KPIs

Grouped by product area:

### App engagement
- **Time-to-first-result (TTFR):** model warm, single result < 2s (brave ~800ms + clean ~1.1s)
- **Error rate:** < 5% (Brave 4xx / QVAC inference failure)
- **Requests/day:** tracked via server logs (Day 5 user research baseline)

### User satisfaction
- **GitHub stars:** build-in-public momentum signal
- **OSS health:** maintainer response time < 24h (issues/PRs)
- **Dev NPS:** informal survey Day 5 (N=10-15 QVAC/privacy devs)

### Privacy compliance
- **Zero-retention guarantee:** Brave Data-for-AI tier — no query storage upstream
- **BYOK enforced:** BRAVE_API_KEY never leaves local machine
- **No-training clause:** confirmed per Brave Data-for-AI tier documentation
- **PII redaction (v0.2):** `redact-pii-core@4.0.2` for query sanitization

### Performance efficiency
- **Brave latency:** median < 1s (measured in `brave_ms` field)
- **QVAC clean latency:** median < 3s per result on laptop CPU (Qwen3-0.6B Q4)
- **Model size:** 364MB Qwen3-0.6B Q4 — smallest viable instruction model in QVAC registry

---

## 7. Architecture

```
POST /search
    │
    ├─ 1. Brave Search API (BYOK, Data-for-AI tier)
    │        └─ raw results (title, url, description)
    │
    └─ 2. @qvac/sdk local inference (Qwen3-0.6B Q4)
             └─ cleaned_markdown per result
             └─ runs on user's CPU — no cloud
```

**Key architectural decision:** cleaning is sequential (one inference call at a time) to avoid concurrent model access issues. Parallel cleaning is a v0.2 optimisation.

---

## 8. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| QVAC Windows native addon fails | Medium | Graceful degradation returns raw Brave; tested Day 3 |
| Brave API key rate limits (free tier 1 rps) | High | BYOK + Data-for-AI tier (20 rps), user provides own key |
| Model quality too low (Qwen3-0.6B) | Medium | Upgrade path to LLAMA_3_2_1B (737MB) or QWEN3_1_7B (1008MB) via single constant swap |
| Cold start UX friction | Low | warmModel() fires at server start in background |
| SearXNG as OSS rival | Exists | qsearch wedge = QVAC-native local LLM cleaning; SearXNG has no cleaning layer |

---

## 9. Roadmap

| Version | Feature | Status |
|---|---|---|
| v0.1 (Day 4) | Brave + QVAC local cleaning, `npm start` | ✅ shipped |
| v0.2.2 (Day 6) | `/news`, `/context`, MCP tool, production deploy at qsearch.pro, 46 tests | ✅ live |
| v0.3 | Own corpus (domain-specific knowledge base) | planned |
| v0.4 | WDK x402 USDT micropayments for API access | planned |
| v1.0 | HyperDHT P2P distribution | planned |

---

*PRD owner: Timur Mamatov. Last updated: 2026-04-19.*
