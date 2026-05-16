# qsearch v9.2 — Full 5-Tier Verification (rd239)

> **Дата:** 2026-05-10 · **Card:** rd239 «qsearch 5-tier economy stack — full verification + dogfood schedule»
> **Тип:** READ-ONLY smoke (no service restart, no docker mutation)
> **Cross-ref:**
> - rd045 baseline: `D:/Yahia/active/qsearch/V92_EFFECT_2026-05-10.md` (Marathon-1, 48% qsearch share на itchy-legs sprint)
> - rd101 future: `D:/Yahia/active/qsearch/MEMCACHE_DESIGN_REFRESH_2026-05-10.md` (Marathon-4, memcache Phase 1 ROI ревизирован vs 2026-05-07 baseline)
> - Policy: `D:/Yahia/CLAUDE.md` §4 (DUAL SWEEP) + §4.1 (priority routing)

## TL;DR (одним абзацем)

**Source-side ✅, daemon-side ❌.** Все 5 tier'ов (broad/focused/critical/local-context/cache) **присутствуют в `src/server.js` HEAD и `src/cache.js`** на main после 2 commit'ов 2026-05-09 (`119915a` economy stack + `410434a` memcache Phase 1). Однако **запущенный daemon не загрузил эти изменения** — `/cached_sweep`, `/cache_lookup`, `/cache_store`, `/cache_stats`, `/sweep_context`, `/economy_report` все возвращают `{"error":"not found"}` (HTTP 404). `/health` отдаёт `version: "0.4.0"`, `corpus.meilisearch=unavailable`, `corpus.qdrant=unavailable`. SearXNG (`localhost:8888`) тоже недоступен (timeout 2.2s) — поэтому даже legacy `/sweep` для broad query возвращает `_Failed: fetch failed_` за 8ms (graceful degrade). **Action: требуется restart qsearch daemon + поднять docker compose stack (Meilisearch + Qdrant + SearXNG) — но НЕ автономно** (per task constraint и CLAUDE.md правило hard gate). После рестарта — сделать reverify (Phase 2 этого doc'а) и снять baseline tier-1/2/3/4 + cache cold-start.

## 1. Verification matrix (5 tiers)

| Tier | Endpoint | Backend | Cost/call | Source присутствует? | Daemon отвечает? | Smoke verdict |
|---|---|---|---|---|---|---|
| **1** Broad | `POST /sweep` (priority=`broad` через `brave_sweep.py`) или прямой POST | SearXNG (`:8888`) | $0 | ✅ `server.js:1301` | ⚠️ 200 OK но fetch failed (SearXNG down) | **DEGRADED** |
| **2** Focused | `POST /search` или `brave_sweep.py` Brave web tier | Brave Search API web | ~$0.005 | ✅ `server.js:1285` | ✅ 200 OK (verified live в rd045 itchy-legs sprint: 73 brave web calls) | **OK** (косвенно, через rd045 baseline) |
| **3** Critical | Brave Context endpoint (auto при `priority=critical` в `brave_sweep.py`) | Brave Search API context | ~$0.01 | ✅ `server.js:1293` (`POST /context`) + `brave_sweep.py:1774` | ✅ 200 OK (verified live: 10 context calls на itchy-legs) | **OK** |
| **4** Local Context | `POST /sweep_context` (Qwen3-600M через node:llm) | qsearch local LLM | $0 | ✅ `server.js:1321`, handler `runSweepContext` (`sweep_context.js`), backend tag `qsearch_local` (`cache.js:22`) | ❌ 404 «not found» (running daemon — pre-119915a build) | **PRESENT but DAEMON STALE** |
| **5** Cache | `POST /cached_sweep`, `GET /cache_lookup`, `POST /cache_store`, `GET /cache_stats`, `GET /economy_report` | SQLite memcache (`~/.qsearch/cache/`?), TTL `web=7d / news=1d / context=30d` | $0 hit / passthrough miss | ✅ `server.js:1305-1326`, schema в `cache.js:46-80` (`query_cache` + `sprint_metrics` tables) | ❌ 404 на всех cache endpoints | **PRESENT but DAEMON STALE** |

### 1.1 Что доступно в source но не в daemon (delta)

Просмотр `src/server.js` HEAD показывает **6 новых endpoints** vs running daemon:

```
POST /cached_sweep        — line 1305 (Phase 1 memcache integration)
GET  /cache_lookup        — line 1309
POST /cache_store         — line 1313
GET  /cache_stats         — line 1317
POST /sweep_context       — line 1321 (Phase 3 local LLM, Tier 4)
GET  /economy_report      — line 1325 (Phase 5 — sprint metrics aggregation)
```

`brave_sweep.py` (`D:/Yahia/tools/research-backend/brave_sweep.py`) уже знает про priority routing:
- `VALID_PRIORITIES = {"broad", "focused", "critical"}` (line 516)
- broad queries POST'ятся в qsearch `/sweep` напрямую (line 556: `qsearch broad sweep` path)
- critical форсит Brave Context endpoint (line 1774)
- `--include-context-local` flag для Tier 4 (line 1564)

Так что **router code (Python) и backend (Node) оба готовы**. Только running Node process — pre-119915a snapshot.

## 2. Smoke results (run-by-run)

### Smoke 2.1 — `/health`

```bash
$ curl -s --max-time 5 http://localhost:8080/health
{"status":"ok","version":"0.4.0","qvac_available":false,"model_loaded":true,
 "embed_loaded":false,"corpus":{"meilisearch":"unavailable","qdrant":"unavailable"}}
```

**Verdict:** daemon up, **но**:
- `version: 0.4.0` — hardcoded в `server.js:1282`. Не отражает экономический stack (нет полевого `economy_stack: enabled` или подобного — gap для improvement: bump до `v0.5.0-alpha` после restart).
- `qvac_available: false` — local LLM модель не загружена. Tier 4 (`/sweep_context`) не сможет работать даже после restart, пока не подгрузим Qwen3-600M через QVAC stack.
- `corpus.meilisearch = unavailable` + `corpus.qdrant = unavailable` — docker compose не запущен (см. README §4: `docker compose up -d`).

### Smoke 2.2 — `POST /sweep` (Tier 1 broad)

Тестовый файл:
```
rd239_smoke|test query 2026 qsearch verification
```

```bash
$ curl -s --max-time 30 -X POST http://localhost:8080/sweep \
    -H "Content-Type: text/plain" --data-binary @/tmp/test_q.txt
[HTTP_STATUS] 200 · [TIME_TOTAL] 0.0077s · [SIZE] 454b

# qsearch sweep — 1 queries
**Config:** extra_snippets=on
**Endpoints used:** web
**Generated:** 2026-05-10T17:08:34.417Z

## rd239_smoke — "test query 2026 qsearch verification"
_Failed: fetch failed_

## Sweep summary
- Total queries: 1
- Web: 0 ok / 1 failed
```

**Verdict:** endpoint accessible (200 в 8ms), но **0 results** — graceful degrade при недоступном SearXNG. Это **разрешённое** поведение (не crash), но для actual research workflow tier 1 сейчас бесполезен. SearXNG (`localhost:8888`) probe: `000 in 2.23s` (connection refused → timeout).

### Smoke 2.3 — `GET /cache_stats` (Tier 5)

```bash
$ curl -s --max-time 5 http://localhost:8080/cache_stats
{"error":"not found"}
[HTTP] 404 · [TIME] 0.003s
```

**Verdict:** running daemon не знает про этот endpoint. Source присутствует (`server.js:1317`).

### Smoke 2.4 — `GET /cache_lookup?query=...&engines=brave_web` (Tier 5)

```bash
$ curl -s --max-time 5 "http://localhost:8080/cache_lookup?query=rd239+test+nonexistent&engines=brave_web"
{"error":"not found"}
[HTTP] 404 · [TIME] 0.001s
```

**Verdict:** ditto — endpoint не загружен. Source присутствует (`server.js:1309`).

### Smoke 2.5 — `POST /sweep_context` (Tier 4 local)

```bash
$ curl -s --max-time 60 -X POST http://localhost:8080/sweep_context \
    -H "Content-Type: application/json" \
    --data '{"urls":["https://example.com"],"focus_query":"what is example domain"}'
{"error":"not found"}
[HTTP] 404 · [TIME] 0.001s
```

**Verdict:** endpoint не загружен. Даже после restart этот tier не заработает без `qvac_available: true` (ставится через `model_loaded: true` после warmModel + QVAC stack init).

### Smoke 2.6 — `GET /economy_report?format=json` (Tier 5 reporting)

```bash
$ curl -s --max-time 5 "http://localhost:8080/economy_report?format=json"
{"error":"not found"}
[HTTP] 404
```

**Verdict:** endpoint не загружен. Source присутствует (`server.js:1325`). После restart — ожидается `{sprints: [], aggregate: {hits, misses, cost_realised, cost_baseline, savings_pct}}` (по дизайну `cache.js` `sprint_metrics` table).

## 3. Сводка по tier'ам

| Tier | Verified live? | Block reason |
|---|---|---|
| 1 (broad/SearXNG) | ⚠️ partial — endpoint работает, backend down | docker compose не запущен → SearXNG @ :8888 unreachable |
| 2 (focused/Brave web) | ✅ косвенно из rd045 itchy-legs (73 calls passed) | — |
| 3 (critical/Brave Context) | ✅ косвенно из rd045 itchy-legs (10 calls passed) | — |
| 4 (local Context/Qwen3-600M) | ❌ daemon stale + qvac model не загружен | requires restart + QVAC stack init |
| 5 (cache) | ❌ daemon stale | requires restart only (SQLite не нужен docker — `node:sqlite` нативный) |

## 4. Action items

### 4.1 BLOCKING — действия требуют user-confirmation (НЕ автономно)

| # | Action | Why | Risk |
|---|---|---|---|
| A1 | Restart qsearch daemon (kill node process + `npm start`) | Подгрузить commits 119915a + 410434a в running process. После restart — endpoints `/cached_sweep`, `/cache_*`, `/sweep_context`, `/economy_report` станут отвечать. | LOW — daemon без active sessions, restart 5-15s |
| A2 | `docker compose up -d` в `D:/Yahia/active/qsearch/` | Поднять Meilisearch + Qdrant + SearXNG. После — Tier 1 broad начнёт реально возвращать результаты, corpus заработает. | LOW — но требует Docker Desktop running |
| A3 | (Опц.) Загрузить QVAC + Qwen3-600M для Tier 4 | Local Context endpoint требует local LLM. Без него Tier 4 forever broken. | MEDIUM — может потребовать GGUF файл + warmup time + RAM ~1.5GB |

**Why not autonomous:** task constraint явно `READ-ONLY smoke tests, DO NOT restart qsearch / docker services`. Также по CLAUDE.md DUAL SWEEP hard gate (§4): qsearch и Brave **оба обязательны** перед любым Phase 2 sprint — но **поднимать backend → user должен явно сказать**, не агент сам.

### 4.2 NON-blocking — улучшения качества (можно делать после restart)

- **Bump `/health` version** до `0.5.0-alpha` (`server.js:1282`) с полем `economy_stack: { broad: true, focused: true, critical: true, local_context: <bool>, cache: true }` чтобы будущие smoke автоматически детектили stale daemon без угадывания по 404.
- **Document smoke recipe** в `qsearch/SMOKE.md` (8-10 curl команд) для воспроизведения rd239 одной командой `bash SMOKE.sh`.
- **Auto-detect SearXNG в `/health`** — `corpus` уже включает meilisearch/qdrant; добавить `searxng: 'ok'|'unavailable'` через short HEAD probe :8888 на startup.

## 5. Dogfood checklist (next 5 sprints)

После restart + docker compose up — track метрики на каждом heavy sprint'е по pattern из rd045:

### Per-sprint snapshot (что собирать)

| Метрика | Где взять | Когда снимать |
|---|---|---|
| Total queries (queries.txt lines) | `wc -l queries.txt` | До start |
| Priority breakdown (broad/focused/critical) | `brave_sweep.py --dry-run queries.txt` | До start |
| qsearch broad calls | `_raw_data/<topic>_<date>/brave/qsearch/*.md` count | После Phase 2 |
| Brave web calls | `_raw_data/<topic>_<date>/brave/*.json` (web tier) count | После Phase 2 |
| Brave Context calls | `_raw_data/<topic>_<date>/brave/*_context.json` count | После Phase 2 |
| Cache hits / misses | `GET /economy_report?topic=<topic>&format=json` → `aggregate.hits/misses` | После Phase 2 |
| qsearch share % | `(qsearch_broad + cache_hits) / total_calls * 100` | После Phase 2 |
| Brave $ saved | `cache_hits × $0.005 + qsearch_broad × $0.005` | После Phase 2 |
| Total $ realised | `GET /economy_report?topic=<topic>&format=json` → `aggregate.cost_realised` | После Phase 2 |

Append каждый snapshot в **`D:/Yahia/active/qsearch/V92_DOGFOOD_LOG_2026-05.md`** (создать при первом sprint'е). Format таблица:

```md
| Date | Sprint | Total | qs.broad | brave.web | brave.ctx | cache.hits | qs.share % | $ saved | $ realised |
|------|--------|-------|----------|-----------|-----------|------------|------------|---------|------------|
| 2026-05-1X | <topic> | 200 | 90 | 80 | 5 | 25 | 57.5% | $0.58 | $0.45 |
```

### Cumulative re-snap 2026-05-17 (W3)

После 5 sprint'ов (или 7 дней — что наступит раньше):

1. Aggregate `V92_DOGFOOD_LOG_2026-05.md` — total saved $/мес projection, qsearch share trend (растёт / падает / flat).
2. Compare vs rd045 baseline (48% qsearch share на itchy-legs):
   - Если W3 average ≥ 50% → v9.2 routing проявил себя сильнее предположения → memcache Phase 1 ROI **revise UP** в rd101.
   - Если W3 average ≤ 35% → routing pre-empts меньше чем ожидалось → memcache Phase 1 ROI **revise DOWN**, decision gate ужесточить.
3. Cache hit rate (после Phase 1 memcache ship):
   - ≥ 20% on Brave-tier → ✅ ship stable per rd101 §5
   - 10-20% → 🟡 park
   - < 10% → ❌ kill
4. Decision tree update в `MEMCACHE_DESIGN_REFRESH_2026-05-10.md` § 3.

### Reminder cadence

- Каждый sprint: append row в DOGFOOD_LOG (1-2 минуты per sprint)
- 2026-05-17 (W3): re-snap doc + decide (15-30 минут)
- 2026-05-31 (W5): второй re-snap, считать data достаточной для memcache Phase 1 ship/kill decision

## 6. Cross-references

- **rd045** (Marathon-1 baseline): `D:/Yahia/active/qsearch/V92_EFFECT_2026-05-10.md` — itchy-legs sprint live data, 48% qsearch share, 27 parsed_snippets warnings (gap для отдельной investigation).
- **rd101** (Marathon-4 memcache refresh): `D:/Yahia/active/qsearch/MEMCACHE_DESIGN_REFRESH_2026-05-10.md` — Phase 1 ROI revised down ~33% после v9.2, ship recommended (5+ sprints/мес user pacing).
- **Original memcache design**: `D:/Yahia/active/qsearch/MEMCACHE_DESIGN_2026-05-07.md` — schema, endpoints (READ-ONLY base).
- **Policy**: `D:/Yahia/CLAUDE.md` §4 (DUAL SWEEP — оба backend'а обязательны), §4.1 (Phase 2 priority routing — broad/focused/critical tier rules), §4.5 (night-loop OFFLOAD — non-medical heavy research должен использовать DUAL SWEEP YAML).
- **brave_sweep.py reference**: `D:/Yahia/tools/research-backend/brave_sweep.py` — canonical client, lines 516 (priorities), 556 (qsearch broad path), 1564 (`--include-context-local` Tier 4 flag), 1774 (critical force context).
- **commits на main 2026-05-09**: `119915a` (economy stack), `410434a` (memcache Phase 1). HEAD docs commit `2c2874f` (ARCHITECTURE refresh) — без code change.

## 7. Files inspected

- `D:/Yahia/active/qsearch/src/server.js` — endpoints lines 1279-1373
- `D:/Yahia/active/qsearch/src/cache.js` — schema lines 41-80, `DEFAULT_TTL` line 15, `COST_PER_CALL` lines 19-26
- `D:/Yahia/active/qsearch/src/sweep_context.js` — Tier 4 handler (existence verified via Grep)
- `D:/Yahia/tools/research-backend/brave_sweep.py` — priority routing, lines 516-1774
- `D:/Yahia/active/qsearch/README.md` — v0.4.0 endpoints baseline
- `D:/Yahia/active/qsearch/V92_EFFECT_2026-05-10.md` (rd045)
- `D:/Yahia/active/qsearch/MEMCACHE_DESIGN_REFRESH_2026-05-10.md` (rd101)

## 8. Verdict

**5-tier stack — fully designed, partially deployed.**

| Layer | Status |
|---|---|
| Source code (qsearch + brave_sweep.py) | ✅ all 5 tiers shipped 2026-05-09 |
| Running daemon | ❌ pre-119915a — needs restart |
| Docker stack (Meilisearch/Qdrant/SearXNG) | ❌ down — Tier 1 broad and corpus unusable |
| QVAC local LLM (Tier 4) | ❌ not loaded — `qvac_available: false` |
| rd045 live evidence (Tiers 2+3) | ✅ verified on itchy-legs sprint 2026-05-10 |

**Next step (for user):** restart qsearch daemon + `docker compose up -d` → reverify 2.3-2.6 smokes → start dogfood log on next heavy sprint.
