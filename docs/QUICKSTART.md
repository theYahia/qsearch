# qsearch — 5-minute setup

## Prerequisites

- Docker + Docker Compose
- Node.js ≥ 20
- (Optional) Brave Search API key — $5/mo, ~1000 queries → [brave.com/search/api](https://brave.com/search/api/)

## 1. Clone and configure

```bash
git clone https://github.com/theYahia/qsearch.git
cd qsearch
cp .env.example .env.local
# Edit .env.local — set BRAVE_API_KEY (optional but recommended)
```

## 2. Start services

```bash
docker compose up -d
# Starts: Meilisearch (7700), Qdrant (6333), SearXNG (8888)
```

## 3. Start qsearch

```bash
npm install
npm start
# → qsearch listening on http://localhost:8080
```

## 4. Run your first sweep

```bash
echo "t1|self-hosted search engine 2026" > queries.txt
curl -X POST "http://localhost:8080/sweep?topic=my_first_sweep" \
  -H "Content-Type: text/plain" --data-binary @queries.txt
```

Check results:
- Corpus viewer: `http://localhost:8080/ui`
- Findings: `_raw_data/my_first_sweep/findings.md`
- Trust score: `curl "http://localhost:8080/trust/<url-encoded-url>"`

## 5. Connect Claude Code (MCP)

```bash
npm run start:mcp   # → port 8081
```

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "qsearch": { "type": "http", "url": "http://localhost:8081" }
  }
}
```

Available tools: `web_search`, `sweep`, `index_research`, `news_search`, `context_search`.

## 6. Optional: Obsidian sync

Add to `.env.local`:

```
OBSIDIAN_VAULT_PATH=/path/to/your/vault
```

Every sweep auto-creates `Clippings/qsearch/<topic>_<date>.md` in your vault.

## Verification checklist

- [ ] `http://localhost:8080/health` returns `{"status":"ok"}`
- [ ] `http://localhost:8080/ui` loads corpus browser
- [ ] `POST /sweep` returns `parsed_snippets.md`
- [ ] `_raw_data/<topic>/findings.md` created after sweep
- [ ] `http://localhost:8080/corpus/top` returns URLs

## Dual sweep (advanced)

For maximum corpus coverage, run both backends on the same query file:

```bash
# Primary: Brave API (authoritative, parallel)
python research/scripts/brave_sweep.py queries.txt _raw_data/topic_$(date +%Y-%m-%d)/brave/

# Secondary: qsearch (auto-indexed into corpus, multi-engine attribution via SearXNG)
curl -X POST "http://localhost:8080/sweep?topic=my_topic" \
  -H "Content-Type: text/plain" --data-binary @queries.txt \
  > _raw_data/topic_$(date +%Y-%m-%d)/qsearch/parsed_snippets.md
```

After several sprints on the same domain, `GET /corpus/top?min_engines=3` shows the URLs that survived across multiple independent engines — your high-trust subset.
