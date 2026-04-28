# qsearch API docs

Open-source search layer for AI agents with multi-engine provenance. Self-hosted, BYOK, MCP-native.

Live demo: https://qsearch.pro

## Endpoints

### POST /search
Web search with corpus-first re-ranking and multi-engine attribution.
```bash
curl -X POST https://qsearch.pro/search \
  -H "Content-Type: application/json" \
  -d '{"query": "open source MCP servers", "n_results": 5}'
```

Parameters: `query` (required), `n_results` (1-20, default 3), `freshness` (pd/pw/pm/py), `search_lang`, `country`, `corpus_first` (default true), `corpus_only` (default false)

### POST /sweep
Batch research sweep — label|query lines, fans out in parallel, indexes into corpus with engines[].
```bash
curl -X POST https://qsearch.pro/sweep \
  -H "Content-Type: text/plain" \
  --data-binary $'q1|RAG hallucination reduction\nq2|self-hosted search engines 2026\n'
```

Returns `parsed_snippets.md` with per-URL engine attribution (Engines: google, duckduckgo, brave — count=3).

### POST /news
News search with freshness filters.
```bash
curl -X POST https://qsearch.pro/news \
  -H "Content-Type: application/json" \
  -d '{"query": "AI agent search", "n_results": 5, "freshness": "pd"}'
```

Parameters: `query` (required), `n_results` (1-50, default 5), `freshness` (default "pw"), `search_lang`

### POST /context
Deep page content for RAG — 2-28 snippets per source.
```bash
curl -X POST https://qsearch.pro/context \
  -H "Content-Type: application/json" \
  -d '{"query": "x402 protocol", "n_results": 3}'
```

Parameters: `query` (required), `n_results` (1-10, default 3), `freshness`

### GET /search?q=...
Quick search via query params.
```bash
curl "https://qsearch.pro/search?q=open+source+search+API&n=5"
```

### GET /health
Server status.
```bash
curl https://qsearch.pro/health
```

Response: `{"status":"ok","version":"0.4.0","brave_available":true,"searxng_available":true,"meili_available":true}`

### GET /trust/:url
Trust score + provenance for any URL in corpus.
```bash
curl "https://qsearch.pro/trust/https%3A%2F%2Fgithub.com%2Fsearxng%2Fsearxng"
```

Response: `{"url":"...","trust_score":4.16,"engine_count":4,"sweep_count":3,"engines":["google","duckduckgo","brave","qwant"]}`

### GET /corpus/top
Top URLs ranked by trust score.
```bash
curl "https://qsearch.pro/corpus/top?limit=20&min_engines=3"
```

Parameters: `limit` (default 20, max 100), `min_engines` (default 1), `sort` (trust/engine_count/sweep_count/first_seen), `offset`

### GET /corpus/stats
Corpus size and high-trust URL count.
```bash
curl https://qsearch.pro/corpus/stats
```

Response: `{"total":1240,"high_trust_count":63}`

### GET /ui
Corpus browser — search, trust scores, provenance modal. Open in browser.

## MCP config

Add to `~/.claude/settings.json` (Claude Code) or `claude_desktop_config.json` (Claude Desktop):

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

Start MCP server: `npm run start:mcp` — listens on port 8081.

Available tools: `web_search`, `sweep`, `index_research`, `news_search`, `context_search`

## Response schema

```json
{
  "query": "open source MCP servers",
  "brave_endpoint": "web",
  "brave_ms": 511,
  "total_results": 5,
  "results": [
    {
      "url": "https://github.com/modelcontextprotocol/servers",
      "title": "MCP Servers",
      "description": "Reference implementations for MCP servers",
      "engines": ["google", "duckduckgo", "brave", "qwant"],
      "engine_count": 4,
      "source": "corpus",
      "trust_score": 4.16,
      "age": "2 weeks ago",
      "language": "en"
    }
  ]
}
```

Key fields: `engines[]` — which search engines surfaced this URL; `engine_count` — consensus signal (4 = high trust, 1 = single engine only); `source` — "corpus" (known URL, trust-weighted) or "brave" (fresh result).

## License

Apache-2.0 · [github.com/theYahia/qsearch](https://github.com/theYahia/qsearch)
