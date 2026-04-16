# qsearch — 8-Slide Pitch Deck

*For Tether conversation 2026-04-21. Visual script — convert to slides.*

---

## Slide 1 — Title

**qsearch**
*The open-web hop for QVAC agents*

`github.com/theYahia/qsearch` · Apache-2.0 · v0.1 live, v0.2 in testing · Built in 7 days

---

## Slide 2 — The gap

**The Tether edge stack has one missing layer.**

```
QVAC agent
  ├── local documents      ← QVAC Workbench  ✅
  ├── local wallet         ← WDK             ✅
  ├── local inference      ← @qvac/sdk       ✅
  └── live web search      ← ???             ❌
```

Every search API (Exa $700M, Tavily/Nebius, Sonar) cleans results on **their** server. An agent that keeps health data local but sends search queries to a cloud API is **half-sovereign**.

---

## Slide 3 — The solution

**Two hops. One of them is yours.**

```
Hop 1 (outbound):   Brave Search API — BYOK, $5/1K
                    brave_ms: 819ms

Hop 2 (local):      @qvac/sdk — Qwen3-0.6B Q4, 364MB
                    clean_ms: 1420ms — YOUR CPU
```

3 endpoints: `/search` (web), `/news` (50+ results), `/context` (2-28 snippets/result).
MCP tool for QVAC Workbench. Verifiable in `src/server.js`.

---

## Slide 4 — Real output

```json
{
  "query": "qvac sdk",
  "model": "QWEN3_600M_INST_Q4",
  "brave_ms": 819,
  "total_clean_ms": 2428,
  "results": [
    {
      "url": "https://qvac.tether.io/",
      "title": "QVAC - Decentralized, Local AI",
      "cleaned_markdown": "QVAC is a decentralized local AI platform...",
      "clean_ms": 1420,
      "page_age": "2026-04-10T12:45:05"
    }
  ]
}
```

`npm install && npm start` — works on Windows/macOS/Linux.

---

## Slide 5 — vs Competitors

|  | Exa ($700M) | Tavily (Nebius) | Sonar | **qsearch** |
|--|------------|-----------------|-------|-------------|
| LLM cleaning | Cloud GPU | Cloud | Cloud | **Your CPU** |
| OSS auditable | ❌ | ❌ | ❌ | ✅ |
| QVAC-native | ❌ | ❌ | ❌ | ✅ |
| Self-hostable | ❌ | ❌ | ❌ | ✅ |
| Cost/1K | $7-15 | $8 | $5-22 | **$5 (BYOK)** |
| P2P cache | ❌ | ❌ | ❌ | **✅ (planned)** |
| Network effect | ❌ | ❌ | ❌ | **✅ (planned)** |

---

## Slide 6 — The vision (where this goes)

**qsearch is not a search API. It's a P2P knowledge network.**

```
Agent query
  → Local Hyperbee cache (instant, $0)
    miss → Hyperswarm peers (sparse query, <10ms)
      miss → Brave API → QVAC cleaning → cache → replicate to peers
```

**Each query makes the network smarter.** Network effect = moat.

Built on YOUR stack: Hyperswarm, Hyperbee, Corestore, @qvac/sdk, WDK.
Same P2P infrastructure that runs MiningOS (100K+ ASICs, 15 sites).

QVAC SDK has embeddings but **no RAG module**. qsearch = the RAG layer.

---

## Slide 7 — What I did in 7 days

- 22+ commits, v0.2 shipped
- 4 API endpoints (search, news, context, health)
- MCP tool for Workbench integration
- 7 deep research sprints (120+ Brave queries)
- Competitive analysis (35 WDK hackathon semifinalists scanned)
- Pricing deep-dive (8 providers, exact unit economics)
- P2P stack code review (Hypercore, Hyperswarm, Hyperbee API)
- Blog post with real benchmarks, honest trade-offs
- Apache-2.0, public roadmap, WDK repost day zero

---

## Slide 8 — The ask

> **Give me insider access and I ship the P2P knowledge network in two months. All the building blocks are your repos.**

`github.com/theYahia/qsearch` · `@TheTieTieTies`

---

## Speaker notes

**Slide 2** — Say "half-sovereign" once. If they nod, move on.

**Slide 3** — The `brave_ms` / `clean_ms` split is the proof. Don't skip past it.

**Slide 5** — "We're not competing with Exa. This wins on a different dimension."

**Slide 6** — Only show if they ask "what's next." Lead with shipped code, not vision.

**Slide 7** — "I understand your stack. Not just QVAC — Hyperswarm, Hyperbee, MiningOS architecture, WDK MCP toolkit."

**Slide 8** — Say it, stop talking. Don't soften.
