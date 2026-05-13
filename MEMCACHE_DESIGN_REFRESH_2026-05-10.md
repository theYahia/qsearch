# qsearch memcache — Design Refresh 2026-05-10

> **Дата:** 2026-05-10 · **Статус:** REFRESH (supersedes 2026-05-07 design where overlapping) · **Owner:** Yahia
> **Cross-ref:**
> - Original: `D:/Yahia/active/qsearch/MEMCACHE_DESIGN_2026-05-07.md` (READ-ONLY base)
> - Effect baseline: `D:/Yahia/active/qsearch/V92_EFFECT_2026-05-10.md` (rd045 Marathon-1 snapshot)
> - rd101 (research-debt #101) — refresh trigger

## 0. Why refresh

После 2026-05-07 design'а ship'нулся **v9.2 priority routing** в `brave_sweep.py` (CLAUDE.md §4.1). Effect snapshot rd045 показал что **48% queries в latest heavy sprint уже идут в FREE qsearch SearXNG** (itchy-legs 2026-05-10: 56 of 117 effective calls). v9.2 partially preempts the gap memcache был designed заполнить.

Вопрос для refresh: **сколько ROI остаётся для memcache после v9.2?**

Ответ кратко: **меньше чем 2026-05-07 estimate, но всё ещё положительный** — Brave-tier queries (focused + critical, ~50-60% от sprint) остаются uncached между sprints. Memcache на этом tier даёт repeat-query savings cross-sprint ($0.30-3/мес Sonnet, $1-15/мес Opus). На FREE qsearch tier — memcache бесполезен (SearXNG instance уже cache'ит upstream).

## 1. Delta vs 2026-05-07 design

| Aspect | 2026-05-07 (original) | 2026-05-10 (refresh) |
|---|---|---|
| **Scope** | Cache всех `/sweep` queries (qsearch + Brave path) | Cache **только Brave-tier queries** (`focused` + `critical`). qsearch broad tier — skip (SearXNG already caches upstream) |
| **Hit rate estimate** | 20-30% sprint-wide (low-confidence) | 25-35% **на Brave-tier subset** cross-sprint (low-confidence) |
| **Brave-tier addressable** | implicit ~100% | explicit ~50-60% от sprint queries (после v9.2 routing 40-48% уходят в qsearch broad → не кэшируются) |
| **Token savings/мес** | 750K-3.75M tokens | **300K-1.25M tokens** (~33% downward revision — v9.2 preempts the FREE-tier portion) |
| **Cost savings (Sonnet 4.5 input @ $3/1M)** | $2.25-11.25/мес | **$0.30-3/мес** (5 heavy sprints/мес @ midpoint) |
| **Cost savings (Opus 4.7 input @ $15/1M)** | $11-56/мес | **$1.50-15/мес** |
| **Brave API $-savings** | $1.50-4.50/мес | **$0.50-1.50/мес** (only Brave-tier queries hit cache) |
| **Phase 1 timeline** | 2 weeks (4-6h/нед part-time) | **1 week compressed** (focused scope, less endpoint surface) |
| **Phase 2 (semantic)** | Deferred, conditional ship | **Deferred indefinitely** — incremental ROI marginal vs effort после v9.2 takes the easy wins |
| **NEW component** | — | **Observation logging** — auto-track hit-rate per sprint в SQLite. Decision gate honest data-based. |

## 2. Refreshed ROI analysis

### 2.1 v9.2-aware sprint composition

Из rd045 snapshot (itchy-legs heavy sprint, 117 effective calls):
- 56 broad → qsearch SearXNG (FREE, $0, **memcache skip**)
- 73 brave web (focused tier) (~$0.005/call → $0.37/sprint, **memcache target**)
- 10 brave context (critical tier) (~$0.01/call → $0.10/sprint, **memcache target**)
- **Brave-tier total: ~83 calls = 71% of sprint, $0.47/sprint**

Так что после v9.2 routing **address­able cache surface = ~71% queries** (не 100% как в original 2026-05-07 design).

### 2.2 Cross-sprint hit rate на Brave-tier subset

Hypothesis: **focused + critical queries более recurrent** чем broad scoping queries. Reasoning: critical queries — load-bearing entities (Tinkoff, Yandex, HSE pricing), которые приходят в почти каждом RU/jobseeker/HR-tech sprint'е. Broad queries более sprint-specific (themed scoping).

- Estimated cross-sprint hit rate (Brave-tier only): **25-35%** (vs original 20-30% sprint-wide). **low-confidence**, нужен post-deploy замер.
- Sample math: 5 heavy sprints/мес × 83 Brave-tier calls × 30% hit = **125 cached queries/мес**.

### 2.3 Token savings revised

Per Brave-tier call: ~3-5K tokens (web results) или ~10-20K (context endpoint).

5 heavy sprints/мес:
- 125 cached queries × midpoint ~5K tokens = **625K tokens/мес avoided fetch**
- Conservative 300K, optimistic 1.25M tokens/мес.

Claude downstream (Phase 3-4 synthesis re-reading cross-sprint): another 50-150K tokens/мес. Не двигает порядка.

### 2.4 $-savings revised

| Model | Input rate ($/1M) | Saved tokens/мес | $/мес savings |
|---|---|---|---|
| Sonnet 4.5 | $3 | 300K-1.25M | **$0.90-3.75** |
| Opus 4.7 | $15 | 300K-1.25M | **$4.50-18.75** |
| Brave API | $0.005-0.01/call | 125 calls/мес skipped | **$0.50-1.50** |

**Honest aggregate: $1.40-5/мес Sonnet workflow, $5-20/мес Opus workflow.** Меньше original 2026-05-07 estimate ($5-25/мес) на ~33-50%.

## 3. Decision tree

```
┌─ How many heavy sprints/мес does user run?
│
├─ ≥5/мес ──→ ✅ SHIP Phase 1 memcache (Brave-tier)
│             ROI: ~$1.50-20/мес (Sonnet/Opus mix)
│             Effort: 1 week
│             Hit rate threshold для permanent: ≥20% после 2 sprints
│
├─ 2-4/мес ──→ ⏸️ DEFER Phase 1
│              ROI marginal: ~$0.50-8/мес
│              v9.2 routing already captures easy wins
│              Re-evaluate если sprint cadence increases
│
└─ <2/мес ──→ ❌ SKIP entirely
              v9.2 sufficient; cache infrastructure overhead не окупается

Phase 2 (semantic similarity via Qdrant) → DEFER INDEFINITELY
  Reason: incremental hit rate +15-20% поверх Phase 1 = +50K-200K tokens/мес = +$0.15-3/мес
  Implementation effort: 1-2 weeks + threshold tuning
  Не окупается на 1-user scale. Re-evaluate если productize claude-webcache style
  для shared use.
```

**Текущий user pacing (apparent):** 5+ heavy sprints/мес (itchy-legs, second-edu-pick, pm-courses-master, jobseeker-ai-ru, gospomosh, MoexOsintEdge, NightLLM offload в последние 2 weeks). → **Phase 1 SHIP recommended.**

## 4. Refreshed implementation — 1-week roadmap

Compressed из original 2-week scope. Removals: дроп `/cache/list` (debug-only, low value), defer LRU eviction job до first 1GB hit, defer `/ui` dashboard updates.

| Day | Deliverable | Notes |
|---|---|---|
| **Day 1** | SQLite schema + `/cached_sweep` endpoint | Schema unchanged from 2026-05-07 §3 (cached_queries table, indexes). `/cached_sweep` accepts text/plain `label\|query\|priority` lines. Skip cache lookup для `priority=broad` (route directly к qsearch SearXNG). Cache lookup только для `focused`+`critical`. |
| **Day 2** | `brave_sweep.py --use-cache` integration | Pre-Brave call: hash query → POST `qsearch:8080/cache/lookup`. Hit → fill `<label>.json` from cache, skip Brave. Miss → normal Brave fetch + write-through POST `qsearch:8080/cache/store`. Default OFF (opt-in flag). |
| **Day 3** | Observation logging (NEW) | Per-sprint counter: hits, misses, addressable_calls, total_calls. Append to `~/.qsearch/cache/sprint_log.jsonl` after each `/cached_sweep` batch. Format: `{ts, sprint_topic, hits, misses, hit_rate, brave_tier_share}`. Honest data для decision gate. |
| **Day 4** | Smoke testing | Manual: re-run last 2 sprints' queries.txt с `--use-cache`, verify hit rate sane (>0% on second sprint), no false positives (cached row matches fresh fetch on spot-check 5 queries). |
| **Day 5** | Deploy + initialize counter | Bump qsearch v0.5.0-alpha. Reset `sprint_log.jsonl`. Document в qsearch README. Add to CLAUDE.md §4 как opt-in для heavy sprints. |

**Out of Day 1-5 scope (defer until needed):**
- `/cache/stats` endpoint (read counters from sprint_log.jsonl manually для now)
- `/cache/invalidate` endpoint (manual SQL DELETE если нужно)
- LRU eviction (trigger при 1GB hit, не сейчас)
- `/ui` integration

## 5. Decision gate — after 2 heavy sprints

Run 2 heavy sprints с `--use-cache` enabled. Read `sprint_log.jsonl`:

```python
import json
logs = [json.loads(l) for l in open('~/.qsearch/cache/sprint_log.jsonl')]
last2 = logs[-2:]
avg_hit_rate = sum(s['hit_rate'] for s in last2) / 2
```

| `avg_hit_rate` | Action |
|---|---|
| **≥20%** | ✅ SHIP — memcache ROI confirmed, бамп v0.5.0 stable, документировать в CLAUDE.md as recommended-on |
| **10-20%** | 🟡 PARK — keep code в branch, но default OFF. Re-evaluate after 5 more sprints или change в Brave pricing/API |
| **<10%** | ❌ KILL — Phase 1 не окупает 1 week effort, удалить branch, обновить rd101 как resolved-skip |

**Honest take:** original 2026-05-07 рекомендовал hit rate threshold ≥20% sprint-wide. Refresh держит тот же threshold но **на Brave-tier subset** — что более жёстко (FREE-tier queries не считаются в knominator). Если hit rate <20% on Brave-tier — feature не имеет смысла даже учитывая v9.2 baseline.

## 6. What stays unchanged from 2026-05-07

(Avoid duplication — refer original где можно.)

- **§2 Caching Key Strategy** — SHA256 normalize, topic namespacing. ✅ unchanged.
- **§3 Storage Architecture** — SQLite schema, WAL mode, TTL 30d, result_checksum. ✅ unchanged.
- **§4 API Endpoints** — `/cached_sweep` core unchanged. `/cache/stats`, `/cache/invalidate`, `/cache/list` deferred (см. §4 above).
- **§5 Integration с brave_sweep.py** — `--use-cache` flag unchanged in shape. ✅ unchanged.
- **§8 Risks** — все 6 рисков остаются valid. ✅ unchanged.
- **§10 Out-of-scope** — federation, /search cache, news/context endpoints, encryption — все остаются deferred. ✅ unchanged.

## 7. Cross-reference summary

- **Effect baseline:** rd045 V92_EFFECT — confirmed 48% qsearch share на itchy-legs sprint, validates v9.2 routing operational и informs refresh ROI math.
- **Original design:** MEMCACHE_DESIGN_2026-05-07 — schema, endpoints, risks, out-of-scope все остаются базой. Refresh только корректирует scope/timeline/ROI.
- **Triggering policy doc:** CLAUDE.md §4 (DUAL SWEEP), §4.1 (v9.2 priority routing). Memcache не меняет hard gate — оба backend'а всё равно required перед Phase 2.

## 8. Risks added vs 2026-05-07

| Risk | Mitigation |
|---|---|
| **Cache bias на focused/critical entities** — те же entities (Tinkoff, Yandex, HSE) повторяются → агент привыкает к stale data сильнее чем для broad terms | TTL 14d (override default 30d) для cached focused/critical queries — дешёвый refresh для recurring entities. Manual `/cache/invalidate?topic=...` после known business events (M&A, pricing change). |
| **Hit rate hypothesis (focused/critical recurrent больше broad) ungrounded** — может оказаться обратно: load-bearing queries более sprint-specific, broad terms более recurrent | Day 3 observation logging adds breakdown `{focused_hit, critical_hit, broad_skipped}` чтобы post-deploy data factuality check. Если hypothesis ломается — kill Phase 1 in decision gate |
| **v9.2 routing changes break cache key validity** — если queries.txt format меняется (3rd field added/removed) → SHA256 hash включая priority? | Cache key normalize_query() игнорирует priority field — derived только из text. Hash stable across v9.2 routing changes. |

---

## TL;DR for fast scan

- **48% queries уже в FREE qsearch (v9.2)** → memcache ROI revised down ~33%
- **Refresh scope:** Brave-tier only (`focused`+`critical` ~71% of sprint, ~83 calls/sprint)
- **Refreshed savings:** $1.40-5/мес Sonnet workflow, $5-20/мес Opus workflow (vs original $5-25 sprint-wide)
- **Phase 1 timeline:** 1 week compressed (was 2)
- **Phase 2 (semantic):** deferred indefinitely (low ROI vs effort)
- **NEW:** observation logging Day 3 — honest data для decision gate
- **Gate after 2 sprints:** ship if hit rate ≥20% on Brave-tier subset
- **Decision:** at user's current cadence (5+ heavy sprints/мес) → ✅ SHIP Phase 1
