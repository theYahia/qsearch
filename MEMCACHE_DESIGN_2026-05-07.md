# qsearch memcache — Design Doc

> **Дата:** 2026-05-07 · **Статус:** DRAFT (design only, not implemented) · **Owner:** Yahia
> **Cross-ref:** rd101 (research-debt #101). Pattern reference — `D:/Yahia/active/claude-webcache/`.

## 1. Problem Statement

qsearch (`localhost:8080`, `/sweep` endpoint) — primary secondary backend в DUAL SWEEP правиле (см. `D:/Yahia/CLAUDE.md` §4). Каждый heavy-max research sprint прогоняет 200-300 queries × 20 results × multi-engine → ~600K-1.5M raw tokens fetched от Brave/SearXNG за sprint. Текущий corpus (Meilisearch + Qdrant) индексирует **результаты по URL**, но **не самих query→results pairs**. Когда новый sprint задаёт похожий или идентичный запрос — он повторно платит API-cost (Brave: $5/1000 queries) и tokens на парсинг snippets.

**Замер cross-sprint overlap (5 последних sprints, 2026-04 → 2026-05):**

- Exact phrase match queries.txt: ~5-10% (low — phrasings vary по sprint focus). **low-confidence**, без формального диффа.
- Phrase-level token overlap (jaccard 3-grams): visually 30-40% (HR-tech / AI / Россия / SaaS / pricing — cross-sprint recurring termset). **low-confidence**, не измерял script'ом.
- Sub-query reuse (same topic re-investigated через 2-4 нед): observed в jobseeker-ai-ru, networking-ru, gospomosh-* — Tinkoff/Yandex/Sber/HSE recurring entities.

**Goal:** prevent re-running identical (Phase 1) и semantically-equivalent (Phase 2) queries across sprints. Сохранить existing `/sweep` поведение default (preserves backward compat).

## 2. Caching Key Strategy

Двухфазный rollout:

### Phase 1 — Exact match (SHA256)

```
key = SHA256(normalize(query) + "|" + topic_or_global)
normalize(q) = q.toLowerCase().trim().replace(/\s+/g, " ")
```

- `topic` опционален (если задан — namespace cache по topic, иначе global).
- Quick win, deterministic, zero false positives.
- Estimated hit rate: **20-30%** (mostly from re-runs same sprint после crash, и manual re-ingestion). **low-confidence** — нужен реальный замер после deploy.

### Phase 2 — Semantic similarity (later, optional)

- Embed query via existing qsearch embedder (`LlamaCppEmbedder` или `qvac/sdk`, Qwen3-Embedding-0.6B 1024-dim).
- Lookup в Qdrant collection `query_cache` (cosine sim threshold ≥ 0.85).
- Estimated additional hit rate: **+15-20%** (cross-sprint paraphrases). **low-confidence**.
- Gotcha: semantic match даёт **похожие**, но не идентичные results — нужно явно помечать `match_type: "semantic"` в response, агент должен знать.

## 3. Storage Architecture

SQLite `~/.qsearch/cache/queries.db` (наследуем claude-webcache pattern: native `node:sqlite`, WAL mode, no native deps, Node 22.5+).

```sql
CREATE TABLE cached_queries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  query_hash    TEXT NOT NULL UNIQUE,        -- SHA256(normalized_query + "|" + topic)
  query_text    TEXT NOT NULL,                -- original query, для debug/audit
  topic         TEXT,                          -- optional namespace (e.g. "jobseeker-ai-ru")
  results_json  TEXT NOT NULL,                 -- gzip-compressed JSON (web results + engines[] + count)
  result_checksum TEXT NOT NULL,               -- SHA256(results_json) — детект corruption
  hit_count     INTEGER DEFAULT 0,
  captured_at   INTEGER NOT NULL,              -- unix ts
  last_used     INTEGER NOT NULL,
  ttl_days      INTEGER DEFAULT 30
);

CREATE INDEX idx_hash ON cached_queries(query_hash);
CREATE INDEX idx_captured ON cached_queries(captured_at);
CREATE INDEX idx_topic ON cached_queries(topic);
```

**TTL:** 30 дней default. Override per-row через `ttl_days` (для time-sensitive — news/market — можно ставить 7d).
**LRU eviction:** trigger при размере >1GB → удалить bottom 20% по `last_used`.
**Corruption detection:** `result_checksum` на read — mismatch → invalidate row, refetch.

## 4. API Endpoints (qsearch additions)

| Endpoint | Method | Behaviour |
|---|---|---|
| `POST /cached_sweep` | text/plain `label\|query` lines, `?topic=<name>&use_cache=true` | Per-query: check cache hit → return; miss → call existing sweep logic, store, return. Response includes `cache_meta: { hits: N, misses: M }`. |
| `GET /cache/stats` | — | `{ total_rows, total_size_bytes, hit_count_total, hit_rate_30d, oldest_captured }` |
| `POST /cache/invalidate` | `{ topic?: string, query_hash?: string, all?: boolean }` | Delete matching rows. Used после Brave API behavior change (e.g. snippet length increase 2026-04). |
| `GET /cache/list?topic=&limit=` | — | Recent cached queries (debug/inspection) |

**Backward compat:** existing `/sweep` поведение **не меняется**. Cache opt-in только через `/cached_sweep` или `/sweep?use_cache=true`.

## 5. Integration с brave_sweep.py

Канонический Brave-скрипт (`D:/Yahia/tools/research-backend/brave_sweep.py`) **не должен** трогать qsearch напрямую — он остаётся primary Brave path (paywalled grounding). Cache-aware path делается через qsearch:

- Опциональный flag `--use-cache` в `brave_sweep.py` (Phase 1.5, после qsearch ship'а cache):
  - When set: per-query сначала ходит на `qsearch:8080/cache/lookup?hash=<sha>`, если hit — заполняет `<label>.json` из cache и пропускает Brave call.
  - На miss — обычный Brave fetch + после успеха POST `qsearch:8080/cache/store` (write-through).
- **Default OFF.** Preserves existing dual-sweep semantic (Brave = primary fresh fetch).
- qsearch's own `/sweep` (SearXNG-based) получает cache integration first, brave_sweep — позже.

## 6. Token & Cost Savings Estimate

**Heavy-max sprint baseline (текущий, без cache):**

- 200-300 queries × ~3-5K tokens per query (web results + extra_snippets + occasional Context endpoint) = **600K-1.5M tokens fetched from Brave per sprint**
- Brave API cost: 200-300 queries × $0.005 = **$1-1.5 per sprint** (Brave Pro tier).
- Claude tokens consumed reading raw output (Phase 3-4 synthesis): ~50-100K tokens (1.6MB raw_data → triaged top sources). Without cache, Claude re-reads similar content cross-sprint.

**With Phase 1 cache (exact match, 25% hit rate — midpoint estimate, low-confidence):**

- Brave API savings: ~60-90 queries skipped × $0.005 = **$0.30-0.45 per sprint**
- Token savings: 25% × 600K-1.5M = **150K-375K tokens per heavy sprint**
- Claude downstream savings: hard to estimate — depends on whether agent reads cached results vs fresh. Conservative: **+50-100K Claude tokens saved** if cache returns identical results без re-triage.

**Monthly aggregate (5-10 heavy sprints/мес):**

- Brave API: $1.50-4.50/мес saved (small, but free).
- Claude tokens: 750K-3.75M tokens/мес saved.
- At Anthropic rates Sonnet 4.5 ~$3/1M input: **$2.25-11.25/мес**. Opus 4.7 ~$15/1M: **$11-56/мес**.
- **low-confidence** — упирается в реальный hit rate (Phase 1 может оказаться 10% а не 25% если phrasing varies сильнее чем кажется).

**Phase 2 (semantic match, +20% hit rate):** 2× Phase 1 savings. Адекватный target: **$5-25/мес sprint-wide aggregate** при 5-10 sprints/мес usage.

**Honest take:** для одного юзера экономия **не life-changing** ($5-25/мес ≪ time spent implementing). Реальная ценность — (а) consistency (same query → same results cross-sprint, deterministic synthesis), (б) corpus enrichment (cache rows становятся additional Meilisearch index source), (в) Demonstrable patterns reusable в claude-webcache-style productizing.

## 7. Implementation Effort

**1-2 нед part-time** (Yahia solo, 4-6h/нед):

- Week 1 (Phase 1): SQLite schema + migration script, `/cached_sweep` endpoint, integration tests, `--use-cache` flag в brave_sweep.py.
- Week 2 (Phase 1): `/cache/stats` + `/cache/invalidate` + LRU eviction job (cron-style 1×/day), monitoring dashboard в `/ui`, README updates.
- Phase 2 (deferred, 1-2 нед): Qdrant collection + semantic lookup + threshold tuning.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Stale data (cached results outdated после API change) | TTL 30d + manual `/cache/invalidate?topic=...` после known Brave/SearXNG changes (track в `qsearch/CHANGELOG.md`). |
| Cache poisoning (corrupt row → wrong results) | `result_checksum` + lazy-refetch on mismatch. |
| Memory growth unbounded | LRU eviction at 1GB threshold + cron prune of expired rows. |
| Phase 2 semantic match returns wrong cluster | Threshold conservative (0.85+), explicit `match_type` flag в response, агент должен учитывать. Sanity: A/B test 50 queries проверяя semantic-matched vs fresh-fetched относительность relevance. |
| Cache hides bugs в downstream synthesis | Bypass via `?use_cache=false` for debugging. Default `use_cache=false` в `/sweep` (cache opt-in). |
| SQLite file corruption на disk failure | WAL mode + ежедневный backup `~/.qsearch/cache/queries.db` в night-loop output (1-time per day, 50-200MB). |

## 9. Roadmap

- **Week 1 (Phase 1a):** SQLite schema + `/cached_sweep` exact match + write-through. Manual test 10 queries, верификация hit/miss flow.
- **Week 2 (Phase 1b):** `/cache/stats` + `/cache/invalidate` + `--use-cache` flag в brave_sweep.py. Dogfood на следующем heavy sprint, замер real hit rate.
- **Decision gate (после 2 sprints):** if hit rate ≥20% и no false positives — ship to qsearch v0.5.0. If <10% — re-evaluate, скорее всего exact-match value-add низкий, skip Phase 2.
- **Phase 2 (deferred, не commit'имся):** semantic similarity via Qdrant. Trigger: если Phase 1 hit rate в районе 15-25% (good enough exact, semantic даёт +20% поверх).

## 10. Out-of-scope

- **Cross-machine cache sharing** — single-user single-machine для начала. Federation (qsearch v0.5+ docs/FEDERATION_ARCHITECTURE.md упоминает) отдельный track.
- **Cache для `/search` endpoint** — single-query trust-weighted re-rank, малый объём, smaller win. Focus на `/sweep` где батчи 200+ queries.
- **News/Context endpoints** — short TTL (24h max), separate design later.
- **Encryption at rest** — local-only SQLite, juicer threats (laptop theft) не покрываются базовым design'ом.

---

**Не имплементируем сейчас.** Design гейт перед write code: подтвердить с юзером что target hit rate (>20%) realistic для его flow. Если hit rate будет 5-10% — feature не окупает 1-2 нед effort, парковать.
