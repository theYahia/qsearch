# 🗺️ ROADMAP — doesitlie (+ qsearch substrate)

> doesitlie = открытый НЕЙТРАЛЬНЫЙ бенчмарк честности цитат AI deep-research агентов (legal v1) → verified-citation engine → RaaS, на суверенном qsearch-субстрате.
> Путь: build-in-public. Вирусный полезный репо → личная значимость → пассивные/self-serve деньги. БЕЗ исходящих продаж.
> 🔴 Красная линия (moat): НИКОГДА не брать деньги у рейтингуемых вендоров / не продавать бейдж. Нейтральность = всё.
> Рестрактур 2026-06-09 по итогам экспертной панели (см. research/roadmap-review-2026-06-09.md). Конвергенция 6 рецензентов: (1) не блокировать публикацию на $2B-агентах; (2) захардить методологию ДО публикации (Support% геймится, gold set циркулярен); (3) re-anchor на legal/Rule-11; (4) вырезать qsearch-позиц./Engine/RaaS с критпути; (5) добавить 90-дневный kill-metric.
> Формат: фазы по порядку; [x] сделано, [ ] в работе. Источник секции :4444/#doesitlie. Обновлено 2026-06-09.

## Phase 0 — Захардить бенч (pre-publish gate) 🔴 (сейчас, блокер)

> Конвергенция eval+tech: методология не переживёт первый red-team. Чинить ДО публикации (ретрофит после Show HN = репутационно фатален). Всё L-M, ~2-4 дня соло.

- [x] v1-пайплайн (verifier + harness + judge), 2-agent leaderboard Claude DR 83.7% / Gemini 3.1 Pro 77.9%
- [x] **Coverage-adjusted score** (2026-06-09): leaderboard теперь показывает Coverage + ✓Supported/total + ✗Unsupported/total + ☠Fabricated/total; Error не прячется. Реальные числа: Claude 60.5% / Gemini 57.1% coverage-adjusted (vs 83.7%/77.9% per-fetched). (archive.org fallback — опц., отложено)
- [x] **Демотировать Support%** (2026-06-09): Fabricated-rate + Unsupported-rate (over total) = PRIMARY, сортировка по «честности» не по Support%. Ранг изменился: Gemini выше Claude по mechanical-Fabricated (0% vs 1.7%)
- [x] **Cohen's kappa** (2026-06-09): agreement.js считает κ (4-way + binary) + версию без mechanical-Fabricated. Реально: binary 87.3% κ=0.750, 4-way 83.6% κ=0.737 (substantial)
- [ ] **Независимый 2-й аннотатор** (ОПЕРАТОР): 2-й человек грейдит LIVE-источник (не excerpt судьи), re-sample stratified по agent+topic (не по вердикту судьи) → inter-annotator κ. Хук готов (agreement.js arg3 = labels_2.json)
- [x] **Fix doc/code drift** (2026-06-09): убран мёртвый ollamaEmbed import; verifier docstring + README = реальный lexical-метод + qwen2.5:14b; judge-reproducibility задокументирована (cache-pinned). (`git add bench/.cache` — при publish)
- [ ] Прогнать **ChatGPT DR** (ОПЕРАТОР, своя подписка ~2ч) → 3-agent борд с явным проигравшим. **Решение 13.06: НЕ launch-гейт — запускаемся n=2, ChatGPT DR = первый proof-post (fast-follow), совпадает с Phase 1 «не блокировать на контестантах».**

## Phase 1 — Опубликовать бенч (НЕ блокировать на контестантах) 🔴 (эта неделя)

> Конвергенция founder+distribution+vc+eval: операторский прогон Exa/Parallel = follow-up, не гейт. Скорость-к-live = единственная защита от академ-конкурентов (2 препринта 2604/2605 в одном шаге от продуктизации).

- [ ] Public GitHub repo (код MIT / данные CC-BY) + audit.json публично на каждую строку
- [ ] Static leaderboard site (doesitlie.org → GH Pages): таблица + coverage% + клик→audit-trail (источник/excerpt)
- [ ] **Citation-артефакт**: stable per-result permalink + «cite this» BibTeX + one-line model-card-ready claim (компаундит Tier-1 признание)
- [ ] README re-anchored на ЮРИДИЧЕСКУЮ fabrication + Rule 11 (вступает 15 июня 2026) hook, НЕ generic Perplexity-37%

## Phase 2 — Дистрибуция / recognition 🟡 (эта неделя / нед 2)

- [ ] Drafted точный Show HN title (число+метод, называет проигравшего агента) — title решает всё на HN
- [ ] Launch HN solo first (вт-чт ~8am ET); держать Reddit/X 24-48ч для re-amplify
- [ ] Каналы: legal Twitter + r/MachineLearning + r/AI_Agents (НЕ r/perplexity_ai как primary — brand-defensive, fight а не amplify)
- [ ] ПОСЛЕ launch: submit борд в Tow/CJR + Vals AI как citation-offer (НЕ pre-DM авторов 2604/2605 — это #1 speed-ТРЕАТ, предупреждать = ускорять)
- [ ] Blog methodology page (mini-arxiv отложен на нед 2+, не гейтит дистрибуцию)

## Phase 3 — Живой лидерборд: контестанты async-дрипом 🟡 (нед 2+)

> founder: каждый новый агент = свой proof-post/distribution-event, не гейт. Превращает медленный ручной chore в контент-дрип.

- [ ] Добавить Perplexity DR (pain-hook, ~37% репутация), затем Exa Research, затем Parallel / Manus — по одному, каждый = re-share
- [ ] CourtListener / Free Law Project existence-check (legal mechanical anchor, unchallengeable) — fast-follow
- [ ] Continuous re-run при обновлении моделей (перманентная поверхность признания)

## Phase 4 — Legal beachhead (ПОСЛЕ public proof-post) 🟢 (нед 3-4)

> legal+vc: bar-association = legitimizer (Nevada AI Work Group уже рейтит тулзы; Querious+Michigan precedent). Warm/inbound-by-proxy, НЕ cold sales — submit в их существующий процесс. Только ПОСЛЕ публичного числа (бару нужно на что указать).

- [ ] 1 email в State Bar AI committee (Nevada / ABA Legal Tech) — оффер нейтрального citation-honesty рейтинга тулзов их членов
- [ ] Legal-media sanctions-репортёры (Rule 11 angle)

## Phase 5 — ⚖️ 90-дневный kill-metric (decision gate) 🟢

> vc_bear: «hobby на 200 звёзд» (собственный steelman) не имеет tripwire. Защита runway.

- [ ] Tripwire: если борд НЕ процитирован ≥1 independent third-party (академик / vendor blog / журналист / bar) за **90 дней с даты ПУБЛИКАЦИИ** → recognition→деньги thesis FALSIFIED → реаллокация 5-7ч/нед на job search. Часы стартуют с publish, не с сегодня.

## Phase 6 — Монетизация (только после признания) 🔵 (мес 2-3+, gated)

> vc_bear: live-противоречие — единственные validated деньги (bar-канал + insurer-data) требуют outbound, который запрещён. Решить ЯВНО.

- [ ] РЕЗОЛВ GTM: либо принять recognition-only (это hobby — ок, но сказать прямо), либо ОДНО узкое исключение (bar-канал как legitimizer+1й клиент, warm не cold)
- [ ] Self-serve hosted verification (paste brief → CourtListener-checked audit, оплата картой) — buy-side, нейтральность цела — только после bar-legitimation
- [ ] (отложено) per-call API / RaaS reports

## Заморожено / OFF критического пути (не трогать пока бенч не цитируется)

### qsearch substrate — заморозить engineering
- [ ] (post-ship, 1-2ч, ТОЛЬКО copy) positioning: self-host/air-gapped + multi-engine provenance + trust-mesh + QVAC-native; снять «MCP-native»; fix 5-tier R4 (Exa имеет ZDR). Sovereign-квадрат = структурный moat, но это копирайт, НЕ код. qsearch уже работает как измерительный субстрат бенча — этого достаточно.

### doesitlie Engine (Phase отложена)
- [ ] verified-citation engine — НЕ строить в лоб (Exa/Manus→Meta/Hebbia владеют capability). Только ПОСЛЕ того как бенч стал референсом.

### Backlog
- [ ] NLnet грант — parked; пересмотр ТОЛЬКО на kill-metric checkpoint если runway критичен (lowest-COI cash, но grant-chasing ≠ build-in-public)

## Красные линии (moat — никогда не нарушать)
- [ ] НИКОГДА не брать деньги у рейтингуемых вендоров / не продавать бейдж
- [ ] Apache-2.0 (qsearch) / MIT-CC (bench) чистые — аудируемость = доверие
- [ ] Нейтральность арбитра > любая партнёрка/раунд

## Риски-мониторинг (forcing functions, не пассивные чекбоксы)
- [ ] **#1 (главный) — ЧАСТИЧНО МАТЕРИАЛИЗОВАЛСЯ (verify 13.06):** Perplexity выпустил **DRACO** (citation-bench, 8.06, домен Law) — но он **вендорский** (Perplexity сам выигрывает) → *нейтральная* клетка ещё свободна, DRACO = foil, не killer. Авторы 2604.03173 = **Rao/Wong/Callison-Burch** (UPenn) — если превратят препринт в live нейтр. борд = острейшая версия угрозы. + DeepResearch Bench (live, академ), LegalCiteBench (closed-book). Лечится ТОЛЬКО ship-date на Phase 1 (не мониторингом). Окно = недели — НЕ сдвигать дальше 23.06.
- [ ] Perplexica / Onyx добавляют multi-engine provenance + trust-mesh → qsearch-ниша сужается
- [ ] Exa / Parallel выпускают self-host → суверенный квадрат под угрозой
- [ ] Exa входит в legal citation-verification → ускорить legal-Bench
