# qsearch v0.3 — Architecture Document

> **Delegation spec.** Self-contained. A weaker model or contributor can implement v0.3 by following this document without additional design decisions from Tim — provided the open questions in §1 are closed first.

> **Currency:** verified 2026-04-26. Versions and APIs were `npm view`'d / `pip index`'d / `WebFetch`'d in this exact order. Re-verify before starting if the doc is older than 30 days.

---

## §1. Open Questions Tim Must Close Before Delegation

These are decisions that affect the whole spec. The doc below assumes the **default** answer. If Tim picks a different option, edit the rest accordingly.

### Q1. Corpus stack: explicit Meilisearch+Qdrant, OR `@qvac/rag`?

**Discovery during verification (NEW since Step 2):** Tether ships [`@qvac/rag` v0.4.4](https://www.npmjs.com/package/@qvac/rag) as a **complete RAG primitive**:
- Pluggable embedding function (works with `@qvac/embed-llamacpp` v0.14.0 — also Tether-shipped)
- Built-in vector DB: `HyperDBAdapter` on top of Corestore + HyperDB (Holepunch stack)
- API: `chunk() → ingest() → search() → infer()`
- License Apache-2.0; maintained by `subash.77@tether.io`, Paolo Ardoino, Mathias Buus
- **Already P2P-aware** (Corestore is the same primitive that powers HyperDHT) → makes v1.0 P2P "almost free"

| Option | Pros | Cons |
|--------|------|------|
| **A. `@qvac/rag` + `@qvac/embed-llamacpp` + Crawl4AI** | QVAC-native narrative ("qsearch built on Tether's own RAG"); fewer moving parts; v1.0 P2P pre-wired; smaller dep tree | New (9 versions, last 3 weeks ago); HyperDB less battle-tested than Qdrant; no BM25 (vector only) |
| **B. Meilisearch + Qdrant + Crawl4AI** *(spec'd below — Step 2 approved)* | Battle-tested; full-text + vector hybrid; standard stack reviewers will recognize | More moving parts; weaker QVAC narrative; deferred P2P story |

**Default in this doc: Option B** (preserves Step 2 decision). If Tim picks A, see §13 for the diff.

### Q2. Reranker in v0.3 — yes or no?

Step 2 research recommended `bge-reranker-v2-m3` (~600MB). **This doc DROPS reranker from v0.3** because:
- It adds ~2 weeks to the schedule and requires another model in QVAC SDK (Qwen3-0.6B + bge-reranker = 2 models loaded)
- v0.3 ships value without it (corpus + Brave hybrid is already novel)
- Defer to v0.5 ("quality pass") after first user feedback

If Tim wants reranker in v0.3, add Week 8.5 + 8.7 from §11 (allocate 8h).

### Q3. FastMCP migration — v0.3 or later?

Step 2 research recommended FastMCP (Python). **This doc DEFERS FastMCP** because:
- qsearch is Node.js (`node:http`, ESM, `node:test`); FastMCP is Python
- Migration = adding Python runtime to a JS project = scope explosion
- Current `src/mcp.js` + `src/mcp-http.js` work in production (QVAC Workbench live integration)
- Defer to v1.0+ if MCP transport surfaces become a bottleneck

If Tim wants FastMCP, that's a separate project, not v0.3.

### Q4. x402 facilitator: Coinbase CDP or self-hosted?

Default: **Coinbase CDP** (hosted, easiest, official `@coinbase/cdp-sdk`). Self-hosted via `x402-rs` is option for v0.5+. Decision affects only `COINBASE_CDP_KEY` env var requirement.

### Q5. WDK alignment for x402 (v0.4 question, mention now)

Tether ships its own [WDK](https://github.com/tetherto/wdk) — possible Tether-aligned x402 facilitator. v0.4 spec needs research sprint to decide between Coinbase x402 and a Tether-flavored one. Not blocking for v0.3.

---

## §2. What v0.3 Adds

v0.2.2 is a thin proxy: every query → Brave API → QVAC cleans → JSON. No memory; every result ephemeral.

v0.3 adds an **Own Corpus** layer:
- A crawled, indexed knowledge base seeded with crypto/DeFi protocols
- Vector + full-text search over the corpus
- Query routing: corpus-first → Brave fallback for uncovered topics
- Corpus results <10ms (no network call)

v0.3 also ships the **x402 payment middleware skeleton** with **interface locked** so MCP / SDK consumers can plan against it; enforcement activates in v0.4.

---

## §3. Layer Map

```
Layer 0: OSS Components (consumed, not built)
  Meilisearch v1.7         — full-text index (Docker)
  Qdrant v1.17.1           — vector store (Docker)
  Crawl4AI 0.8.6           — crawler (Python subprocess)
  @qvac/sdk 0.9.1          — orchestrator (npm)
  @qvac/embed-llamacpp 0.14 — embedding (transitive via @qvac/sdk)
  Qwen3-0.6B-Instruct-Q4   — cleaning model (~364MB, downloaded by SDK)
  Qwen3-Embedding-0.6B     — embedding model (downloaded by SDK)
  Brave Search API         — primary web backend (BYOK, Data-for-AI tier)
  SearXNG (latest)         — fallback web backend (Docker, optional)
  @modelcontextprotocol/sdk 1.29 — MCP transport (stays — Node.js native)
  x402 1.2.0               — payment SDK (added in v0.4)

Layer 1: Kernel (this repo — what Tim builds)
  src/server.js            — HTTP API (Node.js node:http)
  src/backends/            — search backend plugins (Brave, SearXNG)
  src/corpus/              — corpus index (Meilisearch + Qdrant)
  src/crawl/               — crawler subprocess wrapper (Crawl4AI)
  src/embed/               — embedding pipeline (QVAC)
  src/clean/               — cleaning pipeline (QVAC, extracted from server.js)
  src/x402/                — payment middleware (skeleton in v0.3, live in v0.4)
  src/mcp.js               — MCP tool wrappers (UNCHANGED — extend tools only)
  src/mcp-http.js          — MCP-over-HTTP server (UNCHANGED — production)

Layer 2: Distros (opinionated stacks — community)
  qsearch-crypto-node      — pre-seeded crypto/DeFi corpus
  qsearch-minimal          — Brave-only, no corpus

Layer 3: Community apps
  Any agent / tool consuming qsearch HTTP API or MCP tools
```

> **EXPLICITLY OUT of v0.3 Layer 0:** FastMCP (Python — defer), bge-reranker (deferred to v0.5), HyperDHT (v1.0+), Ollama (CVE-2026-5757 unpatched as of April 2026 — never recommend).

---

## §4. Locked Component Versions (verified 2026-04-26)

### npm packages

| Package | Current in repo | v0.3 target | Source |
|---------|-----------------|-------------|--------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | unchanged | `package.json` |
| `@qvac/sdk` | `^0.8.3` | **`^0.9.1`** ⬆️ (needs embed support) | `npm view @qvac/sdk version` → 0.9.1 |
| `zod` | `^4.3.6` | unchanged | `package.json` |
| `meilisearch` | — | **`^0.57.0`** | `npm view meilisearch version` → 0.57.0 |
| `@qdrant/js-client-rest` | — | **`^1.17.0`** | `npm view @qdrant/js-client-rest version` → 1.17.0 |
| `x402` | — | add in **v0.4** as `^1.2.0` | `npm view x402 version` → 1.2.0 |

> Do **not** install `x402-express` — qsearch uses native `node:http`, not Express. Use the core `x402` package and adapt its primitives in `src/x402/middleware.js`.

> `@qvac/sdk` 0.9.x adds the `@qvac/embed-llamacpp` transitive dep automatically. No need to depend on `@qvac/embed-llamacpp` directly.

### Docker images

| Service | Image:tag | Port | Notes |
|---------|-----------|------|-------|
| Meilisearch | `getmeili/meilisearch:v1.7` | 7700 | dev key `masterKey` |
| Qdrant | `qdrant/qdrant:v1.17.1` | 6333 | matches JS client `^1.17.0` |
| SearXNG | `searxng/searxng:latest` | 8888 | optional fallback |

### Python packages (Crawl4AI sidecar)

| Package | Version | Notes |
|---------|---------|-------|
| `crawl4ai` | `0.8.6` (Mar 24 2026) | `pip install crawl4ai==0.8.6` |
| Python | `>=3.11` | Crawl4AI requirement |

### Models (downloaded automatically by `@qvac/sdk`)

| Constant | Purpose | Size | Loaded via |
|----------|---------|------|------------|
| `QWEN3_600M_INST_Q4` | cleaning (existing) | ~364 MB | `loadModel({ modelType: 'llamacpp-completion' })` |
| Qwen3-Embedding-0.6B | embedding (NEW) | ~600 MB | `loadModel({ modelType: 'llamacpp-embedding' })` — **VERIFY constant name in @qvac/sdk 0.9.1 README** |

> **⚠️ Verify-before-act:** the exact embedding model constant name in `@qvac/sdk` 0.9.1 was not confirmed in this doc. Run `node -e "import('@qvac/sdk').then(m => console.log(Object.keys(m)))"` after upgrading to find the correct constant. Likely candidates: `QWEN3_EMBED_600M`, `QWEN3_EMBEDDING_600M`, or similar.

---

## §5. API Contracts

### §5.0 Backward compatibility guarantee

All v0.2.2 endpoint **request shapes are unchanged**. Response shapes gain new fields only (additive, not breaking). All 46 existing tests in `test/server.test.js` must pass without modification.

### §5.1 Existing endpoint shapes (verified from `src/server.js`)

These are the **ground-truth current shapes**. v0.3 extends them; do not regress.

#### POST /search — current behavior

Request:
```json
{
  "query": "string",       // required (also accepts "q")
  "n_results": 3,          // default 3, clamped [1, 20] (also accepts "n")
  "freshness": null,       // optional: "pd"|"pw"|"pm"|"py"|"YYYY-MM-DDtoYYYY-MM-DD"
  "search_lang": null,     // optional, ISO 639-1
  "country": null,         // optional, ISO 3166-1 alpha-2
  "safesearch": null,      // optional: "off"|"moderate"|"strict"
  "clean": true            // default true (QVAC cleaning)
}
```

Also accepts `GET /search?q=...&n=...&freshness=...&search_lang=...&country=...&safesearch=...`.

Response:
```json
{
  "query": "string",
  "brave_endpoint": "web",
  "freshness": null,
  "total_results": 3,
  "model": "QWEN3_600M_INST_Q4|null",
  "cleaned": true,
  "brave_ms": 423,
  "total_clean_ms": 1240,
  "results": [
    {
      "url": "string",
      "title": "string",
      "description": "string|null",
      "page_age": "ISO8601|null",
      "age": "string|null",
      "language": "string|null",
      "source": "string|null",
      "extra_snippets": ["string", ...],
      "cleaned_markdown": "string|null",
      "clean_ms": 42
    }
  ]
}
```

#### POST /news — current behavior

Request: same as `/search` minus `country`/`safesearch`/`extra_snippets`. **Defaults differ:** `n_results` default 5, clamped [1, **50**]. `freshness` defaults to `"pw"` (past week).

Response: shape identical to `/search` plus `"type": "news"`.

#### POST /context — current behavior

Request: only `query`, `n_results` (default 3, clamped **[1, 10]**), `freshness`. Brave returns *fewer* results than requested (count=10 → ~7 typical) — this is expected.

Response shape:
```json
{
  "query": "string",
  "type": "context",
  "brave_endpoint": "llm/context",
  "freshness": null,
  "total_results": 5,
  "model": "QWEN3_600M_INST_Q4|null",
  "brave_ms": 510,
  "total_clean_ms": 8400,
  "results": [
    {
      "url": "string",
      "title": "string",
      "snippet_count": 12,           // 2-28 per source
      "cleaned_markdown": "string|null",
      "clean_ms": 1700
    }
  ]
}
```

#### GET /health — current

```json
{ "status": "ok", "version": "0.2.2", "qvac_available": true, "model_loaded": false }
```

### §5.2 v0.3 additions to existing endpoints

Added to `/search`, `/news`, `/context` requests (all optional):

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `corpus_first` | bool | `true` | try corpus before Brave |
| `corpus_only` | bool | `false` | never hit Brave |

Added to `/search`, `/news`, `/context` responses:

| Field | Type | Notes |
|-------|------|-------|
| `source` | `"corpus"\|"brave"\|"hybrid"` | top-level: where the response came from |
| `corpus_ms` | `number\|null` | `null` if corpus not queried |
| `results[].source` | `"corpus"\|"brave"` | per-result origin |

> `brave_ms` becomes `null` if `corpus_only: true` AND the corpus fully satisfied the query.

### §5.3 New endpoints (v0.3)

#### POST /index

Triggers crawl + index for a URL.

Request:
```json
{
  "url": "string",       // required, http(s)://
  "depth": 1,            // default 1 (single page); max 3 (1 = single, 2 = follow links, 3 = 2 hops)
  "namespace": "user"    // default "user"; "builtin" reserved
}
```

Response (HTTP 202 Accepted):
```json
{
  "job_id": "uuid-v4",
  "status": "queued",
  "url": "string",
  "namespace": "string",
  "queued_at": "ISO8601"
}
```

#### GET /index/:job_id

Response:
```json
{
  "job_id": "uuid-v4",
  "status": "queued|running|done|failed",
  "pages_crawled": 12,
  "pages_indexed": 12,
  "error": "string|null",
  "started_at": "ISO8601|null",
  "finished_at": "ISO8601|null"
}
```

#### GET /corpus/stats

Response:
```json
{
  "total_documents": 1250,
  "namespaces": { "builtin": 850, "user": 400 },
  "meilisearch_size_mb": 45,
  "qdrant_vectors": 1250,
  "last_crawled_at": "ISO8601|null"
}
```

#### GET /health (v0.3 extended)

```json
{
  "status": "ok",
  "version": "0.3.0",
  "qvac_available": true,
  "model_loaded": true,
  "embed_loaded": true,
  "corpus": {
    "meilisearch": "ok|degraded|unavailable",
    "qdrant": "ok|degraded|unavailable"
  }
}
```

`degraded` = service responds but slow (ping >200ms). `unavailable` = ECONNREFUSED or 5xx. **`status` stays `"ok"` even if corpus is unavailable** — server falls back to Brave-only.

### §5.4 x402 payment flow (interface locked in v0.3, enforced in v0.4)

**Real protocol** (verified at `github.com/x402-foundation/x402`):

```
Agent → POST /search                              (no payment)
Server → 402 Payment Required
         X-PAYMENT-REQUIRED: <base64(PaymentRequiredObject)>
                              { network, asset, amount, recipient, ... }

Agent  → POST /search
         X-PAYMENT-SIGNATURE: <base64(PaymentPayload)>

Server → 200 OK
         X-PAYMENT-RESPONSE: <base64(SettlementResponse)>
         { ... search results ... }
```

> Header names are **case-sensitive on the wire when implementing** (HTTP normalizes to lowercase on most clients). Use the exact strings `X-PAYMENT-REQUIRED`, `X-PAYMENT-SIGNATURE`, `X-PAYMENT-RESPONSE`.

**Middleware skeleton (`src/x402/middleware.js`):**
```javascript
// Wraps a node:http (req, res) handler with x402 enforcement.
// In v0.3: X402_ENABLED=false → unconditionally passes through.
// In v0.4: X402_ENABLED=true → validates X-PAYMENT-SIGNATURE on-chain via x402 SDK.
export function requirePayment (handler, opts = {}) {
  // opts: { priceUsdt, recipient, network, skipIf }
  // skipIf: (req) => bool  — allowlist (e.g. dev mode, CORS preflight, /health)
  return async function (req, res) { /* ... */ }
}

// Verify a payment signature against the x402 facilitator.
// Returns: { valid: bool, amount: string, from: string, txHash: string|null }
export async function verifyPayment (signature, opts = {}) { /* ... */ }
```

**Env vars (added in v0.4):**
```
X402_ENABLED=false                 # default false in v0.3
X402_PRICE_USDT=0.01
X402_RECIPIENT=0x...               # wallet receiving payment
X402_NETWORK=base                  # base|polygon|arbitrum|world|solana
X402_FACILITATOR_URL=https://...   # Coinbase CDP default
COINBASE_CDP_KEY=...               # if facilitator=coinbase
```

---

## §6. Plugin Interfaces

JS lacks abstract classes — use base classes that throw on `not implemented`.

### `src/backends/interface.js`

```javascript
export class SearchBackend {
  get name () { return 'unnamed' }
  // Returns SearchResult[]
  async search (query, opts = {}) { throw new Error('not implemented') }
}

// opts: { n_results, freshness, search_lang, country, safesearch }
// SearchResult: { url, title, description, extra_snippets[], age, page_age, language, source }
```

Implementations in v0.3:
- `src/backends/brave.js` — extracted from `server.js` (zero behavior change vs v0.2.2)
- `src/backends/searxng.js` — NEW; `SEARXNG_URL` env var

### `src/clean/interface.js`

```javascript
export class Cleaner {
  get name () { return 'passthrough' }
  async clean (item) { return item.description || '' }   // SearchResult → string
}
```

Implementations:
- `src/clean/qvac.js` — extracted from `server.js` (preserves `inferLock` + 45s timeouts)
- `src/clean/passthrough.js` — NEW; returns raw description for `clean: false` path

### `src/corpus/interface.js`

```javascript
export class CorpusBackend {
  get name () { return 'unnamed' }
  async index (doc) { throw new Error('not implemented') }    // → void
  async search (query, opts = {}) { return [] }               // → SearchResult[]
  async stats () { return { total: 0 } }
}

// doc: { id, title, url, text, namespace, crawled_at }
// id: URL is the canonical ID (so re-indexing the same URL replaces, not duplicates)
```

Implementations:
- `src/corpus/meilisearch.js` — full-text index
- `src/corpus/qdrant.js` — vector index

### `src/embed/interface.js`

```javascript
export class Embedder {
  get name () { return 'unnamed' }
  get dim () { return 0 }                              // vector dimensions
  async embed (text) { throw new Error('not implemented') }    // → number[]
  async embedBatch (texts) {                                   // → number[][]
    return Promise.all(texts.map(t => this.embed(t)))
  }
}
```

Implementations:
- `src/embed/qvac.js` — uses `@qvac/sdk` 0.9.1 embedding API (verify constant name on upgrade)

### Query routing rule (in `src/server.js` `handleSearch`)

```javascript
// Pseudocode
if (corpus_first && corpus available) {
  const corpusHits = await Promise.all([
    meili.search(query, { limit: n_results }),
    qdrant.search(await embedder.embed(query), { limit: n_results })
  ])
  const merged = dedupeByUrl(corpusHits.flat())
  if (merged.length >= n_results) return tag('corpus', merged.slice(0, n_results))
  if (corpus_only) return tag('corpus', merged)
  const braveHits = await brave.search(query, { n_results: n_results - merged.length })
  return tag('hybrid', dedupeByUrl([...merged, ...braveHits]))
}
return tag('brave', await brave.search(query, opts))
```

`dedupeByUrl`: Meilisearch wins ties (its score is BM25, generally more reliable than naive vector cosine for keyword queries).

---

## §7. File Map (v0.3 changes)

```
qsearch/
├── docker-compose.yml              NEW — Meilisearch + Qdrant + (optional) SearXNG
├── .env.example                    EDIT — add MEILISEARCH_URL, QDRANT_URL, SEARXNG_URL
├── package.json                    EDIT — add meilisearch + @qdrant/js-client-rest, bump @qvac/sdk
├── src/
│   ├── server.js                   EDIT — extract Brave/clean → backends/clean/, add corpus routing, new endpoints
│   ├── backends/
│   │   ├── interface.js            NEW
│   │   ├── brave.js                NEW — extracted from server.js (no behavior change)
│   │   └── searxng.js              NEW
│   ├── corpus/
│   │   ├── interface.js            NEW
│   │   ├── meilisearch.js          NEW
│   │   └── qdrant.js               NEW
│   ├── crawl/
│   │   ├── crawl4ai.js             NEW — Node→Python subprocess wrapper
│   │   └── crawl4ai_worker.py      NEW — Python entrypoint (uses crawl4ai SDK)
│   ├── embed/
│   │   ├── interface.js            NEW
│   │   └── qvac.js                 NEW — wraps @qvac/sdk embedding API
│   ├── clean/
│   │   ├── interface.js            NEW
│   │   ├── qvac.js                 NEW — extracted from server.js (preserve inferLock + timeouts)
│   │   └── passthrough.js          NEW
│   ├── x402/
│   │   └── middleware.js           NEW — passthrough until v0.4
│   ├── jobs/
│   │   └── store.js                NEW — in-memory job table for /index/:job_id (Map<uuid, jobState>)
│   ├── mcp.js                      KEEP AS-IS — only add tools if needed (corpus_index, corpus_stats)
│   └── mcp-http.js                 ⛔ DO NOT MODIFY — production MCP-over-HTTP server, port 8081, QVAC Workbench dependency
├── test/
│   ├── server.test.js              KEEP AS-IS — 46 tests must pass unchanged
│   ├── unit/
│   │   ├── backends/brave.test.js  NEW — extraction does not regress
│   │   ├── backends/searxng.test.js NEW
│   │   ├── corpus/meilisearch.test.js NEW
│   │   ├── corpus/qdrant.test.js   NEW
│   │   ├── crawl/crawl4ai.test.js  NEW (mock subprocess)
│   │   ├── embed/qvac.test.js      NEW (skip if !qvacAvailable)
│   │   ├── routing.test.js         NEW — corpus_first / corpus_only / hybrid dedup
│   │   └── x402/middleware.test.js NEW — passthrough behavior in v0.3
│   └── integration/
│       ├── corpus.integration.test.js  NEW — requires Docker
│       └── search.integration.test.js  NEW — requires Docker
└── docs/
    ├── ARCHITECTURE_V03.md         THIS FILE
    └── x402.md                     NEW (Phase 4) — full HTTP 402 flow + protocol diagram
```

> **DO-NOT-MODIFY list (live production):**
> - `src/mcp-http.js` — port 8081, used by QVAC Workbench Custom Integration. Breaking it breaks the WDK_tether-amplified demo.
> - `public/index.html`, `public/docs.md` — qsearch.pro front page; touch only if explicitly required.
> - `deploy/` — VPS Nginx config; out of scope.

---

## §8. Migration Path: v0.2.2 → v0.3

Each phase is a mergeable PR. Nothing breaks until Phase 2 (corpus read path), and even then `corpus_first: false` reverts behavior to v0.2.2 exactly.

### Phase 0 — Setup (zero-risk, 1 PR)

1. Add `docker-compose.yml`:
   ```yaml
   services:
     meilisearch:
       image: getmeili/meilisearch:v1.7
       ports: ["7700:7700"]
       environment: { MEILI_MASTER_KEY: masterKey }
       volumes: ["./data/meili:/meili_data"]
     qdrant:
       image: qdrant/qdrant:v1.17.1
       ports: ["6333:6333"]
       volumes: ["./data/qdrant:/qdrant/storage"]
   ```
2. Update `.env.example` with new vars
3. Bump `@qvac/sdk` to `^0.9.1` in `package.json`; `npm install`
4. `/health` reports `corpus.meilisearch: "unavailable"` if not running, but server starts normally
5. Acceptance: existing 46 tests pass; `docker compose up && /health` shows `corpus.meilisearch: "ok"`

### Phase 1 — Refactor without behavior change (1 PR)

Pure refactor, no new features:
1. Extract Brave fetch → `src/backends/brave.js`
2. Extract QVAC cleaning → `src/clean/qvac.js` (keep `inferLock`, 45s timeouts byte-for-byte)
3. Add base classes (`backends/interface.js`, `clean/interface.js`)
4. `src/server.js` shrinks ~200 lines, calls into new modules
5. Acceptance: existing 46 tests pass unchanged; manual curl returns identical JSON byte-for-byte

### Phase 2 — Corpus write path (1 PR)

1. Implement `src/corpus/meilisearch.js` (`index`, `search`, `stats`)
2. Implement `src/corpus/qdrant.js` (`index`, `search`, `stats`) — vectors via `src/embed/qvac.js`
3. Implement `src/embed/qvac.js` — wrap `@qvac/sdk` embedding (verify constant name on real install)
4. Implement `src/crawl/crawl4ai.js` + `crawl4ai_worker.py`:
   - Node spawns Python with `child_process.spawn('python3', [worker, '--url', url, '--depth', d])`
   - Python writes `{title, url, text}` to stdout as one JSON-per-line
   - Node parses, calls `corpus.index()` for each
5. Implement `POST /index` + `GET /index/:job_id` (in-memory job table; survives single process only — fine for v0.3)
6. Implement `GET /corpus/stats`
7. Acceptance: curl `/index` with `https://qvac.tether.io/dev/sdk` → `done` within 30s → corpus stats shows ≥1 doc

### Phase 3 — Corpus read path (1 PR)

1. Add `corpus_first` / `corpus_only` to `/search`, `/news`, `/context` request schemas
2. Implement routing in `handleSearch` (and `handleNews` if symmetric)
3. Add `source` and `corpus_ms` to responses
4. Hybrid merge: dedupe by URL, Meilisearch score wins ties
5. Performance gate: corpus query <10ms P95 on local Meilisearch (single-host benchmark)
6. Acceptance: integration test seeds corpus, queries `corpus_first: true` → result has `source: "corpus"` and `corpus_ms < 10`

### Phase 4 — SearXNG fallback + x402 skeleton (1 PR)

1. `src/backends/searxng.js` — query SearXNG `/search?q=...&format=json`
2. Routing: Brave 5xx or 429 → SearXNG (transparent to caller; same response shape)
3. `src/x402/middleware.js` — passthrough impl with `X402_ENABLED=false` default
4. Write `docs/x402.md` — protocol diagram, env vars, expected v0.4 behavior
5. Acceptance: `BRAVE_API_KEY=invalid` + `SEARXNG_URL=...` → results still arrive; `requirePayment` is importable

---

## §9. 13-Week Phase Breakdown (B Steady, 5–7 h/week)

> Budget: 5h × 13w = 65h baseline; 7h × 13w = 91h stretch. **Reranker explicitly excluded** (see §1 Q2). FastMCP migration explicitly excluded (Q3).

| Wk | Phase | Deliverable | Est. h | Acceptance criterion |
|----|-------|-------------|--------|----------------------|
| 1 | 0 | `docker-compose.yml` + `.env.example` + `@qvac/sdk` bump + `/health` corpus fields | 5 | `docker compose up`; `/health` shows `corpus.meilisearch: "ok"`; 46 existing tests pass |
| 2 | 1 | Refactor: extract `backends/brave.js` + `clean/qvac.js` + base interfaces | 6 | 46 existing tests pass; manual curl `/search` returns byte-identical JSON to pre-refactor |
| 3 | 2 | `corpus/meilisearch.js` (index + search + stats) + unit tests | 6 | Unit test: index 3 docs → `search("qvac")` returns the matching URL; stats reflects 3 |
| 4 | 2 | `embed/qvac.js` + `corpus/qdrant.js` (vector index + search) | 7 | Unit test: embed 3 docs → vector search of similar query returns the closest doc with cosine ≥0.7 |
| 5 | 2 | `crawl/crawl4ai.js` + `crawl4ai_worker.py` (subprocess wrapper) | 6 | `crawl("https://qvac.tether.io/dev/sdk", depth=1)` returns `{title, url, text}` with text ≥500 chars |
| 6 | 2 | `POST /index` + `GET /index/:job_id` + `jobs/store.js` | 6 | Curl `/index` → poll → `status: "done"` within 30s; subsequent `/search` finds the indexed page in corpus |
| 7 | 2 | Builtin corpus seed: see §10 — QVAC + Tether + HyperDHT + x402 (≥100 pages) | 7 | `/corpus/stats` shows `namespaces.builtin ≥ 100` |
| 8 | 3 | Routing in `handleSearch` (corpus_first / corpus_only / hybrid merge) | 6 | Search "qvac sdk install" → `source: "corpus"`, `corpus_ms <10`; search "weather Tokyo" → `source: "brave"` |
| 9 | 3 | Same routing for `/news` + `/context` + `source` per result | 5 | `/news?corpus_first=true` works; per-result `source` correct in mixed responses |
| 10 | 4 | `backends/searxng.js` + Brave 429/5xx fallback | 5 | Set `BRAVE_API_KEY=invalid` + `SEARXNG_URL=...` → results still arrive |
| 11 | 4 | `x402/middleware.js` skeleton + `docs/x402.md` + integration tests | 6 | `requirePayment` importable; `X402_ENABLED=false` is true passthrough; doc has correct header names |
| 12 | — | Test coverage round: integration tests; perf check (corpus P95 <10ms) | 6 | `autocannon -d 10 -c 5` against `/search?corpus_first=true` shows P95 <10ms for seeded queries |
| 13 | — | README + setup guide + tag v0.3.0 + release notes + announcement tweet | 5 | `git clone && docker compose up && npm install && npm start` works on a fresh machine |

**Total: 76 hours** — fits 5h baseline (76 ≤ 65 + 11 buffer), comfortable at 6h average.

---

## §10. Builtin Corpus Seed (concrete URLs)

Seed namespace `"builtin"` with these — all permissive licensing or canonical docs:

| Source | URL | Why |
|--------|-----|-----|
| QVAC SDK docs | `https://qvac.tether.io/dev/sdk` | core qsearch dependency story |
| QVAC repo README | `https://github.com/tetherto/qvac` | code-level reference |
| Tether USDT docs | `https://tether.io/news/` | USDT/Tether ecosystem |
| WDK | `https://github.com/tetherto/wdk` | Tether's Wallet Dev Kit (x402 v0.4 narrative) |
| Holepunch docs | `https://docs.holepunch.to/` | HyperDHT, Hyperswarm, Hypercore |
| HyperDHT | `https://github.com/holepunchto/hyperdht` | repo + protocol notes |
| x402 spec | `https://github.com/x402-foundation/x402` | x402 v0.4 prep |
| x402 awesome | `https://github.com/xpaysh/awesome-x402` | x402 ecosystem map |
| LayerZero | `https://docs.layerzero.network/` | cross-chain context |
| Brave Search API docs | `https://api-dashboard.search.brave.com/app/documentation` | qsearch's own backend |

Crawl with `depth=2` for docs sites (catches sub-pages) and `depth=1` for README files. Expected total ≥100 pages.

---

## §11. Test Strategy

### §11.1 Stick with what's there

The repo uses Node.js native `node:test` + `node:assert/strict`. Tests spawn the server in a child process and intercept Brave via `BRAVE_BASE_URL` env var pointing at a mock HTTP server. **Use the same pattern** for new tests — no jest, no vitest, no testcontainers-node (Docker is launched outside the test process).

Reference: `test/server.test.js` shows the pattern (mock Brave responses for `web` / `news` / `llm/context`, spawn server, curl, assert response shape).

### §11.2 Unit tests (`test/unit/`) — no external services

| File | Mocks | Asserts |
|------|-------|---------|
| `backends/brave.test.js` | mock Brave HTTP | extracted module returns same shape as old inline code |
| `backends/searxng.test.js` | mock SearXNG HTTP | response normalized to `SearchResult` shape |
| `corpus/meilisearch.test.js` | mock Meilisearch HTTP **OR** require local Docker (mark with `t.skip` if `MEILISEARCH_URL` unset) | index → search round-trip |
| `corpus/qdrant.test.js` | same pattern as Meilisearch | embed → index → vector search |
| `crawl/crawl4ai.test.js` | mock `child_process.spawn` to emit canned JSON-per-line | parser produces correct doc objects |
| `embed/qvac.test.js` | skip if `!qvacAvailable` (no bare-runtime binary) | embedding returns `number[]` of expected dim |
| `routing.test.js` | mock all backends | corpus_first / corpus_only / hybrid logic + URL dedup |
| `x402/middleware.test.js` | none | `X402_ENABLED=false` is true passthrough |

### §11.3 Integration tests (`test/integration/`)

Require `docker compose up` running. CI sets up service containers. Skip if env vars not set (graceful degradation in test runner).

| File | Asserts |
|------|---------|
| `corpus.integration.test.js` | crawl → index → corpus search returns the indexed URL |
| `search.integration.test.js` | seed 3 docs; query → `source: "corpus"`, `corpus_ms < 50` |

### §11.4 CI additions (`.github/workflows/test.yml`)

```yaml
services:
  meilisearch:
    image: getmeili/meilisearch:v1.7
    ports: ['7700:7700']
    env:
      MEILI_MASTER_KEY: masterKey
  qdrant:
    image: qdrant/qdrant:v1.17.1
    ports: ['6333:6333']
env:
  MEILISEARCH_URL: http://localhost:7700
  MEILISEARCH_KEY: masterKey
  QDRANT_URL: http://localhost:6333
```

### §11.5 Manual E2E checklist

- [ ] Cold boot: `git clone && docker compose up -d && npm install && npm start` works on fresh OS
- [ ] `corpus_first: true` for seeded query → result has `source: "corpus"` and `corpus_ms < 10`
- [ ] Query not in corpus → falls back to Brave (`source: "brave"`, `brave_ms` populated)
- [ ] Stop Meilisearch container → `/health.corpus.meilisearch = "unavailable"`, `/search` still works (Brave path)
- [ ] `BRAVE_API_KEY=invalid` + `SEARXNG_URL=...` → search succeeds via SearXNG
- [ ] `POST /index` URL → poll `/index/:job_id` → `done` → `/search` finds it in corpus
- [ ] All 46 v0.2.2 tests in `test/server.test.js` pass unchanged
- [ ] `src/mcp-http.js` server starts on :8081, QVAC Workbench connects, `web_search` tool returns results

---

## §12. Acceptance Criteria

### v0.3.0 ships when **all** are true:

1. ✅ `POST /index` + `GET /index/:job_id` + `GET /corpus/stats` work end-to-end
2. ✅ `/search` `corpus_first: true` returns corpus results in **<10ms P95** for seeded topics
3. ✅ All 46 v0.2.2 tests in `test/server.test.js` pass unchanged
4. ✅ `/health` does not crash if Meilisearch / Qdrant down (returns `"degraded"` or `"unavailable"`)
5. ✅ Hybrid merge: zero duplicate URLs in any response
6. ✅ SearXNG fallback works when `BRAVE_API_KEY` invalid (and `SEARXNG_URL` set)
7. ✅ `src/x402/middleware.js` is importable; `X402_ENABLED=false` is true passthrough
8. ✅ `npm test` green including new unit tests; integration tests pass when `docker compose up`
9. ✅ `src/mcp-http.js` byte-identical to v0.2.2 (no risk to QVAC Workbench integration)
10. ✅ README updated; setup works on a clean Windows + Linux + macOS machine

### v0.4.0 ships when:

- `X402_ENABLED=true` enforces 402 flow with real headers (`X-PAYMENT-REQUIRED`, `X-PAYMENT-SIGNATURE`, `X-PAYMENT-RESPONSE`)
- Agent paying 0.01 USDT receives results
- Verification adds <500ms latency
- Missing/invalid signature returns HTTP 402 with correct headers

---

## §13. If Tim Picks Option A (`@qvac/rag` instead of Meilisearch+Qdrant)

Apply this diff to the spec above:

- §3 Layer Map: drop Meilisearch + Qdrant; add `@qvac/rag ^0.4.4`, `corestore`, `hyperbee`
- §4: drop `meilisearch` + `@qdrant/js-client-rest`; add `@qvac/rag@^0.4.4`
- §6: replace `CorpusBackend` interface with direct use of `@qvac/rag`'s `RAG` class:
  ```javascript
  import { RAG, HyperDBAdapter } from '@qvac/rag'
  import Corestore from 'corestore'
  const store = new Corestore('./data/corpus')
  const rag = new RAG({
    embeddingFunction: async (text) => embedder.embed(text),  // src/embed/qvac.js
    dbAdapter: new HyperDBAdapter({ store })
  })
  // ingest:  await rag.ingest([text1, text2], { chunk: true })
  // search:  await rag.search(query, { topK: n_results })
  ```
- §7: drop `src/corpus/meilisearch.js` + `qdrant.js`; add `src/corpus/qvac_rag.js` (thin adapter to `RAG` class)
- §8 Phase 2: collapses (one corpus impl instead of two) — frees ~1 week
- §9 schedule: drop weeks 3–4 (Meilisearch + Qdrant), add 1 week for `@qvac/rag` integration → schedule shrinks to 11 weeks
- §10 corpus seed: same URLs
- §11: drop Meilisearch/Qdrant integration tests; add `@qvac/rag` integration test (no Docker needed — Corestore is in-process)
- Bonus: `docker-compose.yml` only needs SearXNG (or can be skipped entirely) — fewer moving parts
- v1.0 P2P story: `@qvac/rag` already uses Corestore → enabling P2P sync becomes a config flip rather than a re-architecture

---

## §14. Environment Variables (full list)

```bash
# v0.2.2 — unchanged
BRAVE_API_KEY=...                    # required
PORT=8080
BRAVE_BASE_URL=https://api.search.brave.com  # tests override this to point at mock
MCP_PORT=8081                        # for src/mcp-http.js
MCP_HOST=0.0.0.0
QSEARCH_URL=http://localhost:8080    # MCP wrapper points at REST server

# NEW in v0.3
MEILISEARCH_URL=http://localhost:7700
MEILISEARCH_KEY=masterKey            # dev default; rotate for prod
QDRANT_URL=http://localhost:6333
SEARXNG_URL=                         # optional; if unset, no Brave fallback
CORPUS_FIRST=true                    # request-level default if field omitted
CRAWL_CONCURRENCY=3                  # max parallel crawl4ai workers
CRAWL_TIMEOUT_MS=60000               # per-page timeout

# v0.4 — add when implementing
X402_ENABLED=false
X402_PRICE_USDT=0.01
X402_RECIPIENT=0x...
X402_NETWORK=base
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/x402
COINBASE_CDP_KEY=...
```

---

## §15. Risk Register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | `@qvac/sdk` 0.9.1 embedding API differs from assumed | 🔴 High | Phase 0: write a 5-line script that `import('@qvac/sdk')` and prints exported keys. Update §4 + `src/embed/qvac.js` accordingly **before** Phase 2 starts. |
| R2 | Crawl4AI subprocess fails on Windows (Python path issues) | 🟡 Medium | Use `python3` on Linux/Mac, `python` on Windows; test on Tim's Windows 11 box. Skip Crawl4AI in tests if `python --version` fails. |
| R3 | Meilisearch JS client `^0.57.0` breaks against Meilisearch server `v1.7` | 🟡 Medium | Pin both versions; add CI smoke test that runs against `getmeili/meilisearch:v1.7`. |
| R4 | Qdrant JS client `^1.17.0` breaks against Qdrant `v1.17.1` (release notes mention gRPC format change) | 🟡 Medium | Use REST client (already what `@qdrant/js-client-rest` is — not gRPC). Pin server to `v1.17.1`. |
| R5 | Embedding model adds 25s+ to first `/search` (cold start) | 🟢 Low | Warm both models (clean + embed) at startup like `warmModel()` does. Document expected first-request latency. |
| R6 | `src/mcp-http.js` accidentally modified, breaking QVAC Workbench | 🔴 High | DO-NOT-MODIFY callout in §7 + this risk register. Add CI guard: `git diff origin/main src/mcp-http.js` → fail if non-empty unless commit message contains `[mcp-http]`. |
| R7 | Bare runtime missing on contributor's machine → `qvacAvailable=false` permanently | 🟢 Low | Already handled in v0.2.2 (graceful degrade). New embed pipeline must use same `_hasBareRuntime` check. |
| R8 | Corpus storage grows unbounded in `./data/` | 🟡 Medium | v0.3 deliberately accepts this (single-tenant local-first). Add `data/` to `.gitignore`. Document expected size in README. |
| R9 | x402 `^1.2.0` API changes before v0.4 (it's young) | 🟢 Low | Don't import x402 until v0.4 phase starts. Re-verify version then. |
| R10 | Windows file paths break `crawl4ai_worker.py` invocation | 🟡 Medium | Use `path.join` and pass paths explicitly; spawn with `shell: false` to avoid quoting issues. |

---

## §16. What's Verified vs Assumed (calibration table)

| Claim | Status | Source |
|-------|--------|--------|
| `meilisearch` npm = 0.57.0 | ✅ Verified 2026-04-26 | `npm view meilisearch version` |
| `@qdrant/js-client-rest` npm = 1.17.0 | ✅ Verified 2026-04-26 | `npm view @qdrant/js-client-rest version` |
| `crawl4ai` PyPI = 0.8.6 (released 2026-03-24) | ✅ Verified 2026-04-26 | `pypi.org/pypi/crawl4ai/json` |
| `@qvac/sdk` latest = 0.9.1 (3 days ago) | ✅ Verified 2026-04-26 | `npm view @qvac/sdk version` |
| `@qvac/embed-llamacpp` exists (v0.14.0) and is transitive dep of `@qvac/sdk` | ✅ Verified 2026-04-26 | `npm view @qvac/sdk` deps + `npm view @qvac/embed-llamacpp` |
| `@qvac/rag` exists (v0.4.4) with described API | ✅ Verified 2026-04-26 | `npm view @qvac/rag` + WebFetch of repo README |
| `x402` npm = 1.2.0, official Coinbase | ✅ Verified 2026-04-26 | `npm view x402` (maintainers @coinbase.com) |
| x402 headers = `X-PAYMENT-REQUIRED` / `X-PAYMENT-SIGNATURE` / `X-PAYMENT-RESPONSE` | ✅ Verified 2026-04-26 | WebFetch `github.com/x402-foundation/x402/main/README.md` |
| Qdrant server `v1.17.1` (Mar 27 2026) | ✅ Verified in Step 2 research synthesis | `research/best-of-breed-components.md` |
| FastMCP v3.2.4 / 24.8k stars | ✅ Verified in Step 2 (excluded from v0.3 by design) | `research/best-of-breed-components.md` |
| Tantivy lacks Node.js bindings | ✅ Verified in Step 2 (excluded; Meilisearch chosen) | `research/best-of-breed-components.md` |
| Ollama CVE-2026-5757 unpatched | ✅ Verified in Step 2 disconfirming sweep | `research/best-of-breed-components.md` |
| `@qvac/sdk` 0.9.1 embedding API surface (exact constant name for Qwen3-Embedding) | ⚠️ **Assumed** | NOT verified by reading 0.9.1 source. Phase 0 must verify. See R1. |
| Crawl4AI `0.8.6` Python API (exact entry point + output shape) | ⚠️ **Assumed** | Spec assumes write to stdout JSON-per-line. Check Crawl4AI 0.8.6 docs before Phase 2. |
| SearXNG `latest` Docker tag stable | ⚠️ **Assumed** | Pin a date-tagged image when implementing. |
| Meilisearch `v1.7` ↔ `meilisearch ^0.57.0` JS client compatibility | ⚠️ **Likely OK** | Meilisearch SemVer is generally backwards compatible; smoke test in Phase 0. |

> **Rule for the implementing model:** if you encounter a `⚠️ Assumed` row that materially affects the implementation, STOP and verify before proceeding. Don't fabricate.

---

## §17. Out of Scope for v0.3 (deliberate)

Listed so the implementing model doesn't add them speculatively.

- ❌ **Reranker** (bge-reranker-v2-m3) — defer to v0.5
- ❌ **FastMCP** (Python) — keep current Node.js MCP wrapper
- ❌ **HyperDHT P2P** — v1.0 deliverable; v0.3 is single-node
- ❌ **x402 enforcement** — v0.4; v0.3 ships skeleton only
- ❌ **Ollama backend** — CVE-2026-5757 unpatched, never recommend
- ❌ **WebUI changes** — `public/index.html` and `public/docs.md` untouched
- ❌ **MCP tool additions beyond corpus tools** — current tools (`web_search`, `news_search`, `context_search`) gain `corpus_first` param via passthrough; do not add new tool names unless explicitly required
- ❌ **Authentication / auth headers** — no API key on qsearch itself in v0.3 (BYOK Brave is the only credential)
- ❌ **Rate limiting** — out of scope; production already has Nginx in front
- ❌ **OpenTelemetry / metrics** — defer
- ❌ **Persistent job store** — `/index` jobs live in memory; restart wipes job table (URLs already indexed survive in Meilisearch/Qdrant)
- ❌ **Multi-tenant namespaces beyond `builtin` and `user`** — defer

---

*Architecture spec author: Claude (Opus 4.7) for Tim Mamatov, 2026-04-26. Verify §16 before delegating implementation.*
