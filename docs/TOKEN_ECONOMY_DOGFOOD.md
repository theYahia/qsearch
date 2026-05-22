# Token economy baseline — dogfood guide (rd278)

**Status (2026-05-22):** measurement harness ready; **fire on the next real heavy sprint** (do not synthesize a test sprint — the number is only meaningful on a sprint you'd run anyway).

## What we're measuring

The rd273 cost-floor roadmap (Levers A–D: `/sweep_context`, night-loop finalize, `/pre_sweep_check`, `/research-brief` scaffold) was shipped to cut **Claude Phase-4 token consumption** from the historical 100–150k tokens/heavy-sprint (wholesale WebFetch of top-15 sources, 2026-04-29) down to a target **≤30k tokens**. rd278 verifies the floor actually dropped on a real sprint.

> **Primary metric is Claude Phase-4 tokens, not Brave dollars.** The expensive thing was always the Claude pool (re-reading raw pages into context), not the ~$0.35 of Brave calls. Keep that framing.

## Two signals, captured separately

### 1. Primary — Claude Phase-4 token cost (the floor we care about)

There is no automatic counter for this; Claude observes it during the sprint. The discipline that produces the number:

- Phase 4 deep-read uses **Brave LLM Context** (`brave_sweep.py --include-context --ctx-preset deep`) and/or **qsearch `/sweep_context`** ($0 local) and **extra_snippets** — **not** wholesale `WebFetch` of top URLs (CLAUDE.md §2.1). WebFetch only for 1–3 genuine gaps.
- At synthesis time, record approximate Claude tokens spent on Phase 4 (context window growth attributable to deep-read material).
- **PASS** if ≤30k; **MISS** if approaching the 100–150k baseline. Record either way in the rd278 card.

### 2. Secondary — Brave $ spend + cache hit rate (qsearch-routed portion)

`/economy_report` aggregates `sprint_metrics` for queries that flow **through qsearch** (`/sweep` broad·scholarly·ru, `/cached_sweep`, `/academic_search`). Tag the sprint so rows group:

```
# qsearch reads sprint id from header x-sprint-id OR query param sprint_id (src/server.js sprintMetadataFromReq)
curl -s -X POST 'http://localhost:8080/sweep?sprint_id=<topic>&topic=<topic>' \
  -H 'Content-Type: text/plain' --data-binary @queries.txt
```

Then pull the report (or use `scripts/economy_summary.sh <sprint_id>`):

```
curl -s 'http://localhost:8080/economy_report?sprint_id=<topic>&format=markdown'
```

### Known capture gaps (document, don't fabricate around)

- **Client-side Brave calls bypass qsearch.** `brave_sweep.py` issues focused/critical Brave web+context calls directly — these are **not** in `sprint_metrics`. For total Brave spend, add the per-endpoint counts from the sweep's own `_sweep_log.json` (`stats.web_ok`, `context_ok`, …) × per-call cost.
- **`brave_sweep.py` does not yet forward `sprint_id`** on its qsearch `/sweep` POSTs, so the broad-tier rows won't carry your sprint id unless you POST the broad queries yourself with the param above, or add a `--sprint-id` flag to the script (small follow-up, not required for the first measurement).

## Procedure (one real heavy sprint)

1. Run the sprint normally with the full rd273 stack: `/research-brief` scaffold → `/pre_sweep_check` → `brave_sweep.py --engines all --include-context` → `/sweep_context` for local extraction.
2. During Phase 4, hold the line: Brave Context / sweep_context / extra_snippets, **no wholesale WebFetch**.
3. At synthesis, record:
   - Primary: estimated Claude Phase-4 tokens vs ≤30k target → PASS/MISS.
   - Secondary: `/economy_report` markdown (Brave $ + cache hit rate) + `_sweep_log.json` Brave call counts.
4. Write the verdict into `Cards/rd278 qsearch token economy baseline.md` retrospective.

## Calibration target

- **PASS:** Phase-4 Claude tokens ≤30k (≥5× reduction vs 100–150k baseline) with no loss of synthesis quality.
- **WATCH:** 30–60k — partial win; note which step leaked tokens (usually a WebFetch that should've been Context).
- **MISS:** >60k — investigate; the deep-read discipline broke down somewhere.

## References

- `src/server.js` — `sprintMetadataFromReq`, `recordSprintMetric`, `handleEconomyReport`.
- `src/cache.js` — `sprint_metrics` table + `COST_PER_CALL`.
- `docs/QUALITY_GATE_DOGFOOD.md` — sibling dogfood loop (rd279), can run in parallel.
- CLAUDE.md §2.1 Phase-4 deep-read rule (the discipline this measures).
- Card `rd273` — cost-floor roadmap. Card `rd278` — this measurement.
