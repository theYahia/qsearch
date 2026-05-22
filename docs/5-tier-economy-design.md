# qsearch 5-Tier Economy Stack — Architecture Design

> **Update 2026-05-22:** **P1 ultra-broad SHIPPED** (opt-in, $0). New: `MeilisearchCorpus.corpusLookup()`, `corpusLookupAsBrave()` + router `ultra-broad` branch (corpus-first, falls through to broad on miss), `VALID_PRIORITIES` extended in both `src/sweep/runner.js` and `brave_sweep.py`, time-sensitive label downgrade (`news_*`/`market_*`/`regulatory_*` → broad), env knobs `QSEARCH_ULTRA_BROAD_MIN_SCORE` (0.55) / `QSEARCH_ULTRA_BROAD_MAX_AGE_DAYS` (30). Tests: `test/unit/sweep/ultra_broad.test.js`. **P0 benchmark + P2 paid-deep DEFERRED** (paid-deep needs API keys + budget decision; its G1 gate is the benchmark's purpose, so both defer together).
>
> **Status:** design draft (rd239), 2026-05-20. No code changes. Captures the proposed extension from today's 3-tier routing (`broad / focused / critical`) to a 5-tier ladder that adds a free local-corpus tier below `broad` and a paid-deep tier above `critical`.
> **Author:** agent 4.7
> **Scope:** queries.txt routing convention + `brave_sweep.py` dispatch + qsearch `src/sweep/router.js`. Does NOT touch Meilisearch index format, Brave SDK, or x402 monetization.

---

## 0. TL;DR

| Tier | Backend | Cost / query | Latency p50 | G1 quality | When |
|---|---|---|---|---|---|
| **ultra-broad** *(new)* | Meilisearch corpus only | $0 | 5-30 ms | 0.10-0.35 | Known-answer / repeat sprint queries already covered by past research |
| **broad** | qsearch `/sweep` (SearXNG + Meilisearch dedup) | $0 | 1.5-4 s | 0.45-0.60 | Scoping, sanity checks, triage. Heavy-max ~70% queries |
| **focused** | Brave web + `extra_snippets` | ~$0.005 | 0.8-2 s | 0.65-0.78 | Phase 4 deep-read fan-out. Heavy-max ~25% queries |
| **critical** | Brave web + LLM Context endpoint | ~$0.01 | 2-5 s | 0.78-0.85 | Load-bearing claims. Heavy-max ~5% queries |
| **paid-deep** *(new)* | Brave Pro / Exa.ai `/research` / Perplexity sonar-deep | $0.05-0.10 | 8-30 s | 0.85-0.93 | >$10k decisions, hire/pivot/launch, frontier verify |

5 syntax field values in `queries.txt` (3rd field). Defaults preserved (`broad`). Backwards compat guaranteed (existing 2- and 3-field lines parse unchanged).

---

## 1. Current state (3-tier baseline)

**Where it lives today:**
- `D:/Yahia/tools/research-backend/brave_sweep.py` lines 520-570 — `parse_queries_file` returns `(label, query, priority, domain)` with `VALID_PRIORITIES = {"broad", "focused", "critical"}` (default `broad`).
- `D:/Yahia/active/qsearch/src/sweep/router.js` — `createSweepRouter()` returns a closure that dispatches by `(priority, domain)`: `broad` → SearXNG; `focused/critical` → Brave web w/ `extra_snippets`. Domain modifier `scholarly` overrides priority → academic backend.
- `critical` also forces Brave LLM Context regardless of `--include-context` CLI flag (CLAUDE.md §4.1).

**Today's invariants:**
- $0 path = qsearch SearXNG.
- Paid path = Brave web only.
- No tier above Brave Context (operationally: when we need depth we wholesale-WebFetch top URLs from Brave, which costs ~30k Claude tokens — CLAUDE.md §2.1 explicitly forbids this for >1-3 critical gaps).
- No tier below SearXNG (broad always hits the network).

**Two unaddressed gaps:**
1. **Repeat-query waste.** Heavy-max sprints reuse seed queries across sessions. Each repeat costs SearXNG round-trips + cleans/embeds even though qsearch already indexed identical Brave/qsearch output last week. Meilisearch is sitting on the answer at ~5ms lookup latency.
2. **Frontier ceiling.** When a load-bearing claim doesn't resolve via Brave Context (paywall PDF, methodology buried in supplementary materials, contradictory secondary sources), we fall back to manual WebFetch — burning Claude pool tokens. Exa's `/research` endpoint and Perplexity `sonar-deep-research` are designed exactly for this: agentic deep-read with citations, $0.05-0.10/q. **For >$10k decisions this is rounding error.**

---

## 2. Proposed 5-tier ladder — per-tier spec

### 2.1 ultra-broad *(new bottom tier)*

| Property | Value |
|---|---|
| **Backend** | Meilisearch `corpus_qsearch` index only. No network. |
| **Endpoint** | `qsearch /corpus_lookup?query=...&min_score=0.55&max_age_days=90` (new endpoint, ~40 LOC on top of existing `src/corpus/meilisearch.js`) |
| **Cost / query** | $0 (electricity only) |
| **Latency p50** | 5-30 ms |
| **G1 quality** | 0.10-0.35 (depends on corpus coverage for the topic) |
| **Use-case** | (a) **Repeat queries** in long-running research threads (e.g. "qdrant production deploy 2026" queried in 3 separate sprints). (b) **Scoping queries** where you just need to know "have we touched this niche before?" (c) **Pre-flight** before running `broad` — if corpus already returns 5+ high-score hits, skip the SearXNG round-trip. |
| **Routing logic** | `queries.txt` 3rd field = `ultra-broad`. Router walks: Meilisearch hit count ≥3 AND avg score ≥`min_score` → return as Brave-shaped response (reuse existing `searxngAsBraveResponse` shape). Else **fall through to `broad`** (don't fail the query). |
| **Implementation cost** | New `/corpus_lookup` endpoint in `src/server.js` (~25 LOC). New `corpusAsBraveResponse(hits)` adapter in `src/corpus/meilisearch.js` (~30 LOC). Router branch in `src/sweep/router.js` (~10 LOC). Python: 3 new lines in `VALID_PRIORITIES`, plus 1 new line in `priority == "ultra-broad"` POST branch (sends 3rd field unchanged to qsearch which now handles it). **Total: ~70 LOC.** |
| **Risks** | (R1) **Stale data on time-sensitive topics** — market/news/regulatory queries returned from 90-day cache misrepresent current state. **Mitigation:** `max_age_days` per-tier override; default to 30 days for ultra-broad. Hard-block if any query label matches `news_*` / `market_*` / `regulatory_*` patterns. (R2) **Coverage illusion** — corpus returns 5 hits for adjacent topic, looks like a real answer but G1 is low. **Mitigation:** when ultra-broad returns hits, **also write a `_ultra_broad.md` audit log** listing the 5 hits + their original sprint provenance — synthesis phase can spot drift. (R3) **Distance from "research" intent** — users typing `/research <topic>` for a *new* topic shouldn't get stale corpus hits. **Mitigation:** make ultra-broad **opt-in only** (default queries.txt rows route to `broad`, not `ultra-broad`); users explicitly tag repeat queries. |

### 2.2 broad *(unchanged)*

| Property | Value |
|---|---|
| **Backend** | qsearch `/sweep` → SearXNG (Google + DuckDuckGo + Bing aggregator) → dedup vs Meilisearch corpus |
| **Cost / query** | $0 |
| **Latency p50** | 1.5-4 s |
| **G1 quality** | 0.45-0.60 |
| **Use-case** | Default tier. ~70% of heavy-max queries: scoping, sanity, triage, secondary cross-validation. |
| **Routing** | 3rd field = `broad` or omitted. |
| **Implementation** | Exists. No change. |
| **Risks** | Existing: SearXNG instance availability; rate-limit cascades from upstream Google/DDG. |

### 2.3 focused *(unchanged)*

| Property | Value |
|---|---|
| **Backend** | Brave web + `extra_snippets=ON` |
| **Cost / query** | ~$0.005 |
| **Latency p50** | 0.8-2 s |
| **G1 quality** | 0.65-0.78 |
| **Use-case** | Phase 4 deep-read fan-out, Brave-grounded snippet harvest. ~25% of heavy-max queries. |
| **Routing** | 3rd field = `focused`. |
| **Implementation** | Exists. No change. |
| **Risks** | Brave plan rate-limit (1 RPS Free, 20 RPS Pro); `BRAVE_API_KEY` required in `<project>/.env.local`. |

### 2.4 critical *(unchanged)*

| Property | Value |
|---|---|
| **Backend** | Brave web + LLM Context endpoint (forced regardless of CLI flag) |
| **Cost / query** | ~$0.01 |
| **Latency p50** | 2-5 s |
| **G1 quality** | 0.78-0.85 |
| **Use-case** | Load-bearing claims, ~5% of heavy-max queries. |
| **Routing** | 3rd field = `critical`. |
| **Implementation** | Exists. No change. |
| **Risks** | Brave Context monthly quota; partial coverage on niche RU/medical/legal sources. |

### 2.5 paid-deep *(new top tier)*

| Property | Value |
|---|---|
| **Backend** | Pluggable. Initial: **Exa.ai `/research`** (primary, agentic citation chase). Secondary: **Perplexity `sonar-deep-research`** (fallback if Exa fails or topic is current-events). Tertiary: **Brave Pro `/answers` with `enable_research=true` + `research_maximum_number_of_iterations=5`** (already supported in brave_sweep.py L711-724 — just needs CLI/routing exposure). |
| **Cost / query** | Exa: ~$0.05 fixed (3-5 iter agentic loop). Perplexity sonar-deep: ~$0.08 (1 deep query = ~$0.005 base + ~$15/M output tokens × ~5k tokens). Brave Pro Answers research-mode: ~$0.02-0.05 depending on iters. |
| **Latency p50** | 8-30 s (these are agentic — they read, iterate, refine) |
| **G1 quality** | 0.85-0.93 (validated indirectly via published benchmarks; **not yet measured for our G1 rubric** — see Risks) |
| **Use-case** | (a) **>$10k decisions** — pivot, hire, capex, launch where being wrong = months of waste. (b) **Frontier verify** for medical/legal/Russian load-bearing content (CLAUDE.md v9.3 hard rule). (c) **Disconfirming search** Phase 6 — when 2-3 angles don't surface counter-evidence and you suspect availability bias. |
| **Routing** | 3rd field = `paid-deep`. New 4th-field modifier optional: `paid-deep:exa` / `paid-deep:perplexity` / `paid-deep:brave-pro`. Default: `exa`. |
| **Implementation cost** | New backend module `src/backends/exa.js` (~120 LOC, Exa REST is simple). Adapter `exaAsBraveResponse()` to keep router pure (~40 LOC). Optional `src/backends/perplexity.js` (~100 LOC, OpenAI-compat). Router branch (~15 LOC). Python `brave_sweep.py`: extend `VALID_PRIORITIES`, branch in main dispatch to POST to qsearch `/sweep_paid_deep` endpoint (~30 LOC). **Total: ~300 LOC** for Exa-only; +100 LOC for Perplexity addon. Brave Pro Answers research-mode: already in `brave_sweep.py` L711-724, needs `--enable-research` CLI flag + router exposure (~20 LOC). |
| **Risks** | (R1) **Quality unmeasured.** G1 0.85-0.93 is vendor-claimed; **mandatory step 0 of implementation is run 30-query benchmark vs critical tier on a known-answer corpus before promoting**. If gap < 0.05, paid-deep is dead — too expensive vs critical. (R2) **API stability.** Exa is YC W22, Perplexity API has had breaking changes in 2025. Mitigation: pluggable backend selection per query, soft-fail to `critical` if backend returns 5xx. (R3) **Budget runaway.** A heavy-max sprint with 30 paid-deep queries = $1.50-3.00. **Mitigation:** hard cap default `--max-paid-deep 10` per sweep, error if `queries.txt` exceeds without explicit `--force`. (R4) **ZDR / privacy** — Exa retains query logs; not safe for confidential client topics. Mitigation: domain modifier `confidential` forces fallback to `critical` even if user typed `paid-deep`. |

---

## 3. Routing logic — `queries.txt` 3rd-field grammar

Current grammar (brave_sweep.py L520, L544-564):
```
label|query|priority|domain
```
- `priority ∈ {broad, focused, critical}`, default `broad`
- `domain ∈ {general, scholarly, ru}`, default `general`

Proposed grammar:
```
label|query|priority|domain
```
- `priority ∈ {ultra-broad, broad, focused, critical, paid-deep}`, default `broad`
- `domain ∈ {general, scholarly, ru, confidential}`, default `general`
- New 4th-field modifier optional for `paid-deep`: `paid-deep:exa` / `paid-deep:perplexity` / `paid-deep:brave-pro` (parsed as priority string with colon-suffix; router strips before dispatch).

**Validation rules:**
- `confidential` domain + `paid-deep` priority → router downgrades to `critical`, logs warning.
- `news_*` / `market_*` / `regulatory_*` label prefix + `ultra-broad` priority → router downgrades to `broad`, logs warning. Override with explicit `--allow-stale-ultra-broad` CLI flag.
- Unknown priority → reject with explicit error (do NOT silently default — error spelling helps catch typos).

**Example queries.txt:**
```
# Ultra-broad: known answer from prior sprint
qdrant_basics|qdrant production deployment 2026|ultra-broad

# Broad: scoping
competitors_scan|self-hosted vector DB benchmarks|broad

# Focused: deep read for Phase 4
qdrant_perf|qdrant production qa load benchmarks 2026|focused

# Critical: load-bearing
qdrant_zdr|qdrant cloud zero data retention SLA 2026|critical

# Paid-deep: pivot decision, agentic
qdrant_vs_milvus|qdrant vs milvus production deployment lessons 2024-2026|paid-deep:exa

# Russian + scholarly defaults preserved
ru_legal|статья 54.1 НК РФ свежая судебная практика|focused|ru
```

---

## 4. Cost table — full-stack heavy-max sprint comparison

**Baseline:** heavy-max with 200 queries, ratio 70/25/5 across broad/focused/critical (CLAUDE.md §4.1 default).

| Sprint mode | broad | focused | critical | paid-deep | ultra-broad | **Total $** | **Δ vs baseline** |
|---|---|---|---|---|---|---|---|
| **3-tier baseline (today)** | 140 ×$0 = $0 | 50 ×$0.005 = $0.25 | 10 ×$0.01 = $0.10 | — | — | **$0.35** | — |
| **5-tier with ultra-broad reuse (40% repeats hit corpus)** | 84 ×$0 = $0 | 50 ×$0.005 = $0.25 | 10 ×$0.01 = $0.10 | — | 56 ×$0 = $0 | **$0.35** | **$0** (savings = Claude pool tokens not $) |
| **5-tier with paid-deep (5% promoted from critical)** | 140 ×$0 | 50 ×$0.005 = $0.25 | 8 ×$0.01 = $0.08 | 2 ×$0.07 = $0.14 | — | **$0.47** | **+$0.12** |
| **5-tier full (both new tiers active)** | 84 ×$0 | 50 ×$0.005 = $0.25 | 8 ×$0.01 = $0.08 | 2 ×$0.07 = $0.14 | 56 ×$0 | **$0.47** | **+$0.12** |

**ROI breakeven for ultra-broad:**
- Saves: 1 SearXNG round-trip + 1 corpus dedup pass per hit = ~25 ms wall-clock + ~0.3 Claude-pool tokens worth of qsearch ingestion overhead.
- Costs: 1 Meilisearch query = ~5 ms.
- **Breakeven: any query with ≥1 cached hit pays for itself.** The real saving isn't $ — it's the ~120k Claude tokens per heavy-max sprint that we'd otherwise burn re-reading old data.
- **Decision criterion:** ship ultra-broad if heavy-max sprint count ≥1/week AND corpus has ≥10 sprints of accumulated data. Both true today.

**ROI breakeven for paid-deep:**
- Triggers only on decisions where being wrong costs >$10k OR >40 working hours.
- Worst-case sprint cost delta: $0.50 (10 paid-deep queries × $0.05) vs baseline $0.35 → $0.85.
- Break-even: 1 paid-deep query that prevents 1 wrong call worth ≥$0.50 in compute/$ saves = trivially yes.
- **Decision criterion:** ship paid-deep gated behind 30-query G1 benchmark vs critical (CLAUDE.md §2.1 frontier-only rule). If benchmark Δ < 0.05, scrap.

---

## 5. Backwards compatibility

| Existing queries.txt format | Behavior after migration |
|---|---|
| `label|query` (2-field) | parses as `priority=broad, domain=general` (current behavior, unchanged) |
| `label|query|broad` (3-field, broad) | unchanged |
| `label|query|focused` | unchanged |
| `label|query|critical` | unchanged |
| `label|query|focused|ru` (4-field with domain) | unchanged |
| `label|query|ultra-broad` *(new)* | routes to corpus-only; falls through to broad on miss |
| `label|query|paid-deep` *(new)* | routes to Exa default; CLI hard-cap applies |

Existing CLAUDE.md §4.1 routing tier ratios (70/25/5) **remain the default** — ultra-broad and paid-deep are opt-in only. No silent regression for any existing project's `queries.txt`.

`brave_sweep.py` `parse_queries_file()` already does right-to-left greedy field consumption (L548-561), so adding new vocabulary values to `VALID_PRIORITIES` is the only change in the parser — the parsing logic itself is unchanged.

---

## 6. Implementation phases & total LOC

| Phase | Deliverable | LOC | Days (1 dev, focused) |
|---|---|---|---|
| **P0** | G1 benchmark harness (30-q known-answer set; measure paid-deep vs critical) | ~150 (new file: `tests/g1-benchmark.js`) | 1 |
| **P1** | ultra-broad: `/corpus_lookup` endpoint + corpus adapter + router branch + parser update | ~70 | 0.5 |
| **P2** | paid-deep: Exa backend + adapter + router branch + parser update + CLI flags | ~300 | 2 |
| **P3** | paid-deep: Perplexity backend (optional addon) | ~100 | 1 |
| **P4** | paid-deep: Brave Pro Answers research-mode exposure (~20 LOC + CLI flag) | ~20 | 0.25 |
| **P5** | Validation rules (confidential domain, label-prefix blocks, hard caps) | ~50 | 0.5 |
| **P6** | Docs: update CLAUDE.md §4.1, qsearch README, brave_sweep.py docstring | ~60 lines markdown | 0.25 |
| **TOTAL** | **5-tier ladder shipped** | **~690 LOC** | **~5.5 days** |

**Minimal viable cut (skip P3, P4):** ~520 LOC, ~4 days.
**Ultra-broad-only cut (defer P2):** ~270 LOC, ~2 days. Safest first step — proves the queries.txt grammar extension on a $0/low-risk tier before adding paid-deep budget exposure.

---

## 7. Open questions (deferred, NOT blocking design)

- Should ultra-broad have a configurable `min_score` threshold per project (heavy vs light sprints want different bars)? Suggest yes, expose as `--ultra-broad-min-score`, default 0.55.
- Does paid-deep response shape fit the existing `parsed_snippets.md v2` renderer, or do we need a v3 with explicit "agentic trace" section? Tentative: v2 fits; trace goes into per-query `<label>__paid_deep_trace.json` audit file.
- Should we add a tier between focused and critical for "Brave web + Context but with `ctx_threshold=lenient`"? Probably over-engineered — answer is no until we see a real gap.
- x402 monetization angle (qsearch could re-sell paid-deep to federated peers at margin) — out of scope for this card.

---

## 8. Decision

**Recommended ship order:**
1. **P0 benchmark first** (1 day) — without G1 numbers, paid-deep is faith-based.
2. **P1 ultra-broad** (0.5 day) — low risk, immediate Claude-token savings, validates grammar extension.
3. **P2 paid-deep Exa** (2 days) — gated on P0 result Δ ≥ 0.05.
4. **P3/P4** optional based on real usage.

**Total ship-ready in ~4 days** of focused work for the 5-tier ladder MVP.

---

_Design self-sufficient. Card rd239 can close on this artifact — implementation card(s) will be split per phase when scheduled._
