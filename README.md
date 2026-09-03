# qsearch

> I built this for my own daily research. After running 100+ research sprints, my agent kept hallucinating because it read 200-char snippets. qsearch gives it full content with multi-engine provenance — running locally, owned by me.

![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![CI](https://github.com/theYahia/qsearch/actions/workflows/test.yml/badge.svg)
![Status: v0.4.0 live](https://img.shields.io/badge/status-v0.4.0%20live-brightgreen.svg)
![Demo: qsearch.pro](https://img.shields.io/badge/demo-qsearch.pro-ef4444.svg)
![MCP](https://img.shields.io/badge/MCP-ready-8b5cf6.svg)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.theYahia%2Fqsearch-8b5cf6.svg)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.theYahia/qsearch)

AI agents lose **17–33% of facts to hallucination** because they read 200-character snippets, not full pages ([Stanford 2024](https://dho.stanford.edu/wp-content/uploads/Legal_RAG_Hallucinations.pdf)). Existing search APIs hide *which engines agreed* on a result. Existing knowledge graphs are enterprise-priced or vendor-locked.

**qsearch is the open-source search layer that gives agents full content with multi-engine provenance** — running on your machine, owned by you, ready for MCP today.

> ✅ **v0.4.0 live at [qsearch.pro](https://qsearch.pro).** Multi-engine attribution, trust corpus with per-URL provenance (`engines[]`, `sweep_count`, `trust_score`), corpus viewer at `/ui`, MCP-over-HTTP for Claude Code and any spec-compliant client.
> 📖 **Architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md) · **Vision:** [docs/VISION.md](./docs/VISION.md) · **Technical spec:** [docs/TRUST_MESH.md](./docs/TRUST_MESH.md) · **Federation deep-dive:** [docs/FEDERATION_ARCHITECTURE.md](./docs/FEDERATION_ARCHITECTURE.md)

## Demo

![qsearch terminal demo — quickstart, multi-engine search, citation verify](assets/demo.gif)

> 60-second tour: `/health` (it's up, local) → `/sweep` (multi-engine `engines[]` attribution) → `/verify` (does the cited source actually support the claim?). Reproduce it locally with [`bash scripts/record-demo.sh`](scripts/record-demo.sh) after `npm start` — see [docs/launch/README-demo-embed.md](docs/launch/README-demo-embed.md).

## Quick start

**Run it in 5 minutes — free tier, no API key:**

```bash
git clone https://github.com/theYahia/qsearch.git && cd qsearch
cp .env.example .env.local       # works as-is on the $0 SearXNG tier
docker compose up -d             # Meilisearch + Qdrant + SearXNG
npm install && npm start         # → qsearch on http://localhost:8080

# multi-engine attribution in one call
curl -X POST http://localhost:8080/sweep \
  -H "Content-Type: text/plain" \
  --data-binary $'t1|self-hosted search engine\n'
# → parsed_snippets.md with "Engines: google, duckduckgo, brave (count=3)"
```

The `broad` sweep tier runs on self-hosted SearXNG and costs nothing. Add a Brave key only when you want the `focused`/`critical` tiers. Full setup (Brave key, Ollama, MCP server) below.

<details>
<summary><b>Full setup</b> — Brave BYOK + local LLM + MCP server</summary>

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

# 5. (Optional) Pull Ollama models for local LLM cleaning + embedding rerank
#    Without them, search still works — just no cleaned_markdown and no rerank.
ollama pull qwen2.5:7b-instruct   # ~5GB, cleaner (used by /sweep_context)
ollama pull nomic-embed-text      # 274MB, embedding rerank (Phase B)

# 6. Install & run
npm install
npm start            # → qsearch v0.4.0 on http://localhost:8080

# 7. (Optional) MCP server for Claude Code / Workbench / OpenClaw
npm run start:mcp    # → http://0.0.0.0:8081

# 8. Test multi-engine attribution
curl -X POST http://localhost:8080/sweep \
  -H "Content-Type: text/plain" \
  --data-binary $'t1|self-hosted search engine\n'
# → parsed_snippets.md with "Engines: google, duckduckgo, brave (count=3)"
```

**BYOK design:** Brave key + SearXNG + Ollama all stay on your machine. No data exfiltration.

</details>

---

## How I use it daily

Every research sprint I run a dual sweep:

```bash
# Brave sweep (primary, authoritative)
python research/scripts/brave_sweep.py queries.txt _raw_data/topic_2026-04-28/brave/

# qsearch sweep (secondary, auto-indexes into corpus)
curl -X POST http://localhost:8080/sweep?topic=my_topic \
  -H "Content-Type: text/plain" --data-binary @queries.txt
```

After 10+ sprints on the same domain, `/corpus/top?min_engines=3` shows which URLs survived multiple independent search engines across multiple sessions. Those are the ones I actually trust.

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

## API — v0.4.0

### Search endpoints

| Endpoint | Description | Backend |
|----------|-------------|---------|
| `POST /search` | Web search + corpus first, trust-weighted re-rank | Brave or SearXNG |
| `POST /sweep` | Batch search with priority/domain routing (see below) | SearXNG / Brave / Academic |
| `POST /cached_sweep` | Same as `/sweep`, with SQLite memcache layer | SearXNG / Brave / Academic |
| `POST /academic_search` | Peer-reviewed papers via arxiv + PubMed + Semantic Scholar | Academic (free, no auth) |
| `POST /sweep_context` | Local LLM page extraction (analogue of Brave LLM Context) | Ollama qwen2.5 |
| `POST /news` | News search | Brave (requires key) |
| `POST /context` | Deep page extraction | Brave (requires key) |
| `POST /verify` | Citation honesty check — does the cited URL actually support a claim? Returns `Supported`/`Partial`/`Unsupported`/`Fabricated`/`Error` + verbatim excerpt | LLM-as-judge (local Ollama qwen2.5 or DeepSeek) |
| `POST /index` | Crawl URL or index local `.md` glob | Crawl4AI |
| `GET /trust/:url` | Trust score + provenance for any URL in corpus | — |
| `GET /corpus/top` | Top URLs ranked by trust (`?limit=20&min_engines=3`) | — |
| `GET /corpus/stats` | Corpus size + counts | — |
| `GET /economy_report` | Sprint cost breakdown by backend + savings vs all-Brave | — |
| `GET /ui` | Corpus browser — search, trust scores, provenance modal | — |
| `GET /health` | Service status | — |

`/search` accepts: `query`, `n_results` (1–20), `freshness` (`pd`/`pw`/`pm`/`py`), `search_lang`, `country`, `corpus_first` (default `true`), `corpus_only` (default `false`).

`/sweep` accepts text/plain body with one query per line in the format `label|query[|priority][|domain]`:

- **priority** ∈ `broad` (default, SearXNG, $0) / `focused` (Brave, ~$0.005) / `critical` (Brave + LLM Context, ~$0.01)
- **domain** ∈ `general` (default) / `scholarly` (arxiv+PubMed+S2, $0) / `ru` (SearXNG with `language=ru-RU` bias, $0)

```
# Examples
bench_a|qdrant production latency benchmarks|focused
sch_a|crispr cas9 off target effects|broad|scholarly
ru_a|tadviser сро рейтинг 2025|broad|ru
crit_a|self-hosted vector DB choice 2026|critical
gen|simple search|broad        # 2-field still works — defaults broad/general
```

Auto-indexes results into Meilisearch with `engines[]` and `engine_count` filterable.

`/academic_search` accepts JSON: `{ query, n_results (1-20), sources?: ["arxiv","pubmed","semanticscholar"] }`. Fans out to all three in parallel, dedupes by DOI/title, returns interleaved top-N.

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

The MCP server lives in this repo — there is no npm package for it. Run it from source:

```bash
git clone https://github.com/theYahia/qsearch.git && cd qsearch
npm install
npm start            # REST API on :8080 — must be running first
npm run start:mcp    # MCP server (Streamable HTTP) on :8081
```

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
- `mcp__qsearch__academic_search` — peer-reviewed papers via arxiv + PubMed + Semantic Scholar
- `mcp__qsearch__sweep_context` — Phase 3 local LLM page extraction (free, Ollama)
- `mcp__qsearch__verify_citation` — does the cited URL actually support the claim? (`Supported`/`Partial`/`Unsupported`/`Fabricated`)
- `mcp__qsearch__economy_report` — cost breakdown vs all-Brave baseline
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
| Academic | arxiv + PubMed E-utilities + Semantic Scholar API (free, no auth) |
| Full-text corpus | Meilisearch v1.7 |
| Vector corpus | Qdrant v1.17.1 |
| Crawler | Crawl4AI 0.8.6 (Python subprocess) |
| Embedder (optional) | Ollama `nomic-embed-text` (default) or llama.cpp `/v1/embeddings` |
| LLM cleaner (optional) | Ollama `qwen2.5:7b-instruct` (default; configurable via `OLLAMA_CLEAN_MODEL`) |
| MCP | `@modelcontextprotocol/sdk` |
| License | Apache-2.0 |

## Roadmap

| Version | Feature | When |
|---------|---------|------|
| **v0.3.1** | Multi-engine `engines[]` attribution + dual sweep + corpus + MCP | shipped |
| **v0.4.0** | Trust layer: `/trust/:url`, `/corpus/top`, `/ui` viewer, trust-weighted re-rank, sort/pagination, corpus merge-on-upsert, snippet sanitization | shipped |
| **v0.4.1** | Phase A — academic backend (arxiv + PubMed + S2), 4-field queries (`label\|q\|priority\|domain`), `/academic_search` JSON + MCP tool | shipped |
| **v0.4.2** | Phase B — embedding rerank (Ollama nomic-embed-text, gated `QSEARCH_RERANK_ENABLED`); Phase C — RU coverage via SearXNG `language=ru-RU` | shipped |
| **v0.4.3** | QVAC SDK ripped out, all local LLM via Ollama (`qwen2.5:7b-instruct` + `nomic-embed-text`) | shipped |
| **v0.5** | Launch: awesome list PRs, MCP Registry publish, Show HN, newsletter distribution | in progress |
| **v0.6** | Phase B Stage 2 — LLM scoring rerank for critical queries; direct Yandex backend; Layer 8 quality gate (rejection threshold) | next |
| **v0.7+** | Optional federation (research direction — no timeline until v0.5 validated) | open |

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

---

Часть [WWmcp](https://github.com/theYahia/WWmcp) · Telegram: [@vhodvai](https://t.me/vhodvai)
