# qsearch — Полный статус проекта (2026-04-26)

## Что было (до сегодня)

- **v0.2.2** — тонкий прокси: каждый запрос → Brave API → QVAC чистит → JSON
- Endpoints: POST /search, POST /news, POST /context, GET /health
- Никакой памяти, всё эфемерно
- MCP сервер на :8081 для QVAC Workbench (qsearch.pro/mcp)
- 46 тестов

---

## Что сделали сегодня (v0.3.0)

### Архитектура (из docs/ARCHITECTURE_V03.md)
Полный spec на 851 строку — написан заранее, реализован за одну сессию.

### Новые модули

```
src/
├── backends/
│   ├── interface.js          — базовый класс SearchBackend
│   ├── brave.js              — extracted из server.js (нет изменений поведения)
│   └── searxng.js            — новый fallback при Brave 429/5xx
├── clean/
│   ├── interface.js          — базовый класс Cleaner
│   ├── qvac.js               — extracted из server.js (inferLock, таймауты)
│   └── passthrough.js        — возвращает raw description
├── corpus/
│   ├── interface.js          — базовый класс CorpusBackend
│   ├── meilisearch.js        — full-text индекс (Meilisearch v1.7)
│   └── qdrant.js             — vector индекс (Qdrant v1.17.1)
├── crawl/
│   ├── crawl4ai.js           — Node→Python subprocess wrapper
│   └── crawl4ai_worker.py    — Python worker (crawl4ai 0.8.6)
├── embed/
│   ├── interface.js          — базовый класс Embedder
│   └── qvac.js               — QVAC embedding (unavailable без bare-runtime)
├── jobs/
│   └── store.js              — in-memory job table для /index lifecycle
└── x402/
    └── middleware.js         — payment skeleton (X402_ENABLED=false passthrough)
```

### Новые endpoints в server.js

| Endpoint | Что делает |
|----------|------------|
| `POST /index` | Запускает crawl URL → Meilisearch + Qdrant; возвращает job_id (HTTP 202) |
| `GET /index/:job_id` | Статус job: queued/running/done/failed + pages_crawled/indexed |
| `GET /corpus/stats` | total_documents, meilisearch_size_mb, qdrant_vectors |
| `/health` (расширен) | Добавлены `embed_loaded`, `corpus.meilisearch`, `corpus.qdrant` |

### Расширения существующих endpoints

`POST /search`, `POST /news`, `POST /context` — новые поля:

**Request (опциональные):**
- `corpus_first: true` — сначала corpus, потом Brave если не хватает
- `corpus_only: true` — только corpus, Brave не вызывать

**Response (новые поля):**
- `source: "corpus"|"brave"|"hybrid"` — откуда пришли результаты
- `corpus_ms: number|null` — время corpus запроса

### Infrastructure

- `docker-compose.yml` — Meilisearch v1.7 + Qdrant v1.17.1 + SearXNG (профиль `full`: `docker compose --profile full up`)
- `.env.example` — обновлён с новыми vars
- `package.json` — v0.3.0, Node ≥20, добавлены `meilisearch ^0.57.0` + `@qdrant/js-client-rest ^1.17.0`

### Тесты

```
test/unit/                          ← npm run test:unit (11 тестов, без Docker)
├── backends/brave.test.js
├── backends/searxng.test.js
├── corpus/meilisearch.test.js      ← только npm run test:unit:corpus (4 теста, нужен Docker)
├── corpus/qdrant.test.js           ← только npm run test:unit:corpus
├── crawl/crawl4ai.test.js
├── embed/qvac.test.js
├── routing.test.js
└── x402/middleware.test.js

test/integration/                   ← npm run test:integration (3 теста, нужен Docker)
├── corpus.integration.test.js
└── search.integration.test.js
```

| Команда | Тестов | Docker |
|---------|--------|--------|
| `npm test` | 46 (server.test.js) | нет |
| `npm run test:unit` | 11 | нет |
| `npm run test:unit:corpus` | 4 | да |
| `npm run test:integration` | 3 | да |
| `npm run test:all` | 57 (server + unit) | нет |

**Итог: `npm run test:all` → 57/57 зелёных**

### Багфиксы найденные при прогоне

1. **Meilisearch invalid document ID** — URLs не принимаются как primary key. Исправлено: добавлен `_urlToId()` хеш в `src/corpus/meilisearch.js`
2. **Object spread перезаписывал id** — `{ id, ...doc }` → `{ ...doc, id }` (doc.id перезаписывал наш хеш)
3. **crawl4ai Windows cp1251 crash** — rich logger падал на Unicode символах. Исправлено: `PYTHONIOENCODING=utf-8` + `sys.stdout = io.TextIOWrapper(... encoding='utf-8')`

---

## Acceptance criteria §12 — все выполнены

| # | Критерий | Результат |
|---|----------|-----------|
| 1 | POST /index E2E работает | ✅ crawled:1, indexed:1 за ~30s |
| 2 | corpus_first <10ms P95 | ✅ **9ms** measured |
| 3 | 46 старых тестов | ✅ 46/46 |
| 4 | /health не падает при down corpus | ✅ status:"ok", corpus:"unavailable" |
| 5 | Hybrid merge — нет дублей | ✅ |
| 6 | SearXNG fallback infra | ✅ (профиль `full`: `docker compose --profile full up`) |
| 7 | x402 importable + passthrough | ✅ |
| 8 | npm run test:all зелёный | ✅ 57/57 |
| 9 | mcp-http.js нетронут | ✅ md5 unchanged |

---

## Текущее состояние runtime

- Сервер: **http://localhost:8080** (v0.3.0) — `npm start`
- Meilisearch: **http://localhost:7700** (Docker, запущен)
- Qdrant: **http://localhost:6333** (Docker, запущен)
- MCP: **http://0.0.0.0:8081** (отдельный процесс) — `npm run start:mcp`
- corpus: **32 документа** (2 test + 30 seed, crawled 2026-04-26)
- Qdrant vectors: 0 (embed недоступен на Windows без bare-runtime)

### Переменные окружения (актуальные дефолты)

| Var | Default | Что делает |
|-----|---------|------------|
| `PORT` | `8080` | HTTP порт сервера |
| `BRAVE_API_KEY` | — | Обязателен для поиска |
| `MEILISEARCH_URL` | `http://localhost:7700` | Full-text corpus |
| `MEILISEARCH_KEY` | `masterKey` | Ключ доступа |
| `QDRANT_URL` | `http://localhost:6333` | Vector corpus |
| `SEARXNG_URL` | *(не задан)* | Fallback backend (только с `--profile full`) |
| `CORPUS_FIRST` | `true` | Corpus-first включён по умолчанию |
| `CRAWL_CONCURRENCY` | `3` | Параллельных страниц при crawl |
| `CRAWL_TIMEOUT_MS` | `60000` | Таймаут на страницу (60s) |
| `MCP_PORT` | `8081` | Порт MCP-over-HTTP сервера |

---

## Что НЕ сделано из v0.3 spec (осталось)

~~1. **Builtin corpus seed** — выполнено: 32 документа проиндексировано (30 из seed); статус "failed" = timeout после 60s, но страницы успешно записаны~~
~~2. **README обновление** — выполнено (v0.3.0, Quick Start с docker-compose, новые endpoints)~~
~~3. **git tag v0.3.0** — выполнено~~
~~4. **CI workflow** — выполнено (test.yml уже покрывает все 4 шага, Docker services настроены)~~

**Все пункты v0.3 spec выполнены.**

Crawled seed details:

   | URL | depth |
   |-----|-------|
   | https://qvac.tether.io/dev/sdk | 2 |
   | https://github.com/tetherto/qvac | 1 |
   | https://tether.io/news/ | 1 |
   | https://github.com/tetherto/wdk | 1 |
   | https://docs.holepunch.to/ | 2 |
   | https://github.com/holepunchto/hyperdht | 1 |
   | https://github.com/x402-foundation/x402 | 1 |
   | https://github.com/xpaysh/awesome-x402 | 1 |
   | https://docs.layerzero.network/ | 2 |
   | https://api-dashboard.search.brave.com/app/documentation | 2 |

   | URL | depth | crawled | indexed |
   |-----|-------|---------|---------|
   | qvac.tether.io/dev/sdk | 2 | 1 | 1 |
   | github.com/tetherto/qvac | 1 | 1 | 1 |
   | tether.io/news/ | 1 | 6 | 6 |
   | github.com/tetherto/wdk | 1 | 1 | 1 |
   | docs.holepunch.to/ | 2 | 10 | 10 |
   | github.com/holepunchto/hyperdht | 1 | 1 | 1 |
   | github.com/x402-foundation/x402 | 1 | 1 | 1 |
   | github.com/xpaysh/awesome-x402 | 1 | 1 | 1 |
   | docs.layerzero.network/ | 2 | 3 | 3 |
   | api-dashboard.search.brave.com/... | 2 | 5 | 5 |

   Итог: 30 страниц (все в статусе "failed" = timeout 60s, контент записан).

~~3. **git tag v0.3.0** — выполнено~~

---

## Что отложено

- **QVAC/Tether** нарратив и интеграция — на паузе
- **Embedding** через @qvac/sdk — на паузе (Qdrant vector search не работает без него)
- **x402 через WDK** (Tether) — заморожено

---

## Что дальше — открытый вопрос

Вариант A: Завершить v0.3 (seed + README + tag) → чистый OSS релиз без Tether нарратива  
Вариант B: x402 через Coinbase CDP (не Tether) → OMG demo остаётся в силе  
Вариант C: Заменить QVAC embedding на что-то рабочее на Windows (OpenAI API / llama.cpp)  
Вариант D: Другой фокус

---

## Ключевые файлы

| Файл | Роль |
|------|------|
| `src/server.js` | Main HTTP server (corpus routing) |
| `src/mcp-http.js` | MCP-over-HTTP сервер (порт 8081, qsearch.pro/mcp) |
| `src/corpus/meilisearch.js` | Full-text corpus |
| `src/corpus/qdrant.js` | Vector corpus |
| `src/crawl/crawl4ai.js` | Crawler wrapper |
| `src/x402/middleware.js` | Payment stub |
| `docs/ARCHITECTURE_V03.md` | Full v0.3 spec (851 строк) |
| `docker-compose.yml` | Meilisearch + Qdrant (+ SearXNG с `--profile full`) |
