# R7 + R8 — numerical & dependency audit of TIER-C-RESULTS-2026-08-04.md

Audited file: `D:/Yahia/active/qsearch/TIER-C-RESULTS-2026-08-04.md` (38782 bytes, mtime 2026-08-04 20:33 local / 17:33 UTC).
Method: every numeric claim traced to a raw artifact (JSON result file, source code, live re-query, or test run). Where a stored artifact existed it was read directly. Where none existed, the underlying mechanism was re-run live (Meilisearch is up at `127.0.0.1:7700`, `qsearch_corpus` index) or reconstructed from source. No report or source file was edited. One live re-run of `npm run test:all` was executed in the working tree (read-only w.r.t. files: runs tests, writes nothing); one temporary `git worktree` at HEAD was created to measure the pre-tier-C baseline test count, then removed (`git worktree remove --force`) — the main working tree was never touched.

Overall: the vast majority of numbers in this report are correct, precise, and trace cleanly to the artifacts listed as candidates in the brief. Four small numeric slips were found (all in the last-decimal-digit / rounding class, one more consequential). A larger set of C0 "what happened during the run" numbers turn out to be un-persisted console output with no backing artifact. One dependency claim ("C0 is a prerequisite for C1") does not hold for the measurement the report actually reports.

---

## 1. Numeric claims — report value vs artifact value

### 1.1 C3 — provenance artifact (`bench/ru/results.json`)

| # | Claim (report) | Report value | Artifact value | Verdict | Source |
|---|---|---|---|---|---|
| 1 | Total n | 28 | `summary.n` = 28 | MATCH | results.json |
| 2 | web group: n / web% / ctx% / Δ | 10 / 70 / 30 / −40 | `byGroup.web`: n10, web.supportedPct 70, context.supportedPct 30, deltaPp −40 | MATCH | results.json |
| 3 | context group: n / web% / ctx% / Δ | 10 / 60 / 100 / +40 | `byGroup.context`: n10, web 60, context 100, deltaPp 40 | MATCH | results.json |
| 4 | independent group: n / web% / ctx% / Δ | 8 / 62.5 / 62.5 / 0 | `byGroup.independent`: n8, web 62.5, context 62.5, deltaPp 0 | MATCH | results.json |
| 5 | всего: n / web% / ctx% / Δ | 28 / 64.3 / 64.3 / 0 | `summary.web.supportedPct` 64.3, `summary.context.supportedPct` 64.3 | MATCH | results.json |
| 6 | Verdict-distribution table, all 6 rows (web/web 7-2-—-1, web/context 3-6-1-—, context/web 6-4-—-—, context/context 10-—-—-—, independent/web 5-2-1-—, independent/context 5-3-—-—) | as listed | `byGroup.*.{web,context}.{Supported,Partial,Unsupported,Error}` — every one of the 24 cells matches exactly | MATCH (all cells) | results.json |
| 7 | "Предыдущий замер дал web 70% Supported против context 90%" | 70 / 90 | No file in the repo contains this pair. `grep` for the string across the whole project matches only the report itself. | **UNTRACEABLE** | — |
| 8 | Text density: 1077 chars/passage (context) vs 261 (web) | 1077 / 261 | `_endpoint_compare.json` → `overall.charsPerSnippet` = `{web: 261, ctx: 1077}` | MATCH | _endpoint_compare.json |
| 9 | "на равном бюджете в 8000 символов context несёт на 20 п.п. больше терминов эталона" | +20 p.p. | `CHAR_BUDGET = 8000` confirmed in `scripts/bench_judge_ru.mjs:46`, matching the "equal 8000-char budget" mechanism. No file stores a term-coverage-delta figure; not present in results.json, _endpoint_compare.json, or any other artifact found. | **UNTRACEABLE** (mechanism real, number not persisted) | scripts/bench_judge_ru.mjs (mechanism only) |

### 1.2 C1 — rerank benchmark (`bench/ru/rerank_result_pairs.json`, `bench/ru/rerank_result.json`)

| # | Claim | Report value | Artifact value | Verdict | Source |
|---|---|---|---|---|---|
| 10 | n queries | 26 | `n` = 26; golden set `test/integration/golden/rerank_golden_ru.json` has exactly 26 `queries[]` | MATCH | rerank_result_pairs.json |
| 11 | means: baseline / rerank / random | 0.5472 / 0.5227 / 0.3674 | 0.5472282778757444 / 0.5226557715427288 / 0.36736642205427966 | MATCH (rounds exactly) | rerank_result_pairs.json |
| 12 | lift | −0.0246 | −0.024572506333015554 | MATCH | rerank_result_pairs.json |
| 13 | spread ("разрыв с random") | +0.1799 | 0.1798618558214647 | MATCH | rerank_result_pairs.json |
| 14 | pool coverage | 97.3% | `pool_coverage` = 0.9727626459143969 → 97.3% | MATCH | rerank_result_pairs.json |
| 15 | threshold for "различает порядок" | 0.05 | `threshold` = 0.05 | MATCH | rerank_result_pairs.json |
| 16 | stage1.skipped = 0 on all 26 | 0 on all 26 | Verified: every row has `stats.stage1.skipped: 0` | MATCH | rerank_result_pairs.json rows |
| 17 | wins / losses | 11 / 14 | Recomputed from all 26 rows (rerank vs baseline): 11 wins, 14 losses, 1 tie (row 5, "152-ФЗ трансграничная…", baseline == rerank exactly, 0.8723691259164151 both) | MATCH | rerank_result_pairs.json (recomputed) |
| 18 | correlation(lift, baseline) | −0.636 | −0.6359426048232049 | MATCH | rerank_result_pairs.json (recomputed, Pearson) |
| 19 | avg lift where baseline > 0.6 | −0.323 | n=8 rows, avg lift = −0.32299209846661636 | MATCH | rerank_result_pairs.json (recomputed) |
| 20 | avg lift where baseline < 0.4 | +0.136 | n=7 rows, avg lift = 0.13586564728534284 | MATCH | rerank_result_pairs.json (recomputed) |
| 21 | total local compute time | 480 s | Σ `stats.ms` over 26 rows = 479693 ms = 479.693 s → rounds to 480 | MATCH | rerank_result_pairs.json (recomputed) |
| 22 | median time/query | 14.2 s | sorted ms: …14059, 14190… → median = (14059+14190)/2 = 14124.5 ms = **14.1245 s → rounds to 14.1 s**, not 14.2 | **MISMATCH** (off by 0.1s) | rerank_result_pairs.json (recomputed) |
| 23 | mean time/query | 18.5 s | Σms/26 = 18449.73077 ms = **18.44973 s → rounds to 18.4 s**, not 18.5. (480/26 = 18.4615 does round to 18.5 — likely computed from the rounded 480 s total rather than the precise per-row sum.) | **MISMATCH** (off by 0.1s) | rerank_result_pairs.json (recomputed) |
| 24 | max time/query | 41 s | max `stats.ms` = 41027 ms = 41.027 s → 41 | MATCH | rerank_result_pairs.json |
| 25 | Corpus-mode pool coverage: 31.1%, 6/26 queries zero | 31.1% / 6 of 26 | **Not present as data** in `rerank_result.json` — that file's rows have no `pool_hits`/`graded` fields at all (only candidates/kept/baseline/rerank/random/stats). The figures "31.1% of graded URLs (80/257)... 6 of 26 queries contain none" appear verbatim only in the **source-code comment** `scripts/rerank_benchmark2.mjs:93-96`. 80/257 = 31.13% → rounds to 31.1%, internally consistent. | **PARTIALLY TRACEABLE** — matches a code comment, not a data artifact; cannot be independently re-derived since the corpus has since changed | scripts/rerank_benchmark2.mjs:93-96 (comment only) |
| 26 | Earlier corpus-mode run: means/lift/spread | baseline 0.1758 / rerank 0.1911 / random 0.1310, lift +0.0154, spread +0.0448 | `rerank_result.json`: means.baseline 0.17575393548236456, rerank 0.19113695788912063, random 0.1309765903202004, lift 0.01538302240675607, spread 0.04477734516216417 | MATCH (all round correctly; note: this run itself is described in the report as methodologically unusable — "INCONCLUSIVE", spread 0.045 < 0.05 threshold) | rerank_result.json |

### 1.3 C2 — quality gate A/B (`bench/quality_gate/ab_focused.json`, `ab_critical.json`)

| # | Claim | Report value | Artifact value | Verdict | Source |
|---|---|---|---|---|---|
| 27 | Rejection: 3 of 280, 1.1% | 3/280, 1.1% | total 280, kept 277, rejected 3, rejection_rate 0.010714… → 1.07% → 1.1% | MATCH | ab_focused.json |
| 28 | part_stats.emb (focused): min/p50/max/spread/weight/contribution | 0.731/0.828/0.928/0.197/0.4/0.079 | 0.7312600055306928 / 0.8282947902586112 / 0.9283624011575294 / 0.19710239562683662 / weighted 0.07884095825073466 | MATCH | ab_focused.json |
| 29 | part_stats.authority (focused) | 0.300/0.350/0.650/0.350/0.3/0.105 | 0.3 / 0.35 / 0.65 / 0.35 / weighted 0.105 | MATCH | ab_focused.json |
| 30 | part_stats.llm (focused) | all 0 / weight 0.2 | all 0 | MATCH | ab_focused.json |
| 31 | part_stats.trust (focused) | all 0 / weight 0.1 | all 0 | MATCH | ab_focused.json |
| 32 | Threshold sweep (focused): 0.38→0%, 0.40→1.1%, 0.42→20.7%, 0.44→60.0%, 0.46→89.3%, 0.48→98.9% | as listed | `threshold_sweep`: t0.38 rejected_pct 0, t0.4 → 1.1, t0.42 → 20.7, t0.44 → 60, t0.46 → 89.3, t0.48 → 98.9 | MATCH (all 6 points) | ab_focused.json |
| 33 | Composite range across all 280 | 0.398 … 0.545 | `composites[]` min 0.398, max 0.545 (280 entries) | MATCH | ab_focused.json |
| 34 | Rejected bench source: composite/emb/auth/llm/trust/URL | 0.399 / 0.74 / 0.35 / 0.00 / 0.00 / vc.ru/services/2983098-… | `rejected_bench_sources[0]`: composite 0.399, emb 0.7359930842178668 (→0.74), authority 0.35, llm 0, trust 0, same URL, cited_by "ru_dev_pays_foreign_ai" | MATCH | ab_focused.json |
| 35 | "0.399 против порога 0.400 — отрыв в одну тысячную" | 0.001 | 0.4 − 0.399 = 0.001 | MATCH | ab_focused.json (arithmetic) |
| 36 | critical: total/kept/rejected | 140/140/0 | total 140, kept 140, rejected 0, rejection_rate 0 | MATCH | ab_critical.json |
| 37 | critical threshold sweep: flat 0% to 0.50, 2.1% at 0.55 | as stated | t0.3…t0.5 all rejected_pct 0; t0.55 → 2.1 | MATCH | ab_critical.json |
| 38 | part_stats.emb (critical) | 0.736/0.832/0.928/0.193/0.4/0.077 | 0.7357091826341228 / 0.8317422813351049 / 0.9283624011575294 / 0.19265321852340667 / weighted 0.07706128740936267 | MATCH | ab_critical.json |
| 39 | part_stats.llm (critical): min/p50/max/spread/weight/contribution | 0.500/1.000/1.000/0.500/0.2/0.100 | 0.5 / 1 / 1 / 0.5 / weighted 0.1 | MATCH | ab_critical.json |
| 40 | Composite weights 0.4 emb / 0.3 auth / 0.2 llm / 0.1 trust | as stated (implied) | `DEFAULT_WEIGHTS = { emb: 0.4, auth: 0.3, llm: 0.2, trust: 0.1 }` | MATCH | src/rerank/quality_gate.js:13 |
| 41 | Default threshold 0.4 | 0.4 | `DEFAULT_THRESHOLD = parseFloat(... '0.4')` | MATCH | src/rerank/quality_gate.js:14 |
| 42 | "30% веса композита не участвует в решении" | 30% | llm weight 0.2 + trust weight 0.1 = 0.3 = 30%, both structurally 0 on the sweep path | MATCH (arithmetic + code) | quality_gate.js + ab_*.json |
| 43 | Target rejection "~72%" from ARCHITECTURE.md | ~72% | ARCHITECTURE.md:16 — "~72% rejection rate target" | MATCH | ARCHITECTURE.md:16 |
| 44 | "$0 на 28 запросах вместо $0.20 на 20" | $0 / $0.20 | Script header comment states exactly this rationale (28 already-paid pairs vs 20 live queries); consistent with price_per_request $0.005×~40 calls≈$0.20-ish order of magnitude, not independently re-billable | MATCH (documented rationale, not a measured artifact) | scripts/quality_gate_ab.mjs:13 |
| 45 | trust_score set in exactly 2 places; rerankByTrust only from handleSearch (server.js:263) | as stated | `grep trust_score\s*[:=]` → `src/corpus/meilisearch.js:286`, `:323`, `src/search/rerank.js:51` (2 files); `grep rerankByTrust` → only call site is `src/server.js:263` inside `handleSearch` | MATCH (line number exact) | src/server.js:263, meilisearch.js, search/rerank.js |
| 46 | llm = 0 outside critical, pipeline.js:49 | as stated | `src/rerank/pipeline.js:49`: `if (STAGE2_PRIORITIES.has(entry.priority) && entry.results.length > 1) {` — exactly the stage-2 gate, default `STAGE2_PRIORITIES = {'critical'}` | MATCH (line number exact) | src/rerank/pipeline.js:49 |

### 1.4 C4 — corpus coverage sweep (`bench/corpus_coverage/sweep_final.json`, `sweep_prelim.json`)

| # | Claim | Report value | Artifact value | Verdict | Source |
|---|---|---|---|---|---|
| 47 | Threshold table (rule=mean): 0.55→100/60/20/47%, 0.65→90/40/0/27%, 0.70→80/40/0/27%, 0.80→70/20/0/13%, 0.85→70/0/0/0% | as listed | `table.mean`: t0.55 recall1/fpPlaus.6/fpAlien.2/fpAll.4667→47%; t0.65 .9/.4/0/.2667→27%; t0.7 .8/.4/0/.2667→27%; t0.8 .7/.2/0/.1333→13%; t0.85 .7/0/0/0 | MATCH (all 5 rows, all 4 columns) | sweep_final.json |
| 48 | "Ни одно из трёх правил... не достигает цели ни при одном пороге" / winners empty | true | Every entry in `table.mean`, `table.floor`, `table.floor_deep` has `"meets": false`; `"winners": []` | MATCH | sweep_final.json |
| 49 | floor and floor_deep "совпадают между собой строка в строку" | true | Spot-checked all 14 threshold rows of `table.floor` vs `table.floor_deep`: identical recall/fpPlaus/fpAlien/fpAll at every row | MATCH | sweep_final.json |
| 50 | "лучшее — 80% recall при 20% ложных" | 80% / 20% | `table.floor` (and floor_deep) at t=0.7: recall 0.8, fpAll 0.2 | MATCH | sweep_final.json |
| 51 | Banana query, final: 5 hits, avg 0.619, passes 0.55 | 5 / 0.619 | `observed.alien` "цена на бананы в Эквадоре сегодня": count 5, avg 0.6193411623005118 → 0.619 (> 0.55) | MATCH | sweep_final.json |
| 52 | Banana query, before context ingest: 0.603 | 0.603 | `sweep_prelim.json` same query: avg 0.6033895413028205 → 0.603 | MATCH | sweep_prelim.json |
| 53 | Meilisearch 1.7.6, rankingScoreThreshold unavailable (arrived 1.8) | 1.7.6 | Live `GET /version` (with auth): `pkgVersion: "1.7.6"`, `commitDate: 2024-04-10` — matches script comment "commit 2024-04-10" | MATCH (live-verified, not just self-reported in the JSON) | live Meilisearch /version; sweep_final.json |
| 54 | recallTarget 0.8, fpCeiling 0.1 | 80% / 10% | `recallTarget: 0.8`, `fpCeiling: 0.1` | MATCH | sweep_final.json |

### 1.5 C4b — pre-sweep check (`bench/corpus_coverage/pre_check_probe.json`)

| # | Claim | Report value | Artifact value | Verdict | Source |
|---|---|---|---|---|---|
| 55 | покрытые: n10, covered0/partial5/miss5 | as stated | `groups.covered_tally`: {covered:0, partial:5, miss:5}, array length 10 | MATCH | pre_check_probe.json |
| 56 | правдоподобные непокрытые: n10, covered0/partial0/miss10 | as stated | `plausible_uncovered_tally`: {covered:0, partial:0, miss:10} | MATCH | pre_check_probe.json |
| 57 | заведомо чужие: n5, covered0/partial1/miss4 | as stated | `alien_tally`: {covered:0, partial:1, miss:4} | MATCH | pre_check_probe.json |
| 58 | high_trust sequence for covered group | 0 1 0 2 1 2 0 0 3 1, max 3 | `groups.covered[].high_trust` in order: 0,1,0,2,1,2,0,0,3,1 — max 3 | MATCH (exact sequence) | pre_check_probe.json |
| 59 | "порог covered → >= 5" | ≥5 | `COVERED_MIN_FRESH_HIGH_TRUST = 5` | MATCH | src/sweep/pre_check.js:17 |
| 60 | "engine_count >= 3" as the high-trust threshold | ≥3 | `HIGH_TRUST_ENGINE_COUNT = 3` | MATCH | src/sweep/pre_check.js:16 |
| 61 | "свежих попаданий 15–20 из 20" | 15–20 | `groups.covered[].fresh_hits`: 20,18,16,19,17,20,15,19,18,19 — min 15, max 20 | MATCH | pre_check_probe.json |

### 1.6 C0 — context ingestion

| # | Claim | Report value | Artifact value | Verdict | Source |
|---|---|---|---|---|---|
| 62 | 8 184 files in 406 directories | 8184 / 406 | Live re-run `node scripts/ingest_context_history.mjs --list`: "ingestable directories: 406 (done 406, pending 0)", "context payloads: 8184". Independently: `_endpoint_compare.json.pairs` = 8184. | **MATCH (exact, double-confirmed)** | live re-run; _endpoint_compare.json |
| 63 | 0 documents with backend_source=brave_context before the run | 0 | Stated in `scripts/verify_context_ingest.mjs` code comment ("Measured before this run... exactly 0"); not itself in a stored JSON. Consistent with a $0-context-value corpus prior to today. | MATCH (code comment, not a data artifact) | scripts/verify_context_ingest.mjs (comment) |
| 64 | Corpus 359 092 → 384 368 (+7.04%) | +7.04% | Baseline 359092 is a script CLI default/comment, not a stored count. Live re-run right now (hours after the report): 384490 docs, growth vs 359092 = 7.07%. The report's own snapshot (384368) is no longer reproducible because the corpus is live and keeps growing; the shape (~+7%) is confirmed. | **MATCH-BY-LIVE-REDERIVATION** (drifted ~+122 docs since the report was written; not a frozen artifact) | live re-run of scripts/verify_context_ingest.mjs |
| 65 | context-only documents: 0 → 5 872 (exact count via documents endpoint, not estimatedTotalHits) | 5872 | Live re-run: `documents whose ONLY source is llm/context : 5869` (3 fewer — consistent with continued drift). Method (documents-endpoint `.total`, not `search()` `estimatedTotalHits`) independently verified correct: live `estimatedTotalHits` on an unrelated filtered query capped at exactly **1000** during this audit (see finding below), confirming the saturation risk the report explicitly worked around. | **MATCH-BY-LIVE-REDERIVATION** (5869 vs 5872, drift) | live re-run; live sanity check of estimatedTotalHits cap |
| 66 | crawled_at_ms: 384 367 / 384 367 (100%) | 100% | Live re-run: `crawled_at_ms present : 384489 (100.0% of the corpus)` — percentage matches exactly, absolute count drifted (+122, same drift as total corpus size) | MATCH-BY-LIVE-REDERIVATION | live re-run |
| 67 | Merge integrity: 5/5 sample intact (title, engines, text) | 5/5 | Live re-run: `5/5 intact` on a fresh 5-doc sample | MATCH (mechanism; different concrete sample each run, as expected) | live re-run |
| 68 | Directories ok/fail: 382/4 → after retry 406/0 | 382/4 → 406/0 | Final state (406/406, 0 pending) confirmed via `_context_ingest_state.json` (`done` array length = 406) and live `--list` re-run. The **intermediate** 382/4 split (before the retry) is not stored anywhere — `_context_ingest_state.json` only ever records successes (`done[]`); failures are console-only (`console.error`) and never written to disk. Internally consistent: 20 (pilot) + 382 + 4(retried) = 406. | Final state: MATCH. Intermediate split: **UNTRACEABLE** | _context_ingest_state.json (final only); console output not persisted |
| 69 | Documents indexed: 225 453 + 16 259 | 225453 + 16259 | `j.indexed` values returned by `/ingest/brave` per directory are only `console.log`'d (`ingest_context_history.mjs:149`), never written to a file. No artifact contains these totals. | **UNTRACEABLE** | — (console-only) |
| 70 | Retry batch breakdown: +3868/+4022/+4171/+4198 | as listed | Same as above — console-only. Sums to 16259 exactly (internally consistent arithmetic), but not independently verifiable against any stored artifact. | **UNTRACEABLE** (internally consistent) | — |
| 71 | Old `backfill-crawl-timestamp.mjs` capped by `maxTotalHits=1000`, misses past first 1000 of "370k" | 1000 / ~370k | Mechanism confirmed structurally: this is precisely how Meilisearch's `search()` pagination behaves (verified live during this audit — see #65). "370k" is a rounded, order-of-magnitude reference to corpus size at the time (actual ~359k–384k), not a precise claim. | MATCH (mechanism); "370k" is an approximation, not a measured figure | mechanism confirmed live; figure is descriptive |
| 72 | Meilisearch queue: 8 600–18 700 tasks during the run | range | Console-only observation during a run that has since completed; Meilisearch task-queue state at that point in time is not recoverable. No stored artifact. | **UNTRACEABLE** | — |
| 73 | 9 641 tasks in `processing` at one instant; counter jumped 10 439 → 798 | 9641 / 10439→798 | Same — point-in-time console observation, not persisted anywhere. | **UNTRACEABLE** | — |
| 74 | Observed batching throughput: 34–59 tasks/s | 34–59/s | Same — not persisted. | **UNTRACEABLE** | — |
| 75 | `crawled_at_ms` backfill: 384 367 docs in 50.1 s, ~384 tasks | 50.1s / ~384 | `scripts/backfill-crawled-at-ms.mjs` prints `elapsed=...s` to console only (line 73), never written to a file. Cannot be re-derived: the corpus is now already 100% backfilled, so a fresh run would report ~0 updates, not the historical timing. | **UNTRACEABLE** | — |
| 76 | One Meilisearch task per document via `addDocuments([merged])` | mechanism claim | `src/corpus/meilisearch.js:86`: `await idx.addDocuments([merged])`, called once per `index(doc)` invocation (i.e. once per document, never batched) | MATCH (code-confirmed) | src/corpus/meilisearch.js:86 |
| 77 | Live freshness-filter demo: ISO filter → 400 "invalid float literal"; `crawled_at_ms` filter → 200, hits 3 / hits 0 for future cutoff | 400 error text; hits 3; hits 0 | Error text mechanism confirmed verbatim: the exact string "invalid float literal" appears both in the live code comment (`meilisearch.js:30-31`) and in the stub test's simulated error (`test/unit/corpus/freshness_filter.test.js:19`). Re-ran live just now: future cutoff → **0 hits** (matches); a 30-day-ago cutoff → nonzero hits (mechanism sound). The specific historical "hits: 3" is a point-in-time value not stored anywhere and not reproducible (corpus has changed). | Mechanism: MATCH (live re-verified). Specific historical counts: **UNTRACEABLE** | live re-run; meilisearch.js comment; freshness_filter.test.js |
| 78 | freshness_filter.test.js: 13 tests | 13 | `grep -c "^\s*(it|test)("` on the file = 13 | MATCH | test/unit/corpus/freshness_filter.test.js |
| 79 | ndcg.js: "старое поведение сохранено под флагом, 7 прежних тестов зелёные" | 7 | `git show HEAD:test/unit/rerank/ndcg.test.js` (pre-tier-C version) has exactly 7 test cases; current file has 16 (7 old + 9 new); `test:all` run today shows 0 fail overall, so the 7 legacy tests are confirmed still green under the `idealFromGolden`-flag-off default path (`ndcg.js:78`: `if (!opts.idealFromGolden) return ndcg(gains, k)`) | MATCH | git show HEAD:test/unit/rerank/ndcg.test.js; src/rerank/ndcg.js:57-66 |

### 1.7 Code-changes table + tests + spend

| # | Claim | Report value | Artifact value | Verdict | Source |
|---|---|---|---|---|---|
| 80 | Files-touched table (11 files/dirs listed) all actually modified/new | — | Cross-checked against `git status --short`: every listed file (`src/corpus/meilisearch.js`, `src/search/brave_adapters.js`, `src/rerank/ndcg.js`, `scripts/rerank_benchmark2.mjs`, `scripts/corpus_coverage_sweep.mjs`, `scripts/quality_gate_ab.mjs`, `scripts/backfill-crawled-at-ms.mjs`, `scripts/verify_context_ingest.mjs`, `scripts/pre_check_falsepos.mjs`, `test/unit/corpus/freshness_filter.test.js`, `bench/corpus_coverage/queries.json`, `bench/quality_gate/queries.txt`) is confirmed modified (M) or untracked (??) | MATCH (all present), but see completeness note below | git status |
| 81 | Test counts: 342 total, 340 pass, 0 fail, 2 skip | 342/340/0/2 | Live re-run `npm run test:all` (test:all as currently defined in package.json): `tests 342`, `suites 66`, `pass 340`, `fail 0`, `cancelled 0`, `skipped 2`, `todo 0` | **MATCH, exact, all 4 numbers** | live re-run of `npm run test:all` |
| 82 | "(было 318 на входе в тир)" | 318 | Measured the actual pre-tier-C baseline directly: created a temporary `git worktree` at HEAD (commit 827243b, the tip before all of today's uncommitted changes) with a `node_modules` junction, ran the OLD `test:all` script (package.json at HEAD lists 4 fewer files: no `brave_pacing.test.js`, `env_order.test.js`, `clean/structured.test.js`, `corpus/freshness_filter.test.js`) → **`tests 277`, `pass 275`, `fail 0`, `skipped 2`**. Worktree removed afterward. | **MISMATCH** — measured baseline is 277, not 318 (see note below) | live re-run in isolated `git worktree` at HEAD |
| 83 | Spend: 9 paid requests, $0.04 | 9 / $0.04 | `data/cache.db`, table `sprint_metrics` (read via `node:sqlite` `DatabaseSync(..., {readOnly:true})`), all rows on 2026-08-04 UTC before the report's own mtime (17:33 UTC): 5 `brave_web` rows totalling **queries=9** (3+1+1+2+2) — MATCHES exactly. `cost_usd` sum = 0.015+0.005+0.005+0.01+0.01 = **0.045000000000000005** → `.toFixed(2)` = **"0.05"**, not "0.04". (9 queries × the DB's own $0.005/query rate = $0.045 exactly.) | Query count: MATCH. Dollar figure: **MISMATCH** (precise value rounds to $0.05, not $0.04) | data/cache.db → sprint_metrics (SQL) |
| 84 | Defect: `server.js` has no `ultra-broad` case in the backend-billing map, so free corpus hits get billed as `brave_web` | mechanism claim | `src/server.js:1042-1044`: `const backend = pri === 'broad' ? (searxng?'searxng':'brave_web') : (pri === 'critical' ? 'brave_context' : 'brave_web')` — no branch for `'ultra-broad'`, which is a real distinct priority value (`src/sweep/runner.js:56`: `VALID_PRIORITIES = new Set(['ultra-broad','broad','focused','critical'])`); it falls into the final `else` → `'brave_web'`. Confirmed in the ledger: `sprint_metrics` has **every** `priority='ultra-broad'` row billed as `backend='brave_web'` (no other backend value ever appears for that priority) | MATCH (code-confirmed and ledger-confirmed) | src/server.js:1042-1044; cache.db |
| 85 | **Quantification** (requested by audit brief, not itself a report claim): how much of lifetime spend does the ultra-broad→brave_web mislabel account for | — | `SUM(cost_usd) WHERE priority='ultra-broad' AND backend='brave_web'` = **$0.03** (6 queries, 4 sprint rows). Lifetime total `SUM(cost_usd)` over all 11291 rows = **$234.09**. $0.03 / $234.09 = **0.0128% ≈ 0.01%** of lifetime spend. Negligible in dollar terms (ultra-broad is barely used), but the defect is real and would grow if the tier were ever enabled. | Computed (not a claim to match against) | cache.db → sprint_metrics |
| 86 | "23 шима brave_sweep.py... canonical ~118KB" | 23 / ~118KB | **Not a claim in the audited report** (TIER-C-RESULTS-2026-08-04.md contains no occurrence of "шим"/"shim"). It appears in the sibling plan doc `TIER-C-REVERIFICATION-2026-08-04.md` (§R5: "23 шима brave_sweep.py проходят --selftest") and as a to-do correction there ("3. Исправить число шимов: 23, а не 24"). Verified anyway per the audit brief: `find D:/Yahia -name brave_sweep.py` → 141 files total, exactly **23** are under 3000 bytes (all 1185 or 1214 bytes — clear shim/stub files), the rest range 64547–117946 bytes. The canonical copy at `D:/Yahia/active/qsearch/research/scripts/brave_sweep.py` is **117946 bytes ≈ 115.2 KiB / 117.9 KB** (≈"~118KB" using decimal-KB convention). | **N/A for this document** (claim lives in TIER-C-REVERIFICATION-2026-08-04.md, not the audited file); underlying count independently confirmed = **23** | filesystem census under D:/Yahia |

---

## 2. MISMATCHES and UNTRACEABLE claims — most serious first

### Mismatches

1. **Test baseline "было 318 на входе в тир" — measured 277, not 318.** (§1.7 #82) This is the most consequential finding: a temporary `git worktree` at the last commit (827243b, all of today's tier-C work is uncommitted on top of it) reproducibly gives `tests 277 / pass 275 / fail 0 / skipped 2` under the pre-tier-C `test:all` script. The report's "342, 340 pass... (было 318)" implies +24 net new tests from tier C; the artifact-backed number is +65 (342−277). Caveat: git can only cleanly separate *committed* from *uncommitted* state — if some of today's uncommitted diff predates "tier C entry" for reasons outside tier C's own file list (e.g. `test/unit/cache.test.js` and `test/unit/backends/brave_pacing.test.js`/`env_order.test.js`/`clean/structured.test.js` are **not** mentioned anywhere in the report's own "Что сделано в коде" table, yet they are modified/new in the working tree), a perfectly clean "tier-C-entry" snapshot does not exist as a checkable artifact. What is certain: 318 matches neither the current state (342, confirmed) nor the last commit (277, confirmed) — it sits unexplained between them.
2. **Spend "$0.04" — precise sum is $0.045, which rounds to $0.05.** (§1.7 #83) The query count (9) and per-query rate ($0.005) both match the ledger exactly; only the final rounding is off by one cent. Likely a manual/eyeballed rounding rather than a computed `.toFixed(2)`.
3. **C1 median time "14.2 s" — precise value is 14.1245 s, rounds to 14.1 s.** (§1.2 #22)
4. **C1 mean time "18.5 s" — precise value is 18.44973 s, rounds to 18.4 s.** (§1.2 #23) Both #3 and #4 round in the same (upward) direction; #23 reconciles cleanly if computed as rounded-total÷n (480/26 = 18.4615 → 18.5) instead of mean-of-precise-per-row-values — suggests a chained-rounding artifact rather than two independent errors.

### Untraceable (no artifact found; council of increasing severity)

1. **"90 против 70" (§1.1 #7)** — the prior C3 measurement that this whole report exists to retract has no supporting artifact anywhere in the repository. This is the headline number the report opens with, and it cannot be independently checked at all (by design, arguably — it is presented as history being overturned — but "cannot be checked" also means it cannot be confirmed to have been a real prior output rather than a recollection).
2. **C0 process telemetry (§1.6 #69, #70, #72, #73, #74, #75)** — indexed-document totals (225453+16259), the retry-batch breakdown (+3868/+4022/+4171/+4198), Meilisearch queue depth (8600–18700), the "9641 tasks in `processing`" snapshot, the 10439→798 counter jump, the 34–59 tasks/s throughput, and the 50.1 s backfill timing are all `console.log`-only output from scripts that never persist these numbers to a file (`ingest_context_history.mjs`, `backfill-crawled-at-ms.mjs`). They are internally arithmetically consistent (16259 = 3868+4022+4171+4198; 406 = 20+382+4) but not independently re-derivable — the live system has moved on and a re-run now would report near-zero deltas (already ingested / already backfilled).
3. **C4 intermediate directory split "382/4" (§1.6 #68)** — the *final* 406/0 state is confirmed (state file + live re-run); the pre-retry 382/4 split is not stored anywhere.
4. **C0 live filter demo "hits: 3" / "hits: 0" (§1.6 #77)** — mechanism re-verified live in this audit (future cutoff → 0 hits, confirmed); the specific historical "hits: 3" for a 30-day window is a point-in-time value with no artifact.
5. **C3 "20 п.п. больше терминов эталона" at equal 8000-char budget (§1.1 #9)** — the equal-budget mechanism is real and code-confirmed, but no artifact stores the actual term-coverage delta.
6. **C1 corpus-mode "31.1% (80/257), 6 of 26" (§1.2 #25)** — present verbatim in a source-code comment (`scripts/rerank_benchmark2.mjs:93-96`), not in the `rerank_result.json` data file it purportedly describes, and not re-derivable now.

---

## 3. R7 — dependency-claim findings

### Central claim: "C0 was a prerequisite for C1" — **does not hold for the measurement actually reported**

Read `src/rerank/embedding_rerank.js` in full: `rerankByEmbedding(query, results)` embeds `resultText(r) = (r.title + '\n' + r.description).slice(0,800)` for each candidate **already present in the `results` array it is handed**. It never queries Meilisearch, never imports any corpus module, and has no code path that touches the corpus at all — its only I/O is to Ollama for embeddings.

Read `scripts/rerank_benchmark2.mjs` in full: it supports two candidate sources, selected by `--from`:
- **`pairs` mode** (the default, and the mode that actually produced the number in the report's summary table — `rerank_result_pairs.json` has `"from": "pairs"`): `candidatesFromPairs()` reads `bench/ru/questions.jsonl` and each question's `pair_web` JSON file **from local disk** via `readFileSync`. Zero network calls, zero Meilisearch, `$0` cost by construction (per the script's own header comment: "Both candidate sources are read-only and cost $0: `pairs` reads saved sweep files from disk"). This mode has **no dependency on the corpus, hence none on C0**, whatever state C0 left the corpus in.
- **`corpus` mode** (the earlier, explicitly-superseded run — `rerank_result.json`): `candidatesFromCorpus()` does call `POST /search` with `corpus_only: true`, which does hit the live Meilisearch corpus. This mode genuinely depends on corpus content. But (a) the report itself disqualifies this run's result ("Пул кандидатов брался из корпусной выдачи... Переключено на сохранённые пары", spread 0.045 < 0.05 threshold → the script's own gate calls it `⚠ INCONCLUSIVE`), and (b) even a post-C0 corpus would not obviously have fixed the problem that made it inconclusive: C0's own description says context ingestion "в основном углубляет уже существующие записи, а не плодит дубликаты" (mostly deepens existing URLs rather than adding new ones), while the corpus-mode failure mode was **pool coverage** — whether specific gold URLs are present in the corpus at all — a recall/coverage problem that deepening existing documents' text does not address.

In production, the same structural independence holds: `rerankPipeline` is invoked only at `src/server.js:987` and `:1341` (both confirmed by direct grep), inside `/sweep` and `/cached_sweep`, always over **Brave's own returned results**, never over corpus data. `embedding_rerank.js` has no corpus import in any code path, benchmark or production.

**Conclusion: the C0→C1 prerequisite claim is true only for a discarded, non-decisive run, and false for the pairs-mode measurement that the report's own summary table reports (baseline 0.5472 / rerank 0.5227 / lift −0.0246).** The report's C0 section header ("Предпосылка для C1 и C4") should be corrected to name only C4.

### C0 → C4: **holds**

`scripts/corpus_coverage_sweep.mjs` imports `MeilisearchCorpus` directly and calls `corpus.corpusLookup(...)` and `idx.search(...)` against the live index for every query in every group — this is a hard, direct dependency on corpus state, confirmed by reading the script. Empirically confirmed too: the "цена на бананы в Эквадоре сегодня" alien-query average ranking score measurably moved between the pre-C0 sweep (`sweep_prelim.json`, avg 0.6033895413028205) and the post-C0 sweep (`sweep_final.json`, avg 0.6193411623005118) — a real, measured effect of C0 on C4's signal. The freshness-filter fix that C4's Defect 1 discussion turns on (`crawled_at_ms`, `src/corpus/meilisearch.js:29-34`) is also structurally part of making C4 measurable on the full corpus. This dependency is real and correctly stated.

### Other "X blocks/requires Y" statements found in the report

- **"Завершение скрипта ≠ готовность индекса... Ждать надо опустошения очереди, а не последней строки лога."** (C0 section) — an operational precondition for C1/C4 validity: measurements must wait for Meilisearch's async indexing queue to drain, not just for the ingestion script's process to exit. This is a real and correctly-reasoned constraint on **C4** (whose dependency on corpus state is real, see above); it does not change the C1 finding, which is independent of corpus state entirely in the mode that was reported.
- **"До бэкфилла новая форма возвращала пустую выдачу... между правкой кода и бэкфиллом фильтр... отсекал всё"** (C4 Defect 1) — an internal ordering dependency (schema field `crawled_at_ms` must exist on documents → written by `meilisearch.js:83-84` on every `index()` call → then `scripts/backfill-crawled-at-ms.mjs` must backfill pre-existing documents → only then is the freshness filter safe to rely on across the whole corpus). Confirmed correct by reading `meilisearch.js` and `backfill-crawled-at-ms.mjs`: the filter (`corpusLookup`, line 139) filters on `crawled_at_ms >= cutoffMs`, and Meilisearch excludes documents lacking a filtered attribute — so pre-backfill, the filter would silently narrow to zero on old documents, exactly as claimed. This is a within-C4 implementation-order claim, not a cross-tier one, and it holds.
- No other "X blocks Y" / "X — prerequisite for Y" statements were found in the report body outside the C0 section and the two above.

---

## 4. Corrections required

1. Either drop C1 from "Предпосылка для C1 и C4" in the C0 section header, or add an explicit caveat that the dependency holds only for the discarded corpus-mode run, not for the pairs-mode result the summary table reports.
2. Re-check the "(было 318 на входе в тир)" parenthetical — direct measurement of the last commit's `test:all` gives 277, not 318. If "318" refers to some other checkpoint, that checkpoint is not currently reconstructable from git history or any saved artifact; either name the checkpoint precisely or correct the number.
3. Change spend "$0.04" → "$0.05" (9 queries × $0.005/query = $0.045, which rounds up), or show the unrounded $0.045.
4. C1 timing: "медиана 14.2 с" → 14.1 с; "среднее 18.5 с" → 18.4 с (both computed directly from `rerank_result_pairs.json` rows' `stats.ms`).
5. Optional/minor: the "Что сделано в коде" table omits `scripts/ingest_context_history.mjs` — the actual C0 ingestion driver, and the one script most central to the section it supports — despite it being a new, untracked file today. Also omitted: `scripts/build_rerank_golden.mjs`, `scripts/bench_judge_ru.mjs`, `scripts/bench_pairs.mjs`, `scripts/brave_locale_probe.mjs`, `scripts/endpoint_compare.mjs` (all new/untracked, all tier-C-adjacent). Not a numeric error, but the table is not a complete file list.
6. The "90 против 70" figure that the report's entire C3 section exists to retract has no supporting artifact anywhere in this repository — worth a one-line provenance note (which prior run/report it came from) so the retraction is checkable, not just assertable.

---

## 5. What fully matched (for calibration)

Every number in C2 (both `ab_focused.json` and `ab_critical.json`, including the full `part_stats` tables, the threshold sweeps, the composite bounds, and the single named rejected bench source) matched exactly. Every number in C4b (`pre_check_probe.json`, including the exact `high_trust` sequence `0 1 0 2 1 2 0 0 3 1`) matched exactly. C4's threshold table (`sweep_final.json`, all 5 cited rows × 4 columns) matched exactly, and the live Meilisearch version (1.7.6) was independently re-verified against the running server, not just taken from the JSON. C3's entire results table (28 rows summarized into group/side/verdict counts, 24 cells) matched exactly against `results.json`. C1's headline numbers (means, lift, spread, pool coverage, win/loss count, correlation, and the two conditional-lift figures) all matched exactly against `rerank_result_pairs.json`, including two figures (correlation −0.636, and both conditional lifts) that required independent recomputation from the 26 raw rows rather than being copy-checkable. The current test-suite state (342/340/0/2) was reproduced exactly by an independent live run. The C0 file/directory counts (8184 files, 406 directories) were reproduced exactly by an independent live re-run of the same script in list-only mode, and separately corroborated by a static artifact (`_endpoint_compare.json`). No count in the report was found using Meilisearch's `estimatedTotalHits` where an exact figure was claimed — the report consistently and correctly used the documents-endpoint `.total` field for exact corpus counts, and explicitly flags the `estimatedTotalHits`/1000-cap risk in its own text (twice) — a risk this audit independently reproduced live (an unrelated live query capped at exactly `estimatedTotalHits: 1000` during verification).
