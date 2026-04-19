# qsearch API docs

The open-web hop for AI agents. Brave Search + QVAC local LLM cleaning.

## Endpoints

### POST /search
Web search with optional LLM cleaning.
```bash
curl -X POST https://qsearch.pro/search \
  -H "Content-Type: application/json" \
  -d '{"query": "QVAC SDK", "n_results": 3}'
```

Parameters: `query` (required), `n_results` (1-20, default 3), `freshness` (pd/pw/pm), `search_lang`, `country`, `safesearch`

### POST /news
News search with freshness filters.
```bash
curl -X POST https://qsearch.pro/news \
  -H "Content-Type: application/json" \
  -d '{"query": "tether", "n_results": 5, "freshness": "pd"}'
```

Parameters: `query` (required), `n_results` (1-50, default 5), `freshness` (default "pw"), `search_lang`

### POST /context
Deep context with multi-snippet sources for RAG.
```bash
curl -X POST https://qsearch.pro/context \
  -H "Content-Type: application/json" \
  -d '{"query": "x402 protocol", "n_results": 3}'
```

Parameters: `query` (required), `n_results` (1-10, default 3), `freshness`

### GET /search?q=...
Quick search via query params.
```bash
curl "https://qsearch.pro/search?q=QVAC+SDK&n=3"
```

Parameters: `q` (required), `n` (results count, default 3)

### GET /health
Server status.
```bash
curl https://qsearch.pro/health
```

Response: `{"status":"ok","version":"0.2.2","qvac_available":true|false,"model_loaded":true|false}`

## MCP Config (self-hosted only)

To run your own instance, add to `claude_desktop_config.json` or Cursor MCP settings:

```json
{
  "mcpServers": {
    "qsearch": {
      "command": "node",
      "args": ["src/mcp.js"],
      "env": { "BRAVE_API_KEY": "your-key" }
    }
  }
}
```

## Response schema

```json
{
  "query": "QVAC SDK",
  "brave_endpoint": "web",
  "brave_ms": 511,
  "total_clean_ms": 245,
  "total_results": 3,
  "model": "QWEN3_600M_INST_Q4" | null,
  "results": [
    {
      "url": "https://qvac.tether.io/",
      "title": "QVAC - Decentralized, Local AI",
      "description": "raw description from Brave",
      "cleaned_markdown": "LLM-cleaned version" | null,
      "extra_snippets": ["..."],
      "page_age": "2026-04-10T12:45:05",
      "age": "1 week ago",
      "source": "QVAC",
      "language": "en",
      "clean_ms": 82
    }
  ]
}
```

## License

Apache-2.0 · [GitHub](https://github.com/theYahia/qsearch) · Built on QVAC by Tether
