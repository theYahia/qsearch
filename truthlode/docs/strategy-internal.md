# Truthlode — внутренняя стратегия (НЕ копировать в публичный repo)

> Вынесено из README.md 2026-06-10 при подготовке к публикации: флайвил Engine/Reports в
> публичном README нейтрального бенчмарка подрывает «no stake in the verdict» (см.
> roadmap-review-2026-06-09 — Engine/RaaS вырезаны из критического пути всеми 6 экспертами).
> Публичный README — только Bench.

## Три слоя (один флайвил)

| Слой | Что | Статус |
|---|---|---|
| **1 · Truthlode Bench** | Открытый нейтральный воспроизводимый бенчмарк citation honesty для AI deep-research агентов. Legal-вертикаль первой. → `bench/` | **v1 построен + валидирован (2026-06-07)**, hardening 06-09 |
| **2 · Truthlode Engine** | Research/answer-движок, который *верифицирует собственные цитаты* до ответа — и доказывает это, выигрывая бенчмарк. На субстрате qsearch (full content + multi-engine provenance + trust-mesh). | концепт (validated whitespace) — **заморожен, не строить in-lobby (Exa владеет capability)** |
| **3 · Truthlode Reports** | Done-for-you research с полным цитированием: каждое load-bearing число триангулировано ≥3 источниками. | концепт (gap confirmed) — **gated за kill-metric** |

Флайвил: бесплатный бенчмарк зарабатывает признание и становится цитируемым стандартом →
кредибилити де-коммодитизирует движок → usage наращивает trust-mesh корпус → лучше движок →
лучше репорты. Нейтральность — moat: frontier-лаба не может вести лидерборд, на котором
соревнуется её собственная модель.

## Рыночные числа (для питчей, НЕ для публичного README без сверки)

Measured citation-error rates **11%–95%** по моделям; Perplexity ~**37%** citation-hallucination
(реальный URL, сфабрикованное утверждение). Источники: research/citetrust-competitors-2026-06-08/.

## Конкурентное чтение (2026-06-08/09)

Клин открыт, но сужается: два academic preprint'а (апр–май 2026) реализуют тот же
parse→existence+support метод, но **ни один не является живым, нейтральным, legal-vertical,
поддерживаемым лидербордом коммерческих агентов** — эта комбинация и есть moat. Бизнес-модель
валидирована Vals AI (нейтральный legal-бенчмаркер) и LMArena ($100M→~$1.7B,
free-leaderboard-as-wedge). Детали: `research/citetrust-competitors-2026-06-08/`,
`research/exa-landscape-2026-06-09/`, `research/roadmap-review-2026-06-09.md`.

## GTM / запуск

Канонический план: `docs/launch-kit.md` (календарь A/B, Show HN пакет, legal-волна,
контент-движок, kill-метрики).
