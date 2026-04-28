# Contributing to qsearch

Thanks for your interest. qsearch is Apache-2.0, built solo, and I'm actively looking for contributors who care about agent search quality.

## Quick start for contributors

```bash
git clone https://github.com/theYahia/qsearch.git
cd qsearch
cp .env.example .env.local   # add BRAVE_API_KEY
docker compose up -d          # Meilisearch + Qdrant + SearXNG
npm install
npm test                      # 46/46 expected
npm start                     # http://localhost:8080
```

Tests use Node's built-in `node:test` runner — no extra test framework.

## Good first issues

These are self-contained and don't require deep system knowledge:

- **[#1] Add `first_seen` display to corpus viewer** (`/ui`) — `first_seen` is stored in Meilisearch but not shown in the card. Add it to `buildCards()` in `public/app.js`.
- **[#2] Language filter for `/search`** — add optional `lang` param (e.g. `?lang=fr`) passed through to SearXNG `search_lang`. 10-line server change + test.
- **[#3] CLI wrapper script** — write a `qsearch.sh` (or `qsearch.py`) that calls `POST /search` and pretty-prints results. Like httpie but qsearch-shaped.

Open a draft PR early — I give fast feedback.

## Areas where contributions help most

- **Corpus backends** — `src/corpus/interface.js` defines the contract. A SQLite or DuckDB backend would eliminate the Meilisearch dependency for small deployments.
- **Engine adapters** — `src/backends/` has Brave and SearXNG. Adding Kagi or SerpAPI follows the same pattern.
- **MCP tools** — `src/mcp.js` exposes 5 tools. New tools (e.g. `corpus_stats`, `export_findings`) are low-friction additions.
- **Tests** — `test/unit/` has coverage gaps for `sweep/runner.js` and `search/rerank.js`. Node's built-in test runner, no mocking required.

## Code style

- ESM only (`import`/`export`), no CommonJS
- No transpilation — ship what Node runs
- No framework (raw `node:http`) — keep it
- `npm test` must pass before PR review

## PR checklist

- [ ] `npm test` passes locally
- [ ] No new `console.log` without a `[module]` prefix (e.g. `[corpus]`, `[sweep]`)
- [ ] If you add an env var, add it to `.env.example` with a comment
- [ ] For new endpoints: add at least one test in `test/server.test.js`

## Questions?

Open an issue or find me at [@theYahia](https://github.com/theYahia) / [qsearch.pro](https://qsearch.pro).
