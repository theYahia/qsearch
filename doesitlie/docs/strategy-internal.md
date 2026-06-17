# doesitlie — внутренняя стратегия (НЕ копировать в публичный repo)

> Вынесено из README.md 2026-06-10 при подготовке к публикации: флайвил Engine/Reports в
> публичном README нейтрального бенчмарка подрывает «no stake in the verdict» (см.
> roadmap-review-2026-06-09 — Engine/RaaS вырезаны из критического пути всеми 6 экспертами).
> Публичный README — только Bench.

## Три слоя (один флайвил)

| Слой | Что | Статус |
|---|---|---|
| **1 · doesitlie Bench** | Открытый нейтральный воспроизводимый бенчмарк citation honesty для AI deep-research агентов. Legal-вертикаль первой. → `bench/` | **v1 построен + валидирован (2026-06-07)**, hardening 06-09 |
| **2 · doesitlie Engine** | Research/answer-движок, который *верифицирует собственные цитаты* до ответа — и доказывает это, выигрывая бенчмарк. На субстрате qsearch (full content + multi-engine provenance + trust-mesh). | концепт (validated whitespace) — **заморожен, не строить in-lobby (Exa владеет capability)** |
| **3 · doesitlie Reports** | Done-for-you research с полным цитированием: каждое load-bearing число триангулировано ≥3 источниками. | концепт (gap confirmed) — **gated за kill-metric** |

Флайвил: бесплатный бенчмарк зарабатывает признание и становится цитируемым стандартом →
кредибилити де-коммодитизирует движок → usage наращивает trust-mesh корпус → лучше движок →
лучше репорты. Нейтральность — moat: frontier-лаба не может вести лидерборд, на котором
соревнуется её собственная модель.

## Рыночные числа (для питчей, НЕ для публичного README без сверки)

Measured citation-error rates **11%–95%** по моделям — пин: **GhostCite** (Xu et al. 2026, 13 LLM /
40 доменов / 375K цитат, hallucination 14-95%). Fabricated-URL rate **3-13%** — пин: **Rao/Wong/
Callison-Burch** (arXiv 2604.03173, DRBench 53K + ExpertQA 168K URL). Perplexity ~**37%**
citation-hallucination (реальный URL, сфабрикованное утверждение) — INTERNAL ONLY, **не в
публичные драфты** (противоречит DRACO/DeepResearch Bench, где Perplexity лидер по citation
accuracy; ROADMAP Phase 1 уже запретил «generic Perplexity-37%»). Источники:
research/citetrust-competitors-2026-06-08/.

## Конкурентное чтение (2026-06-08/09, **обновлено 13.06**)

Клин открыт, но **краудится быстрее, чем казалось 09.06** (exa-landscape пропустил DRACO).
Свежий скан 13.06:
- **DRACO** (Perplexity, open MIT, вышел 8.06) — live citation-bench, домен Law=6%, **Perplexity
  сам выигрывает** = вендорский, НЕ нейтральный. Foil, не killer.
- **DeepResearch Bench** (USTC, arXiv 2506.11763) — академ-нейтральный, **активно ведётся**
  (апдейт 31.05.26), citation accuracy, но без per-citation receipts и не legal.
- **Rao/Wong/Callison-Burch** (2604.03173) — fabrication на 221K URL; авторитетные авторы =
  если сделают live борд, острейшая угроза.
- **LegalCiteBench** (2605.10186) — legal+citation, но closed-book recall, не аудит живых
  источников. **GhostCite/CiteAudit/FalseCite** — соседи по теме.

**Moat держится, но это комбинация, не одно свойство:** ни один не является живым + нейтральным
+ legal-vertical + per-citation-receipt + support-not-existence + на реальных агентах одновременно.
Бизнес-модель валидирована Vals AI (нейтральный legal-бенчмаркер) и LMArena ($100M→~$1.7B,
free-leaderboard-as-wedge). **Скорость к live = единственная защита** (риск #1). Детали:
`research/citetrust-competitors-2026-06-08/`, `research/exa-landscape-2026-06-09/`,
`research/roadmap-review-2026-06-09.md`, memory `project-draco-perplexity-2026-06-13`.

## GTM / запуск

Канонический план: `docs/launch-kit.md` (календарь A/B, Show HN пакет, legal-волна,
контент-движок, kill-метрики).
