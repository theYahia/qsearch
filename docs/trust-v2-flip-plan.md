# Trust formula v2 — flip-decision doc

> **Status:** A/B complete, flag-gated. `QSEARCH_TRUST_FORMULA` defaults to `v1` (production unchanged).
> **This doc prepares the flip — it does NOT perform it.** Flipping `QSEARCH_TRUST_FORMULA=v2` is a **user decision**.
> **Date:** 2026-06-24 · **Branch:** `fix/critical-context-and-key-validation` (local, unpushed)
> **Code:** `src/corpus/trust.js` (formulas + dispatcher), `src/corpus/trust_ab.mjs` (A/B harness), `test/unit/corpus/trust_v2.test.js` (6 tests, all green).

---

## TL;DR

v1's trust formula is **purely multiplicative**, so any URL with `engineDiversity = 0` collapses to `trust = 0` — even if it was seen across many sweeps. On the **A/B sample of the real corpus (1000 distinct URLs — `trust_ab.mjs` defaults to `--n 2000` Meili docs, deduped by URL; the full index is ~268k docs), 779 URLs (78% of the sample) are zero-collapsed by v1** because they carry no engine metadata. v2 fixes this (floors the diversity factor at 1 instead of nuking the product) and adds diminishing returns on diversity. The A/B shows v2 **rescues all 779** while keeping the ranking head almost identical (Spearman **ρ = 0.910**, top-20 overlap **19–20 of 20** — see the discrepancy note in §2). Recommendation: **flip to v2** after you've eyeballed `/corpus/top` once on each formula. Fully reversible.

---

## 1. What v2 changes and why — the 2 defects (grounded in `src/corpus/trust.js`)

Both formulas share the same drivers: `log(sweep_count + 1)`, `engine_diversity`, `topic_diversity`, and an optional recency `decay` factor (off by default, `QSEARCH_TRUST_DECAY_K=0`).

### Defect 1 — zero-collapse at `engineDiversity = 0`

**v1** (`computeTrustV1`, lines 31–37) is purely multiplicative:

```js
const base = Math.log(sweepCount + 1) * engineDiversity * topicDiversity
```

If `engineDiversity = 0`, the whole product is `0` — regardless of how many sweeps saw the URL. The module's own comment (lines 28–30) calls this out: *"engineDiversity=0 ⇒ trust=0 even for a URL seen across many sweeps (e.g. a corpus/academic source with no engines recorded)."*

This is not a corner case here. Many corpus URLs (academic/corpus-ingested sources, and any URL indexed without `engines[]` metadata) have `engineDiversity = 0`, so v1 silently assigns them zero trust and they never surface in trust-ranked results — even though their sweep history says they're trustworthy.

**v2** (`computeTrustV2`, lines 44–50) replaces each bare diversity term with `(1 + ln(1+x))`:

```js
const base = Math.log(sweepCount + 1)
           * (1 + Math.log1p(engineDiversity))
           * (1 + Math.log1p(topicDiv))
```

When `engineDiversity = 0`, `1 + ln(1+0) = 1`, so the factor **floors at 1** instead of zeroing the product. A multi-sweep, zero-engine URL now scores `log(sweep+1) × 1 × (1 + ln(1+topics))` > 0. `sweep_count` remains the primary signal. (Pinned by test `v2 does NOT collapse — a multi-sweep, zero-engine URL still scores > 0`.)

### Defect 2 — linear vs. diminishing returns on diversity

In **v1**, `engineDiversity` and `topicDiversity` enter **linearly**: doubling engine diversity exactly doubles the contribution (test `v1 is exactly linear in engine diversity` pins ratio = 2.0×). One hyper-diverse URL can dominate the board linearly on the diversity axis alone.

In **v2**, `ln(1+x)` **compresses** the diversity range — doubling engines raises trust by **less than 2×** (test `v2 has diminishing returns on engine diversity (sub-linear)` pins ratio < 2.0). This keeps `sweep_count` as the dominant signal and prevents a single very-diverse URL from outranking many consistently-seen URLs purely on diversity.

> Both changes are **deliberate and documented in the source comment** (lines 39–43). The recency `decay` factor is applied identically to v1 and v2 (it multiplies the base; it is not part of the formula difference) — pinned by test `decay applies to both variants identically`.

### Where this hits the live ranking

`computeTrust` is the dispatcher (lines 59–61): it reads `TRUST_VARIANT` from `QSEARCH_TRUST_FORMULA` (default `v1`) and routes to v1 or v2. It is called from **3 sites** in `src/corpus/meilisearch.js`:

| Site | Line | Effect of flip |
|---|---|---|
| `search()` `trust_score` | `meilisearch.js:252` | `trust_score` reported on every corpus search hit changes |
| `topByTrust()` (the `/corpus/top` board) | `meilisearch.js:290` | the trust-ranked board re-scores; zero-collapsed URLs become eligible |
| `corpusLookup()` (ultra-broad sufficiency) | `meilisearch.js:148` | trust value recomputed, BUT see note below |

> **Ultra-broad note (verify against current config):** per `ANALYSIS-2026-06-23.md` (lines 80, 184), the ultra-broad sufficiency gate accepts on `minHits ≥ 3` + `avgScore ≥ 0.55` (BM25) and **does not gate on `trust_score`** unless `QSEARCH_ULTRA_BROAD_MIN_TRUST` is set (default off). So flipping the trust formula should **not** change ultra-broad accept/reject decisions in the default config — it only changes the `trust_score` *number*. If you have set `QSEARCH_ULTRA_BROAD_MIN_TRUST`, then v2's rescue of zero-collapse URLs **could** change which queries are short-circuited; watch that path. (Verify your env before flipping.)

---

## 2. The A/B evidence (real numbers)

**Source of the headline numbers:** `BURN-LOG-2026-06-23-v2.md` (lines 29, 80), and **reproduced fresh on 2026-06-24** by running `trust_ab.mjs` against the live Meilisearch corpus (see §3 for the exact command). The harness auto-selects the real Meilisearch corpus when reachable, else deterministic synthetic data — and **prints which mode it used**, so the numbers can't be mistaken.

| Metric | BURN-LOG (2026-06-23, REAL 1000 URLs) | Fresh re-run (2026-06-24, REAL 1000 URLs) | Meaning |
|---|---|---|---|
| Data source | REAL corpus (Meilisearch) | `REAL corpus (Meilisearch, 1000 urls)` | not synthetic |
| Zero-collapse under v1 | **779 URLs (78%)** | **779 URLs** | v1 assigns trust=0 despite sweep history |
| …of which v2 rescues (>0) | **all 779** | **779** | v2 fixes 100% of them |
| Spearman ρ(v1, v2) | **0.910** | **0.9098** | ranking order almost unchanged |
| top-20 overlap | **20/20** | **19/20** ⚠️ | head of the board (see discrepancy note) |
| median \|rank change\| | (not in BURN-LOG) | **24 positions** | most movement is in the long tail of rescued URLs |
| score distribution (p50 / p90 / p99 / max), v1 → v2 | (not in BURN-LOG) | p50 `0.00→1.17`, p90 `0.69→1.99`, p99 `19.31→10.84`, max `124.77→24.96` | v2 lifts the floor (p50 0→1.17) and compresses the top (max 125→25) |

### ⚠️ Discrepancy I am flagging (do not gloss over)

The BURN-LOG recorded **top-20 overlap = 20/20**; my fresh 2026-06-24 re-run gave **19/20** (and ρ 0.910 → 0.9098, both round to 0.910). The `779 / 78%` zero-collapse figure reproduced **exactly**. The most likely explanation: the corpus changed slightly between 2026-06-23 and 2026-06-24 (one or more new sweeps indexed), nudging a single URL in/out of the top-20 boundary. **This is itself the headline thing to watch (§4): the ranking head is stable to within ~1 of 20 positions, not provably frozen.** Treat "top-20 overlap 20/20" as a 2026-06-23 snapshot; the durable claim is **"~19–20 of 20, i.e. the head is essentially preserved."** Re-run `trust_ab.mjs` (§3) immediately before flipping to get the overlap on *today's* corpus and confirm it hasn't drifted further.

### Synthetic-mode caveat (so the fact-checker isn't misled)

If you run `trust_ab.mjs` **without** Meilisearch reachable/authenticated, it falls back to **synthetic** data and prints very different numbers (a fresh synthetic run gave ρ≈0.845, top-20 overlap 15/20, 150 zero-collapse / 2000 URLs). **Those synthetic numbers are NOT the evidence for this decision** — they exercise the collapse on fabricated features. The decision rests on the **REAL corpus** numbers above. Always confirm the harness printed `data source : REAL corpus (...)` before trusting its output for this flip.

---

## 3. Exact flip procedure (reversible)

The flip is a single environment variable. `computeTrust` reads `QSEARCH_TRUST_FORMULA` at module load; **restart the qsearch server** for the change to take effect (it is read once at import, not per-request).

**Step 0 — re-run the A/B on today's corpus (recommended before flipping):**

```bash
cd <repo>
# Meilisearch must be up (docker compose up -d) and the key must be in env.
# .env.example defaults: MEILISEARCH_URL=http://localhost:7700  MEILISEARCH_KEY=masterKey
MEILISEARCH_URL=http://localhost:7700 MEILISEARCH_KEY=masterKey \
  node src/corpus/trust_ab.mjs --top 20
# CONFIRM the output says: data source : REAL corpus (Meilisearch, N urls)
# CONFIRM ρ is still ~0.91 and top-20 overlap is ~19–20/20 before proceeding.
```

> The harness reads `MEILISEARCH_URL`/`MEILISEARCH_KEY` (also accepts `MEILI_URL`/`MEILI_MASTER_KEY`). If it prints `SYNTHETIC (... Meilisearch unreachable ...)`, the key/URL is wrong — fix it and re-run; do **not** decide on synthetic numbers.

**Step 1 — flip the flag** (pick one; persistent is preferred so a restart keeps it):

```bash
# Option A — persistent (survives restart): add to .env.local
echo "QSEARCH_TRUST_FORMULA=v2" >> .env.local

# Option B — one shot for a single server run (Git Bash):
QSEARCH_TRUST_FORMULA=v2 node src/server.js

# Option B — one shot (PowerShell):
$env:QSEARCH_TRUST_FORMULA = 'v2'; node src/server.js
```

**Step 2 — restart the qsearch server** so the new variant is loaded.

**Step 3 — verify v2 is live:** hit `/corpus/top?sort=trust` and confirm previously-zero URLs now carry `trust_score > 0`, and that the top of the board matches the A/B's top-20.

---

## 4. What to watch after the flip

1. **Ranking-head stability (primary).** The A/B says top-20 overlap is ~19–20/20 and ρ=0.910 — the head should barely move. After flipping, pull `/corpus/top?sort=trust` and compare the top 20 against the pre-flip top 20. **Expect ≤1–2 changes at the boundary**; if you see large reshuffling at the top, that contradicts the A/B and is a stop signal (re-run `trust_ab.mjs` to see if the corpus drifted).
2. **Distribution shift (expected, not a bug).** v2 **raises the floor** (p50 `0.00 → 1.17` — the rescued 779 URLs now have nonzero trust) and **compresses the top** (max `124.77 → 24.96`). Absolute `trust_score` values are **not comparable across formulas** — anything that hardcodes a trust threshold on the *absolute* number must be re-checked.
3. **Trust thresholds / gates.** Two knobs interpret absolute trust:
   - `QSEARCH_ULTRA_BROAD_MIN_TRUST` (ultra-broad sufficiency gate; default off) — a fixed threshold like `2.0` means something different under v2's compressed scale. If set, re-tune it or expect different short-circuit behavior.
   - The Layer-8 quality gate / rerank (`quality_gate.js`, trust weight 0.1, saturates trust at 2.0) — per `ANALYSIS-2026-06-23.md` it is **OFF by default and never calibrated**, so likely no live impact, but if you enable it, re-derive the saturation point on v2's scale.
4. **The 779 rescued URLs surfacing.** Expect more corpus/academic (zero-engine) URLs to appear in trust-ranked output. That is the intended effect — sanity-check a sample that they're genuinely useful, not noise that v1 was usefully suppressing.

---

## 5. Rollback (instant, no data change)

The flip changes **no stored data** — `trust_score` is computed on read from raw features (`sweep_count`, `engines[]`, `sweep_label`), so reverting is just resetting the flag.

```bash
# Option A (persistent): remove or flip the line in .env.local
#   set QSEARCH_TRUST_FORMULA=v1  (or delete the line — default is v1)
# Option B (one shot): just start the server without the var set.
```

Then **restart the qsearch server**. `computeTrust` reverts to `computeTrustV1`, which is **byte-identical to the prior production behavior** (default dispatch, confirmed by test `dispatcher defaults to v1 and honors opts.variant`). No re-index, no migration, no data loss. Rollback is as cheap as the flip.

---

## 6. Recommendation

**Flip to v2** — but do Step 0 (re-run the A/B on today's corpus) first, and eyeball `/corpus/top` once on each formula.

Rationale, grounded:
- v2 fixes a **real, large** defect: **78% of the A/B sample (779/1000 distinct URLs) is invisible to trust ranking under v1** purely because those URLs lack engine metadata. (The sample is `trust_ab.mjs`'s default 2000-doc Meili pull deduped by URL; the full index is ~268k docs, so treat 78% as the sample rate, not a measured whole-corpus rate — re-run with a larger `--n` if you want a tighter estimate.) That is not a tuning preference — it's a formula bug that zeroes out the majority of *the sampled* URLs on the differentiator signal.
- The fix is **safe at the head**: ρ=0.910 and top-20 overlap ~19–20/20 mean the URLs you already trust stay ~where they were; the movement is concentrated in the long tail being rescued from zero.
- It is **fully reversible** with zero data change — the cost of being wrong is one env var + a server restart.
- The harness's own recommendation hint encodes the exact gate this meets: *"v2 is worth it iff it rescues real zero-collapse URLs AND ρ stays high"* — both conditions hold (rescued=779, ρ=0.910).

**One caveat before flipping:** if you have set `QSEARCH_ULTRA_BROAD_MIN_TRUST` or enabled the Layer-8 quality gate, re-tune those thresholds — v2's absolute scale differs (max 125→25). In the **default** config (both off) there is no threshold to break, and the flip is low-risk.

> **Decision owner:** user. This doc does not flip anything. The flag, the harness re-run, and the server restart are all yours to execute.

---

## Appendix — provenance of every number

| Claim | Source | How to re-verify |
|---|---|---|
| 78% / 779 of 1000 zero-collapsed by v1; v2 rescues all | `BURN-LOG-2026-06-23-v2.md` L29, L80 + fresh `trust_ab.mjs` REAL run 2026-06-24 | `MEILISEARCH_KEY=masterKey node src/corpus/trust_ab.mjs` → "v1 scores 0 despite sweeps : 779" |
| Spearman ρ = 0.910 | BURN-LOG L29 + fresh run (0.9098) | same command → "Spearman ρ(v1, v2) : 0.9098" |
| top-20 overlap 20/20 (BURN-LOG) vs 19/20 (2026-06-24) ⚠️ | BURN-LOG L29 vs fresh run | same command → "top-20 overlap"; **re-run before flipping** — corpus may have drifted |
| median rank change 24; distribution p50 0→1.17 … max 125→25 | fresh `trust_ab.mjs` REAL run 2026-06-24 (not in BURN-LOG) | same command → "median \|rank change\|" + "Score distribution" |
| synthetic fallback ρ≈0.845 / 15-of-20 / 150-of-2000 | fresh `trust_ab.mjs` run with Meili unreachable | `node src/corpus/trust_ab.mjs` (no key) → "data source : SYNTHETIC" — **not decision evidence** |
| 2 defects (zero-collapse, linear-vs-diminishing) | `src/corpus/trust.js` L28-50 (source comments + code) | read the file |
| 6 trust-v2 tests, all green | `test/unit/corpus/trust_v2.test.js` | `node --test test/unit/corpus/trust_v2.test.js` → "pass 6, fail 0" |
| 3 live call sites of `computeTrust` | `src/corpus/meilisearch.js` L148, L252, L290 | `grep -n computeTrust src/corpus/meilisearch.js` |
| ultra-broad gate ignores trust by default; quality gate off/uncalibrated | `ANALYSIS-2026-06-23.md` L80, L95, L184 | read the file; **verify your own env** for `QSEARCH_ULTRA_BROAD_MIN_TRUST` |
| flip is reversible / no data change / v1 byte-identical | `src/corpus/trust.js` L18-22, L59-61 + trust_v2 test "dispatcher defaults to v1" | read the dispatcher; default `TRUST_VARIANT='v1'` |
