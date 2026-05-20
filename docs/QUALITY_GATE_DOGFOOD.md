# Layer 8 quality gate — dogfood guide

**Status (2026-05-20, rd275):** shipped, **off by default**. Flip only after running the dogfood loop below.

The Layer 8 composite gate filters sweep results by `composite_score = w_emb * emb + w_auth * auth + w_llm * llm + w_trust * trust`. Default weights `{emb: 0.4, auth: 0.3, llm: 0.2, trust: 0.1}`, default threshold `0.4`. Target rejection rate ~60-75 % per [`ARCHITECTURE.md`](../ARCHITECTURE.md) — too low means the gate isn't earning its complexity, too high means it's killing useful results.

## Why off by default

Threshold + weights are not calibrated against a real benchmark. Turning the gate on without tuning risks dropping load-bearing sources from a research sprint and you may not notice until synthesis fails. `QSEARCH_RERANK_ENABLED=true` (Stages 1+2) is the right thing to ship — Layer 8 stays opt-in until the precision/recall numbers below confirm it earns its place.

## Env flags

```
# Stage 1 (embedding) + Stage 2 (LLM scoring for priority=critical)
QSEARCH_RERANK_ENABLED=true

# Layer 8 composite gate (depends on rerank=true)
QSEARCH_QUALITY_GATE_ENABLED=true
QSEARCH_QUALITY_THRESHOLD=0.4          # 0.4 default, try 0.4 / 0.5 / 0.55
# QSEARCH_QUALITY_WEIGHTS={"emb":0.4,"auth":0.3,"llm":0.2,"trust":0.1}
```

## Dogfood procedure (3 sprints)

1. Pick three real heavy sprints you'll run anyway over the next two weeks. **Do not synthesize a test corpus** — calibration on hand-curated queries is useless. Sprint variety matters; mix at least one Russian-domain sprint and one academic-domain sprint.
2. Run each sprint **twice**:
   - **A: gate off** — `QSEARCH_RERANK_ENABLED=true QSEARCH_QUALITY_GATE_ENABLED=false`.
   - **B: gate on** — add `QSEARCH_QUALITY_GATE_ENABLED=true QSEARCH_QUALITY_THRESHOLD=<X>` where `<X>` rotates through `0.4 / 0.5 / 0.55` across the three sprints.
3. Sweep both with `?include_rejected=true` (see [§ Observability](#observability) below).
4. For each sprint compare `A` vs `B`:
   - **Coverage delta:** any load-bearing source that A had but B dropped?
   - **Precision proxy:** of B's retained sources, how many were genuinely useful in synthesis?
   - **Rejection rate:** `rejected / (kept + rejected)` per query. Healthy band is 60-75 %.
5. Record verdicts in [`Cards/rd275 qsearch-federated-dusk.md`](../../obsidian/Base/Cards/rd275%20qsearch-federated-dusk.md) retrospective section.

## Calibration target

Flip default ON in a follow-up PR (semver bump → v0.5.0) **only when all three checks pass:**

- rejection rate sits 50-70 % across the three sprints
- **zero** load-bearing source killed by the gate (precision-1 on kept set)
- p95 latency overhead from Stage 2 LLM scoring < 8 s per sprint (qwen2.5:7b benchmark is ~160 URLs/min on RTX 3080, see [memory 16935](#))

If any check fails, document the failure mode in `rd275` retro, tweak weights or threshold, and rerun a fresh 3-sprint cycle. **Do not** flip the default on a 2-out-of-3 result.

## Observability

`?include_rejected=true` on `/sweep` and `/cached_sweep` returns the rejected list alongside the markdown body so you can inspect why the gate dropped each URL:

```
curl -s -X POST 'http://localhost:8080/sweep?include_rejected=true' \
  -H 'Content-Type: text/plain' --data-binary @queries.txt
```

Each rejected entry includes `composite_score` plus per-component breakdown (`emb`, `auth`, `llm`, `trust`) — let the data tell you which weight is mis-calibrated.

## When NOT to flip

- Russian or load-bearing content sprints — frontier-only rule (CLAUDE.md §4.5). Layer 8 is qwen2.5:7b territory; mismatched against specialized vocab.
- Time-critical sprints (<1h) — Stage 2 LLM scoring adds latency.
- Medical / legal / financial reproducibility-critical sprints — keep gate off, manual review.

## References

- `src/rerank/pipeline.js` — pipeline wiring + env flag reads.
- `src/rerank/quality_gate.js` — composite scoring + threshold.
- `ARCHITECTURE.md` Layer 8 row — design intent + rejection target.
- Card `rd273` (shipped 2026-05-11) — Layer 8 initial implementation.
- Card `rd275` (this card) — observability + dogfood instrumentation.
