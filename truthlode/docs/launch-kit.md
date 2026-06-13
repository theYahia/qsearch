# Truthlode Launch Kit — окно 15–16 июня 2026

> Все числа ниже соответствуют board v1 (2 агента). **После прогона ChatGPT DR — пересобрать
> (`node site/build_site.mjs` напечатает новые headline-числа) и обновить каждый драфт.**
> Канонические числа сейчас: 273 filed · 199 checkable · 39 not-fully-supported (**19.6% ≈ 1 in 5**) ·
> строго Unsupported+Fabricated: 31 (**15.6% ≈ 1 in 6**) · judge↔human 87.3% (κ=0.75) на 55 gold.
>
> **Update 2026-06-13 (landscape verify):** (1) Запуск решён **n=2 сейчас**, ChatGPT DR = fast-follow
> proof-post (не гейт). (2) **DRACO** (Perplexity, citation-bench, вышел 8.06, Perplexity сам
> выигрывает) + DeepResearch Bench + Rao/Wong/Callison-Burch (arXiv 2604.03173) + LegalCiteBench
> заняли соседние клетки → split-фрейминг: сайт нейтрально (Related-work блок), посты остро (хук
> ниже). (3) **«1,200+» проверено** — живая база Charlotin ~1,600 (11.06), безопасно. (4) Это
> **Rule 2.515(d)(2)**, НЕ «Rule 11» (то федеральный FRCP 11) — «Rule 11» в публичные драфты не пускать.

## 0. Атом-фраза (единственная версия правды, везде одинаковая)

> **"We fetched all 273 sources cited by two frontier AI deep-research agents on three legal
> questions. Of the 199 we could read, 1 in 5 did not fully support the claim it was cited
> for — and every verdict comes with the receipt."**

Fallback при атаке на Partial-бандлинг: «1 in 6 flatly failed — the source didn't say it, or didn't exist» (31/199).
Запрещено: прилагательные («lying», «caught»), per-vendor шейминг в заголовках, «11.4% of 273» (смешивает Error в числитель/знаменатель непонятным образом).

**DRACO news-hook (ТОЛЬКО off-site — посты/письма, НЕ на сайте):**
> *"A week ago Perplexity shipped DRACO — a deep-research benchmark where Perplexity wins. Here's the neutral one: no vendor money, our own tools off the board, and every verdict opens its receipt."*

Это острый ньюс-пег недели (DRACO вышел 8.06). На самом сайте джеба НЕТ — там нейтральный Related-work блок (Method-вкладка). Foil живёт в Show HN / Bluesky / письмах. Не называть Perplexity «врущим» — только структурный факт «вендор грейдит сам себя».

---

## 1. Календарь

### Calendar A (основной)

| День | Дата | Действия |
|---|---|---|
| D1 | Ср 10.06 | **ChatGPT DR прогон** (3 legal-промпта из bench/, ~2ч). Старт поиска 2-го аннотатора. Регистрация truthlode.org (reg.ru/nic.ru за ₽ или Njalla за крипту). Создать и греть аккаунты: HN, Reddit, Bluesky, HuggingFace (+X/LinkedIn через VPN — best-effort). |
| D2 | Чт 11.06 | Скоринг ChatGPT DR → board n=3 → `node site/build_site.mjs` → обновить все драфты ниже новыми числами. Пересъёмка og.png. |
| D3 | Пт 12.06 | Аннотатор грейдит 55 айтемов **с живых источников** (не с excerpt'ов судьи) → `node bench/agreement.js gold/labels.json out/all/audit.json gold/labels_2.json` → inter-annotator κ в README/Method. |
| D4 | Сб 13.06 | **Тихая публикация**: public repo (см. §6), GH Pages live, CNAME, HuggingFace dataset + DOI, Zenodo release. Без анонсов — даём ссылкам устояться и проиндексироваться. |
| D5 | Вс 14.06 **18:00 UTC** | **GO/NO-GO**: board n=3 ✓ + inter-annotator κ посчитан ✓ → GO. Любой гейт открыт → Calendar B. Прогон всех постов «вхолостую», предзаготовка писем. |
| D6 | **Пн 15.06 — Rule 11 day. Только legal-волна.** | Утром US-ET: tip-письма всем legal-таргетам (§3, одинаковые, без эксклюзивов). LinkedIn-пост + Bluesky-тред с пегом «правило вступило в силу сегодня». r/legaltech data-пост. **HN сегодня НЕ трогаем.** |
| D7 | **Вт 16.06 — Show HN, 14:00–17:00 UTC** | Сабмит ровно в 14:00 UTC, first comment в течение 60 сек. Весь день — comment duty (ответ <10 мин, технично, без маркетинга). ≥40 points к 16:00 UTC → пост «we're on HN» в Bluesky/X; <40 → не постим. Никогда не просить апвоуты. |
| D8 | Ср 17.06 | Dev-каналы: ChangeLog (changelog.com/news/submit — форма верифицирована), Simon Willison tip (simonwillison.net — **verify путь**), r/MachineLearning weekly self-promo thread, HF community post, dev.to/Hashnode long-form методология. |
| D9 | Чт 18.06 | r/AI_Agents, r/datasets (HF-angle), r/SideProject, Fosstodon. r/LocalLLaMA с локальным углом: «local qwen2.5:14b judge hits 87.3% agreement (κ=0.75), beats published 68% baseline». Lobste.rs — skip (invite-only). |
| D10 | Пт 19.06 | Снапшот метрик. Публичные ответы на каждый red-team issue. Newsletter-батч: TLDR/Ben's Bites/Neuron/Import AI (по 3 предложения, ожидать тишину). |
| D11–12 | 20–21.06 | Только ответы. Настроить CourtListener alerts, драфт дайджеста #1. |
| D13 | Пн 22.06 | **«This Week in Fabricated Citations #1»** (site + Bluesky + LinkedIn + r/legaltech) — движок запущен. |
| D14 | Вт 23.06 | Старт Perplexity DR прогона → proof-post #2 (~25–26.06) = **первый эксклюзив** тому legal-изданию, кто лучше всех среагировал в неделю 1. |

### Calendar B (фоллбэк, если GO/NO-GO провален)

Всё +7 дней: тихая публикация ~18–20.06, legal-волна **пн 22.06** с пегом «первая неделя нового
правила — первые кейсы уже в базе» (CourtListener подвозит свежие), Show HN **вт 23.06**.
**Дальше 23.06 не сдвигать** (academic twin-papers — угроза №1 по скорости). Если аннотатор
невозможен и к 19.06 — запуск с громким limitation-box наверху Method: *«v1 gold set: single
annotator; independent annotation in progress — labels_2.json hook is public, volunteer
annotators credited».* Раскрытое ограничение выживает; скрытое — убивает.

### Рекрутинг 2-го аннотатора (критический путь, старт сегодня)

Любой внимательный читатель английского грейдит «подтверждает ли живой источник это
утверждение». Варианты по порядку: (а) знакомый с английским, бесплатно; (б) фриланс
микро-гиг ~$20–40 за 55 айтемов — лучшие $30 проекта; (в) GitHub issue «independent annotator
wanted (credited in README)» — медленно. Бриф: грейдить с **живого URL**, не с excerpt'а судьи.

---

## 2. Show HN пакет

**Сабмитим URL сайта** (receipts-UI — это демо), repo — в first comment.

Титулы (≤80 chars, выбрать после ChatGPT DR — пересчитать N):
1. **(рекоменд.)** `Show HN: I fact-checked all 273 citations from Gemini and Claude Deep Research`
   — после n=3: `…all 4XX citations from ChatGPT, Gemini and Claude Deep Research`
2. `Show HN: Truthlode – every AI citation checked against its source, with receipts`
3. `Show HN: 1 in 5 checkable citations from AI research agents doesn't hold up` — сильнее, но число в титуле = вся дискуссия о числе; брать если уверен.

**First comment (запостить в течение 60 секунд, дословно):**

> Author here. I run a small open audit: give the same legal research prompts to AI
> deep-research agents, then check every citation they produce — does the cited source
> actually say what the claim says?
>
> Two checks per citation: (1) mechanical — does the URL exist at all (404/dead = Fabricated,
> no judgment call); (2) an LLM judge for support, and every verdict ships with the source
> excerpt + the judge's evidence quote, so you can re-check any row by hand. The judge is the
> least-trusted component, so it's built to need no trust: it agrees with human labels 87.3%
> (Cohen's κ=0.75) on a hand-labeled gold set, the published CiteGuard baseline is 68%, and
> every one of its disagreements with humans is conservative — it under-credits, never
> over-credits. All conflicts are listed on the site.
>
> Most surprising finding so far actually favors the agents: fabricated URLs are nearly
> extinct (Gemini 0 of 154, Claude 2 of 119). The live failure mode is subtler — the URL is
> real, but the source doesn't fully say what the agent claims. That's 1 in 5 of the
> citations we could read.
>
> ~27% of cited URLs couldn't be fetched (Cloudflare bot-walls, paywalls) — shown as coverage
> gaps, never silently dropped, and the primary rates keep them in the denominator so an
> agent can't game its score by citing unfetchable sources. The blocked-domain list is
> published on the Method tab.
>
> Why legal first: courts keep sanctioning lawyers for AI-fabricated citations, and Florida's
> fabricated-citation rule took effect yesterday. Code MIT, data CC-BY, committed verdict
> cache — `node bench/harness.js` reproduces the board.
>
> Related work: Perplexity's DRACO (last week) and DeepResearch Bench score citation accuracy
> across general domains, and Rao/Wong/Callison-Burch measure fabricated-URL rates at scale.
> Truthlode is the narrower, neutral case — no vendor grading itself on the board, every verdict
> opens a receipt you re-check by hand, and the judge asks whether the source *supports* the
> claim, not just whether the URL resolves. Legal vertical, public case law as ground truth.
>
> What I'd most like from HN: red-team audit.json. If you find a verdict you disagree with,
> open an issue — every dispute is public. Which agent should go on the board next?

**Преэмптим** (в комменте выше): circularity, Error/27%, audit-not-leaderboard, «фабрикации почти нет» (честность = кредит), **«это уже сделали» (DRACO/DeepResearch Bench → мы нейтральны + receipt + support-not-existence, см. related-work абзац)**.
**Только-если-спросят** (ответы держим наготове, не поднимаем сами): gold set n=1 annotator (→ «labels are public next to receipts; re-grade any and file an issue» + к этому моменту κ 2-го аннотатора), cherry-picked topics (→ public case law = чистый ground truth; промпты опубликованы; топик #4 — голосование в issues), вендор-фанаты (→ «2 of 119 cited URLs did not resolve» — механика, логи опубликованы; каждый агент выигрывает свою метрику: Gemini — fabrication, Claude — unsupported).

---

## 3. Legal-волна (пн 15.06): таргеты и питчи

Универсальный фрейм: **«Трекеры считают санкции; никто не измеряет, какие инструменты их
порождают. Мы измеряем — с квитанцией на каждый вердикт».**

| Таргет | Кто | Угол | Статус |
|---|---|---|---|
| **Damien Charlotin** — AI Hallucination Cases DB (damiencharlotin.com/hallucinations — URL верифицирован 10.06) | Исследователь HEC Paris, его базу цитируют все журналисты | Самое рычажное письмо запуска: «your tracker shows the sanctions; our board shows which tools produce the failure mode — cross-link?» Предложить standing data feed; его база линкуется из каждого нашего дайджеста. Cross-link ≈ kill-metric закрыта | ⚠️ **VERIFY**: не аффилирован ли с twin-papers (2604.03173/2605.06635) — если да, SKIP полностью |
| Bob Ambrogi — LawSites / LawNext | Solo legal-tech блогер, быстро берёт data-stories | Data story + Rule-11-day тайминг | verify контакт |
| Doug Austin — eDiscovery Today | Постоянно пишет про AI-citation кейсы | То же + предложить дайджест как recurring source | verify |
| Richard Tromans — Artificial Lawyer | Legal AI trade | Нейтральность как стори: «first neutral, reproducible scoreboard — no vendor money» | verify активность |
| Legaltech News (ALM) | Нужен конкретный репортёр AI-sanctions бита | Rule-11-day data tip | verify имя репортёра |
| Above the Law | Любят AI-lawyer-fail | «Sanctions keep coming — here's the measured rate per tool, with receipts» | verify tips@ |
| Eugene Volokh — Volokh Conspiracy | Проф., сам собирает hallucination-кейсы | Академический угол: dataset, κ, CC-BY, DOI | verify email |
| ABA Journal | Покрывает каждую волну санкций | Rule-11-day tip | verify |
| r/legaltech | ~25k, точно в таргет | Data-пост с раскрытым авторством | verify правила |
| r/Lawyertalk, r/paralegal | Параюристы = профессиональные cite-checkers | НЕ launch-пост. Дайджест #1 и далее; комменты в чужих sanctions-тредах | karma-минимумы |
| r/biglaw, r/law | Аллергия на промо | **Только комменты** в органических тредах про санкции: число + receipt-линк. Никогда свой сабмит | навсегда |
| Bar associations (Nevada AI Work Group, ABA LTRC) | Легитимизаторы | **Только после публикации**, неделя 3–4: «neutral rating of tools your members use, free, no vendor money» | post-publish only |

✅ **Проверено 13.06:** живая база Charlotin ~**1,600** кейсов (на 11.06; раньше в 2026 фигурировало
1,353). «1,200+» в stakes-strip безопасно консервативно — старый страх «может ~712» опровергнут.
Перед самой волной — финальный взгляд на живой счётчик базы; число в stakes-strip (index.html)
и во всех письмах держать **≤ живого числа базы**. Сайт про citation honesty не может сам
облажаться на цитате.

---

## 4. Cold outreach шаблоны (≤120 слов, число вместо прилагательных)

Правила эксклюзивов: (1) launch-данные — НЕ эксклюзив, всем одинаково в одно утро;
(2) эксклюзивы — только будущие числа (первый: Perplexity DR ~25.06); (3) одно издание,
48ч окно, дальше следующее; (4) эксклюзив получает тот, кто лучше всех среагировал в неделю 1.

**T1 — журналист (launch day):**
> Subject: Data: which AI research tools mis-cite legal authorities (Florida's rule took effect today)
>
> Hi [name] — you've covered the AI-citation sanctions wave, so this may be useful today.
>
> I run Truthlode, an open audit that fact-checks every citation AI deep-research agents
> produce on legal questions. Of the citations we could read from [Gemini, Claude and ChatGPT]
> Deep Research, 1 in 5 didn't fully support the claim it was cited for. Fabricated URLs are
> nearly extinct — the live failure mode is real sources that don't say what the AI claims.
>
> Every verdict links its source excerpt — your readers can check any row themselves: [link].
> Data is CC-BY, no vendor funding.
>
> Happy to share the dataset, or run a specific tool you're curious about.

**T2 — newsletter tip:**
> Subject: Tip: open leaderboard of AI citation honesty (with receipts)
>
> Truthlode is an open-source audit of AI deep-research agents' citations. Of the citations
> we could read from frontier agents on legal questions, 1 in 5 didn't fully hold up against
> its own source — and every verdict on the board opens the source excerpt that proves it.
> Judge agrees with human labels 87.3% (κ=0.75), beating the published 68% baseline. MIT
> code, CC-BY data, fully reproducible: [link].
>
> Timely: Florida's fabricated-citation rule took effect June 15.

**DRACO-opener (опц. swap-in в T1/T2 для тех, кто писал про DRACO / Perplexity):**
> Perplexity shipped DRACO last week — a deep-research benchmark where Perplexity itself comes
> out on top. Truthlode is the neutral counterpart: no vendor money, our own tools off the
> board, and every verdict opens its receipt.

**T3 — академик, цитировавший смежное (НИКОГДА — авторам twin-papers):**
> Subject: Open citation-verification dataset (87.3% judge-human agreement, κ=0.75) — re: your [paper]
>
> Hi Dr. [name] — your work on [topic] is one of the references behind Truthlode, a live
> citation-honesty audit of commercial deep-research agents. Our judge reaches 87.3% binary
> agreement with human labels (κ=0.75) against CiteGuard's published 68%.
>
> The dataset ([N] verified citations, legal domain) is CC-BY with a DOI: [HF link]. The
> verdict cache is committed, so every number reproduces.
>
> If it's useful as an eval target or comparison point, I'd be glad to help — and corrections
> to the gold set are welcome.

---

## 5. Соцсети при нуле подписчиков

- **Bluesky — primary.** Discovery через topic feeds, не followers; legal-academic аудитория там; RU-доступен без VPN. Поставить handle **@truthlode.org** через DNS TXT (бесплатная верификация = сигнал нейтральности в каждом реплае). Лонч-тред = атом-фраза + 3 скриншота (board / receipt / og).
- **X — reply-guy режим.** 0-follower тред = 0 импрешенов; ценность только в реплаях под большими аккаунтами, когда всплывает тема AI-цитат: @emollick, @random_walker, @sayashk (AI Snake Oil — ровно их бит), @GaryMarcus (drama-риск), @simonw. Правило: 3–5 содержательных реплаев/нед, одно число + один receipt-скриншот, не повторять ссылку дважды в день. X заблокирован в RU + телефонная верификация может не пройти — если аккаунт не создастся, Bluesky закрывает эту функцию.
- **LinkedIn — best-effort артефакт.** Пост-витрина для решерjudgement от legal-tech людей после писем; первые 2 строки под поиск: «Florida's AI-citation rule took effect today. We checked 273 citations…» Заблокирован в RU, свежий VPN-аккаунт с 0 connections = риск рестрикта. Не load-bearing.
- **HuggingFace — канал цитируемости.** Dataset (bench/dataset + gold + audit.json), полная dataset card с таблицей борда, **DOI** (+ Zenodo DOI с GitHub release), `Cite this` BibTeX. Это артефакт, который академик может цитировать → 90-day kill-metric. RU-доступен.

---

## 6. Публичный repo (что копируется в theYahia/truthlode)

**Копировать:** `bench/` (включая `.cache/` — воспроизводимость!), `site/`, `README.md`
(новый публичный), `LICENSE` (MIT), `DATA_LICENSE` (CC-BY-4.0), `.github/ISSUE_TEMPLATE/`,
`site/CNAME`.
**НЕ копировать:** `research/` (внутренние спринты), `ROADMAP.md`, `MARATHON-*.md`,
`docs/launch-kit.md`, `docs/strategy-internal.md` — стратегия и GTM не для публичного
нейтрального бенча (Engine/Reports-флайвил в публичном README = подрыв «no stake in the
verdict»).
Topics: `benchmark, llm-evaluation, hallucination, legal-tech, citations`.
GH Pages: ветка `main`, папка `/site`, custom domain truthlode.org (CNAME уже в site/).
Pinned issue: «Request an agent» (ChatGPT DR ✅ done / Perplexity / Exa / Parallel / Manus — голосование 👍).

---

## 7. Контент-движок (обязательства)

| Что | Каденция | Часы |
|---|---|---|
| (a) Новый агент на борде = proof-post (Perplexity → Exa → Parallel → Manus) | раз в 2–3 нед | ~3–4ч |
| (b) «This Week in Fabricated Citations» — CourtListener-дайджест, внутри «receipt of the week» | еженедельно, пн | ~2–3ч |
| (c) Standing commitment: **«every new DR agent audited within 72h of release»** — постится в чужие release-day треды, где трафик уже есть | по релизам | ~3ч |

(c) — главный план на случай тишины после запуска: на release-day не нужна своя аудитория,
у релиза она есть. Первый re-run всего борда (drift-story «Gemini got better/worse») — ~сентябрь.

---

## 8. Анти-плейбук (что сжигает нейтральный бренд)

- Никакой платной рекламы. Никогда.
- Не тегать вендоров в лонч-постах. Числа с receipts — on-brand; прилагательные — нет.
- Не просить апвоуты нигде (HN ring-детектор: graph+IP; RU-IP за VPN уже аномален — один аккаунт на платформу, прогретый с D1). Не постить HN-линк в Reddit в тот же день. Один Show HN на ~6 месяцев.
- Без сокпапетов и «проект друга».
- **Не DM'ить авторов twin-papers** (2604.03173 / 2605.06635) до и во время запуска.
- Не overclaim'ить каузальность: 1,200+ кейсов — это в основном ChatGPT-в-чате, не DR-агенты. Честный фрейм: «the same failure mode that keeps sanctioning lawyers, measured per tool».
- Вендорские деньги / спонсорские re-runs / платные бейджи — нет; публично отказаться, если предложат (сам отказ = контент).
- Оператора не прятать: solo dev disclosed = HN-актив. RU-локацию не выпячивать и не врать, если спросят — ответ на любой trust-дисконт: радикальная воспроизводимость (committed cache, CC-BY, re-run сами).

---

## 9. Метрики и kill-гейты

| Метрика | Floor | Base | Good |
|---|---|---|---|
| Show HN points 24h | <15 | 40–80 | 110+ |
| GitHub stars 24h / 7d / 30d | 20/50/100 | 60/150/300 | 121/289/600 |
| HF downloads 30d | <30 | 100 | 500 |
| Newsletter pickups 14d | 0 | 1 (ChangeLog) | 2+ |
| Legal-blog/tracker упоминание 21d | 0 | 1 | Charlotin cross-link |
| Red-team issues 14d | 0 (никому не нужно) | 2–5 (= engagement) | вендор-сотрудник вовлёкся |

- **Day 30 (~15.07):** ≥2 из {HN ≥50, legal-упоминание, ≥200 stars, inbound от legal-org, Perplexity proof-post}. Иначе: резать dev-каналы, удваивать дайджест + bar-письма.
- **Day 60 (~15.08):** ≥1 конкретный citation-lead в работе + 4–5 агентов на борде.
- **Day 90 (~14.09):** ≥1 независимая цитата Truthlode (академик / журналист / вендор / bar) — иначе тезис фальсифицирован → ROADMAP Phase 5 tripwire (часы → job search).

Еженедельный трекинг (10 мин, одна строка): stars Δ, uniques (GH Pages insights — скриптов аналитики на сайте нет осознанно), HF downloads, inbound, ответы на письма.

---

## 10. Чек-лист оператора перед GO (вс 14.06 18:00 UTC)

- [ ] ChatGPT DR прогнан, заскорен, board n=3, `build_site.mjs` пересобран, og.png переснят
- [ ] 2-й аннотатор отгрейдил ≥50 айтемов с живых источников, κ посчитан и вписан в Method/README
- [x] Число «1,200+» сверено с живой базой Charlotin (13.06: ~1,600 — безопасно; финальный взгляд на счётчик перед постингом)
- [ ] Charlotin: проверена неаффилированность с twin-papers
- [ ] Контакты legal-таргетов верифицированы (URL форм / email)
- [ ] truthlode.org зарегистрирован, DNS на GH Pages, HTTPS работает
- [ ] Public repo: содержимое по §6, без research/ и стратегии; LICENSE + DATA_LICENSE на месте
- [ ] HF dataset + DOI, Zenodo release
- [ ] Все аккаунты созданы и прогреты (минимум по 2–3 нормальных комментария)
- [ ] Show HN title пересчитан под n=3, first comment обновлён числами
- [ ] OG-превью проверено валидатором карточек (opengraph.xyz / Bluesky debug)
