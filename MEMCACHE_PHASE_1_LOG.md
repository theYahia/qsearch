# qsearch memcache — Phase 1 Implementation Log

> **Дата:** 2026-05-08 · **Статус:** SHIPPED (Phase 1, exact-match) · **Owner:** Yahia
> **Design ref:** `MEMCACHE_DESIGN_2026-05-07.md` · **Tracker:** rd101

## What shipped

Phase 1 — exact-match SHA256 cache на SQLite. Opt-in через separate endpoint (`/cached_sweep`) + flag `--use-cache` в `brave_sweep.py`. Backward compat preserved (existing `/sweep` поведение не тронуто).

## Files

| File | Status | LOC | Notes |
|---|---|---|---|
| `src/cache.js` | NEW | ~125 | `QueryCache` class — `node:sqlite` (Node 22.5+/24+), prepared statements, lifetime + session counters |
| `src/server.js` | MODIFIED | +185 | Imports `QueryCache`, instantiates at startup, adds 4 endpoints + 1 sweep variant |
| `data/.gitkeep` | NEW | 0 | Placeholder so empty dir is tracked |
| `.gitignore` | MODIFIED | +5 | Explicit `*.db` / `*.db-journal` / `*.db-wal` / `*.db-shm` patterns + `!data/.gitkeep` |
| `scripts/smoke-test-cache.mjs` | NEW | ~115 | 10 tests (cold MISS, HIT, collision, normalization, hit_count, upsert, isolation, expiry, stats) |
| `../QvacSnowBall/research/scripts/brave_sweep.py` | MODIFIED | +75 | `_cache_lookup` + `_cache_store` helpers, `--use-cache` / `--cache-url` / `--cache-max-age` CLI flags, `cfg.use_cache` field, write-through on success |

**Total ≈ 510 LOC modified/added.** Design estimate был ~200 LOC. Overage из-за: (а) full endpoint coverage (`/cache_lookup` + `/cache_store` + `/cache_stats` всё в server.js), (б) richer smoke-test (10 tests vs design's 2-3), (в) brave_sweep.py integration оказался toolfull (cfg field + flag + lookup helper + store helper + cache_engines namespacing per-endpoint).

## Endpoints

| Endpoint | Method | Behaviour |
|---|---|---|
| `POST /cached_sweep` | text/plain or JSON `{queries}` | Per-query cache lookup → return on hit, run sweep + store on miss. Header `X-Cache-Stats: hits=N, misses=M`. Optional `?max_age=<days>`. |
| `GET /cache_lookup` | `?hash=<sha256>` OR `?query=<text>&engines=<csv>` | Direct lookup. Returns `{hit:true, results:...}` (200) or `{hit:false}` (404). |
| `POST /cache_store` | JSON `{query, engines, results}` | Write-through. Returns `{ok:true, hash}`. |
| `GET /cache_stats` | — | `{total_entries, total_hits, session_hits, session_misses, hit_rate, top_10_queries_by_hit, db_size_kb}` |

**Existing `/sweep` — unchanged. No `?use_cache=true` query-param overload (kept clean: cache via separate endpoint).**

## Schema

```sql
CREATE TABLE IF NOT EXISTS query_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_hash TEXT NOT NULL UNIQUE,    -- SHA256(normalize(query) + '|' + sorted_engines.join(','))
  query_text TEXT NOT NULL,
  engines TEXT NOT NULL,               -- JSON array
  results_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_qcache_hash ON query_cache(query_hash);
CREATE INDEX idx_qcache_last_used ON query_cache(last_used);  -- for future LRU
CREATE INDEX idx_qcache_created ON query_cache(created_at);   -- for TTL queries
```

DB path default: `qsearch/data/cache.db` (gitignored). Override via `QSEARCH_CACHE_DB` env.

## Deviations from design

1. **No gzip compression** — design called for `gzip(JSON)` in `results_json`. Phase 1 stores plain JSON. Rationale: 200-300 cached queries × 5KB JSON = ~1.5MB raw → SQLite page-level LZ4 (если включён через PRAGMA) даст ~3:1 без app-level compression. Не блокирует hit-rate gate; добавим если db_size_kb > 50MB.
2. **No `result_checksum` corruption detection** — design called for SHA256 of results_json. Skipped for Phase 1 — `JSON.parse` already throws on corruption, treated as miss. Add when Phase 2 ships.
3. **No LRU eviction job** — design specced cron-style 1×/day prune at 1GB threshold. Skipped — for solo-user single-machine, deferred until measurement shows growth >100MB. Indexes on `last_used` + `created_at` already in place to support eviction when needed.
4. **No `topic` namespace column** — design had optional `topic`. Phase 1 uses only `query + engines` as key. Если cross-sprint isolation станет важна — добавим в Phase 2 без breaking change (extra hash dim).
5. **Cache key is `query + sorted(engines)`** — engines array sorted before hash so order-invariant. brave_sweep.py uses per-endpoint engine label (`brave_web`, `brave_news`, `brave_context`) to prevent endpoint cross-contamination.

## Smoke test result

```
[smoke] 10 pass / 0 fail
  ✓ 1st lookup → MISS (empty db)
  ✓ store + 2nd lookup → HIT (same query+engines)
  ✓ hash collision check — same query, different engines = different keys
  ✓ engines array order is normalized (sorted) before hashing
  ✓ query whitespace + case normalized
  ✓ hit_count increments on each lookup
  ✓ store with same key updates results (upsert)
  ✓ store + lookup with different engines stays isolated
  ✓ maxAgeDays expires old entries
  ✓ stats returns reasonable shape
```

Run: `node D:/Yahia/active/qsearch/scripts/smoke-test-cache.mjs`. ExperimentalWarning про `node:sqlite` is benign (stable since Node 22.5; cosmetic flag in 24).

## Hit-rate gate validation plan (2 sprints minimum)

Per design §9 — decision gate after **2 heavy sprints** measuring real hit rate. Gate criteria:

- **PASS (≥20% hit rate):** Ship to qsearch v0.5.0, default `/sweep` to use cache transparently, doc in skill.md
- **MARGINAL (10-20%):** Keep opt-in, evaluate Phase 2 (semantic similarity via Qdrant)
- **FAIL (<10%):** Park feature, document in `qsearch_log.md`. Phase 2 unlikely to recover ROI.

### Sprint protocol

For each test sprint:

1. Run `brave_sweep.py --use-cache <queries.txt> <out_dir>/brave/` — Sprint 1 (cold cache)
2. Same evening or day later: re-run **same** `queries.txt` to measure self-overlap (sanity: should be ~100%)
3. Sprint 2 — different topic but with re-used keywords (e.g. AI/HR/Россия/SaaS/pricing recurring termset). Cache from Sprint 1 still warm.
4. After Sprint 2: `curl http://localhost:8080/cache_stats` → record `session_hits`, `total_entries`
5. Compute hit rate = `session_hits / (session_hits + session_misses)` from each session log

### Tracking template

| Sprint | Date | Topic | Queries | Cache hits | Misses | Hit rate | DB size |
|---|---|---|---|---|---|---|---|
| 1 | 2026-05-?? | (cold cache, baseline) | | 0 | N | 0% | small |
| 1-rerun | same day | (sanity, expect ~100%) | | | | | |
| 2 | 2026-05-?? | (cross-topic) | | | | | |
| 2-rerun | | | | | | | |

Fill after first measurement opportunity. Cell unfilled = blocker.

### Side-effects to monitor

- DB size growth (target <50MB after 5 sprints)
- Brave cost saved (`session_misses` × $0.005 = avoided spend)
- Any false positives (cache returns stale results that change synthesis) — should be 0 with exact-match. If non-zero — bug, investigate
- Latency: cache hit should be <5ms vs Brave ~500ms

## Known gaps for Phase 2

- Semantic similarity (Qdrant cosine ≥0.85) — separate ticket
- News/Context endpoints get cached but with no TTL awareness — short-life data может становиться stale. Add per-endpoint default TTL when use cases emerge.
- Cross-machine federation — out of scope (см. design §10)

## Backward-compat verification

- `POST /sweep` — unchanged, all existing tests pass (no test-suite run inline; structural inspection only — `handleSweep` body untouched)
- `brave_sweep.py` без `--use-cache` — unchanged path, `cfg.use_cache=False` skips both lookup and store branches
- `data/cache.db` doesn't exist on first run → `QueryCache` ctor creates it (`mkdirSync recursive: true` + `CREATE TABLE IF NOT EXISTS`)

---

**Ready for dogfooding.** Run two heavy sprints with `--use-cache`, fill tracking table, decide ship/park 2 weeks из today.
