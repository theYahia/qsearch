# qsearch

> **Trust layer for AI agent search.** Multi-engine attribution. Local-first corpus. Validated retrieval. Open source.

![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![Status: v0.3.1 live](https://img.shields.io/badge/status-v0.3.1%20live-brightgreen.svg)
![Demo: qsearch.pro](https://img.shields.io/badge/demo-qsearch.pro-ef4444.svg)
![MCP](https://img.shields.io/badge/MCP-ready-8b5cf6.svg)

AI agents lose **17–33% of facts to hallucination** because they read 200-character snippets, not full pages ([Stanford 2024](https://dho.stanford.edu/wp-content/uploads/Legal_RAG_Hallucinations.pdf)). Existing search APIs hide *which engines agreed* on a result. Existing knowledge graphs are enterprise-priced or vendor-locked.

**qsearch is the open-source search layer that gives agents full content with multi-engine provenance** — running on your machine, owned by you, ready for MCP today.

> ✅ **v0.3.1 live at [qsearch.pro](https://qsearch.pro).** Multi-engine attribution shipped (`engines[]` field flows through corpus). Persistent trust signals across sweeps. Full MCP-over-HTTP for Claude Code and any HTTP-MCP client.
> 📖 **Vision:** [docs/VISION.md](./docs/VISION.md) · **Technical spec:** [docs/TRUST_MESH.md](./docs/TRUST_MESH.md) · **Architecture:** [docs/ARCHITECTURE_V03.md](./docs/ARCHITECTURE_V03.md)

## Quick start

```bash
# 1. Clone
git clone https://github.com/theYahia/qsearch.git
cd qsearch

# 2. Get a Brave Search API key (BYOK, $5/mo for ~1000 queries)
#    → https://brave.com/search/api/ → sign up → copy key

# 3. Configure
cp .env.example .env.local
# Set BRAVE_API_KEY=your_key
# Set SEARXNG_URL=http://localhost:8888 (for multi-engine attribution)

# 4. Start infrastructure (Meilisearch + Qdrant + SearXNG)
docker compose up -d

# 5. Install & run
npm install
npm start            # → qsearch v0.3.1 on http://localhost:8080

# 6. (Optional) MCP server for Claude Code / Workbench / OpenClaw
npm run start:mcp    # → http://0.0.0.0:8081

# 7. Test multi-engine attribution
curl -X POST http://localhost:8080/sweep \
  -H "Content-Type: text/plain" \
  --data-binary $'t1|self-hosted search engine\n'
# → parsed_snippets.md with "Engines: google, duckduckgo, brave (count=3)"
```

**BYOK design:** Brave key + SearXNG instance both stay on your machine. No data exfiltration.

---

## Why qsearch exists

Every AI agent today hits the same broken loop:

```
Agent → Tavily/Exa/Serper API → 200-char snippets → hallucinated answer
```

Three failures:

1. **Snippets aren't enough.** [Stanford's 2024 production RAG audit](https://dho.stanford.edu/wp-content/uploads/Legal_RAG_Hallucinations.pdf) measured 17–33% hallucination on Lexis+ AI and Westlaw despite "hallucination-free" claims. On Wikipedia QA, full content beats snippet-RAG by **+7.3pp** ([arxiv 2501.01880](https://arxiv.org/html/2501.01880v1)).

2. **No trust signal.** Search APIs return ranked lists without telling you *which engines agreed*. SEO-spam at position 3 looks identical to authoritative source at position 4.

3. **No memory.** Every search starts from zero. The same trash gets surfaced again. The same authority goes unrecognized.

qsearch addresses all three:
- **Full content fetched and cleaned**, not just snippets.
- **`engines[]` field per result** — Google + DDG + Brave + Qwant + Startpage attribution exposed (via SearXNG aggregation).
- **Local corpus accumulates** — every URL grows a trust profile across sweeps.

## How it works

```mermaid
flowchart LR
    A[Your agent] -->|query| Q[qsearch]
    Q -->|fan out| B[Brave Search API]
    Q -->|fan out| S["SearXNG\n(Google, DDG, Brave, Qwant, …)"]
    B -->|results| Q
    S -->|results + engines[]| Q
    Q -->|index by URL| C["Local corpus\n(Meilisearch + Qdrant)"]
    C -->|trust score| Q
    Q -->|re-ranked + full content + provenance| A

    style C fill:#fde68a,stroke:#d97706,color:#000
    style Q fill:#93c5fd,stroke:#2563eb,color:#000
    style S fill:#86efac,stroke:#16a34a,color:#000
```

The yellow node is your private corpus. URLs found by 5 engines + 3 sweeps + 4 topics get a trust score that emerges naturally — no human ranking, no centralized authority, no cloud round-trip.

## How qsearch compares

|  | Tavily | Exa | Serper | Brave API | SearXNG | **qsearch** |
|---|---|---|---|---|---|---|
| Open source core | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Full content (not snippets) | partial | partial | ❌ | ❌ | ❌ | ✅ |
| Multi-engine attribution | ❌ | ❌ | ❌ | ❌ | partial | ✅ (`engines[]`) |
| Persistent local corpus | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Trust score per URL | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Self-hostable | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| MCP-native | partial | ✅ | ❌ | ✅ | ❌ | ✅ |
| BYOK upstream | ❌ | ❌ | ❌ | N/A | ✅ | ✅ |

## API — v0.3.1

### Search endpoints

| Endpoint | Description | Backend |
|----------|-------------|---------|
| `POST /search` | Web search + corpus first | Brave or SearXNG |
| `POST /sweep` | Batch search via SearXNG (with `engines[]`) | SearXNG |
| `POST /news` | News search | Brave (requires key) |
| `POST /context` | Deep page extraction | Brave (requires key) |
| `POST /index` | Crawl URL or index local `.md` glob | Crawl4AI |
| `GET /corpus/stats` | Corpus size + counts | — |
| `GET /health` | Service status | — |

`/search` accepts: `query`, `n_results` (1–20), `freshness` (`pd`/`pw`/`pm`/`py`), `search_lang`, `country`, `corpus_first` (default `true`), `corpus_only` (default `false`).

`/sweep` accepts: text/plain body with `label|query` lines (one per line). Auto-indexes results into Meilisearch with `engines[]` and `engine_count` filterable.

### Multi-engine attribution example

```bash
curl -X POST http://localhost:8080/sweep \
  -H "Content-Type: text/plain" \
  --data-binary $'t1|self-hosted search engine 2026\n'
```

Output excerpt (`parsed_snippets.md`):

```markdown
**1. GitHub - searxng/searxng**
- URL: https://github.com/searxng/searxng
- Engines: google, duckduckgo, brave, qwant (count=4)
  > A privacy-respecting, hackable metasearch engine...

**2. random-blog.io/seo-spam-2026**
- URL: https://random-blog.io/seo-spam-2026
- Engines: google (count=1)
  > Best self-hosted search engines you must try...
```

URL #1 has `engine_count=4` — found by 4 independent engines. URL #2 has `engine_count=1` — found by only one. The trust signal is built into the data, not bolted on.

### Filter by trust in Meilisearch

```bash
curl -H "Authorization: Bearer masterKey" \
  "http://localhost:7700/indexes/qsearch_corpus/documents?filter=engine_count%20%3E%3D%203"
```

Returns only URLs found by 3+ engines — your high-trust subset.

## MCP integration

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "qsearch": {
      "type": "http",
      "url": "http://localhost:8081"
    }
  }
}
```

Available tools:
- `mcp__qsearch__web_search` — web search via Brave or SearXNG
- `mcp__qsearch__sweep` — batch research sweep with multi-engine attribution
- `mcp__qsearch__index_research` — index local `.md` files by glob
- `mcp__qsearch__news_search` — news search (Brave key required)
- `mcp__qsearch__context_search` — deep page content (Brave key required)

### Other MCP-over-HTTP clients

qsearch publishes Streamable HTTP transport at `/` on port `:8081`. Compatible with Claude Desktop (HTTP mode), OpenClaw, and any spec-compliant MCP client.

## Stack

| Component | Tech |
|-----------|------|
| Runtime | Node.js ≥20 |
| Web search | Brave Search API (BYOK) |
| Meta-search | SearXNG (self-hosted, optional) |
| Full-text corpus | Meilisearch v1.7 |
| Vector corpus | Qdrant v1.17.1 (Linux/macOS bare-runtime; offline on Windows) |
| Crawler | Crawl4AI 0.8.6 (Python subprocess) |
| Embedder (optional) | llama.cpp `/v1/embeddings` server |
| LLM cleaner (optional) | Any GGUF model via `@qvac/sdk` (works for cleaning, not the central pillar) |
| MCP | `@modelcontextprotocol/sdk` |
| License | Apache-2.0 |

## Roadmap

| Version | Feature | When |
|---------|---------|------|
| **v0.3.1** | Multi-engine `engines[]` attribution + dual sweep + corpus + MCP | shipped |
| **v0.4** | Trust graph: `/trust/:url` endpoint, formula, simple viewer | 3–5 weeks |
| **v0.5** | Bidirectional RAG validated feedback loop (grounding + attribution + novelty gates) | 6–8 weeks |
| **v0.6+** | Optional aggregator service for opt-in federation (centralized → self-host Docker) | 3–6 months |
| **v1.0** | Federation with workable validator economics — *if* honestly solvable | open |

See [docs/VISION.md](./docs/VISION.md) for the full picture and why federation is research-direction-only until we can ship it without overpromise.

## Honest trade-offs

- **Cold start.** First sweep takes 5–10 seconds (engine fan-out + corpus indexing). Best run as long-lived daemon.
- **Vector search Windows-blocked.** Qdrant requires bare-runtime; not all platforms supported. Full-text Meilisearch works everywhere.
- **SearXNG rate limits.** Self-host required — public instances get blocked by Google. Our docker-compose handles this.
- **`engines[]` requires SearXNG.** Pure-Brave mode still works but loses the multi-engine signal.
- **Full content has latency cost.** ~31s vs ~3s naive snippet retrieval ([Bidirectional RAG study](https://arxiv.org/html/2512.22199v1)). qsearch makes this opt-in via `/context` endpoint.

## Follow

- 🌐 **Live demo:** [qsearch.pro](https://qsearch.pro)
- ⭐ **Star:** [github.com/theYahia/qsearch](https://github.com/theYahia/qsearch)
- 🐦 **X:** [@TheTieTieTies](https://x.com/TheTieTieTies)

## License

Apache-2.0 — see [LICENSE](./LICENSE). Independent. BYOK. Self-hostable. No vendor lock-in.
