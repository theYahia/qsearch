# qsearch — Status (2026-04-28)

## Current state

- **Version:** v0.4.0 (live at qsearch.pro)
- **Narrative:** Trust layer for AI agent search (pivot from QVAC SDK demo, 2026-04-28)
- **Corpus:** 5541 docs, 63 URLs with engine_count ≥ 3
- **Tests:** 46/46 passing

## Shipped

### Phase A — Trust Layer (2026-04-28, commits cc6efb1 → 4be8837)
- findings.md auto-export after every sweep
- `/trust/:url`, `/corpus/top`, `/ui` endpoints + corpus viewer (dark theme, vanilla)
- Snippet sanitization (XSS + prompt injection guard)
- Trust-weighted re-rank
- Obsidian vault auto-sync per sweep
- Brave sweep auto-ingest (`POST /ingest/brave`)

### Phase B — Public polish (2026-04-28, commits ee857ea, 0c6ffe8)
- README rewrite (personal narrative + "How I use it daily" dual sweep section)
- docker-compose: `restart: unless-stopped` + healthchecks on all 3 services
- docs/QUICKSTART.md (5-minute setup guide)
- GitHub Topics cleanup (added 9: search/mcp/ai-agents/rag/trust-layer/meilisearch/searxng/local-first/self-hosted)
- Version 0.4.0

### Phase C — Doc hygiene (2026-04-28)
- STATUS.md rewrite, ROADMAP/BLOG archive disclaimers, broken federation link fix

## Validation gate

| Criterion | Target | Current | Status |
|-----------|--------|---------|--------|
| Corpus size | 500+ URLs | 5541 docs | ✅ |
| Multi-engine URLs | 30+ ≥3 engines | 63 | ✅ |
| Daily use | 7 days | TBD | ⏳ |
| Friction | Below threshold | TBD | ⏳ |

**Decision (2026-04-28):** not waiting for gate, going to launch (Phase D) with current numbers. Validation continues in parallel — longitudinal data after 2 weeks of post-launch use.

## Next

- **Phase D = v0.5 launch (in progress):** docs/EXAMPLES.md, launch tweet, Awesome list PRs, Show HN
- **Show HN target:** 2026-05-05 (Tuesday morning UTC)
- **Post-launch:** monitor signal (stars / contributors / comments) → decision on v0.6+ federation

## Future scope (no commitment)

- v0.6+ federation per docs/VISION.md → docs/FEDERATION_ARCHITECTURE.md. Only if launch signal shows engagement (1k+ stars OR 5+ community deploys per VISION.md gate).

## Key files

| Path | Role |
|------|------|
| `src/server.js` | Main HTTP server (raw node:http, ESM) |
| `src/mcp-http.js` | MCP-over-HTTP server (port 8081) |
| `src/corpus/meilisearch.js` | Full-text + trust scoring (trustScore, topByTrust) |
| `src/corpus/qdrant.js` | Vector corpus (Linux/macOS only) |
| `src/sweep/findings_renderer.js` | findings.md generator |
| `src/clean/sanitize.js` | XSS + prompt injection guard, URL canonicalization |
| `src/search/rerank.js` | Trust-weighted re-rank |
| `src/obsidian/sync.js` | Vault auto-sync |
| `src/ingest/brave.js` | Brave sweep auto-ingest |
| `public/ui.html` + `public/app.js` | Corpus viewer at /ui |
| `public/index.html` | Public homepage (qsearch.pro) |
| `docker-compose.yml` | Meilisearch + Qdrant + SearXNG (with health checks) |
| `docs/QUICKSTART.md` | 5-min setup |
| `docs/VISION.md` | Strategic narrative |
| `docs/TRUST_MESH.md` | Technical spec |
| `docs/FEDERATION_ARCHITECTURE.md` | Federation architecture (from research lock-in) |
