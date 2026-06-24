# RaaS — Reports-as-a-Service

Compose qsearch `/sweep` + the doesitlie citation verifier into **fully-cited, triangulated
research reports** with a machine-checkable receipt. The differentiator is not the prose — it's
that **every load-bearing claim is verified against ≥3 independent, sufficiently-authoritative
sources**, and any claim that fails is *flagged low-confidence, never silently dropped*.

This is the evidence layer. The operator writes the narrative around it.

## Pipeline

```
brief.json ──▶ gather ──▶ tier (drop excluded) ──▶ verify ──▶ triangulation gate ──▶ report.md + audit.json
              /sweep      tiers.js                 verify.js   triangulate.js          report.js
```

| Stage | Module | What it does |
|---|---|---|
| gather | `gather.js` | Fan a claim's queries to qsearch `/sweep`; parse `url + title + engine_count` from the markdown. Offline path: `loadCandidatesFromFixture`. |
| tier | `tiers.js` | Classify each source 1A / 1B / 2 / 3 / 4 / excluded (CLAUDE.md heavy-max tiers). Domain-map walk (so `pubmed.ncbi.nlm.nih.gov` matches) → provenance fallback (multi-engine → 3, single → 4). Excluded sources dropped before paying for verify. |
| verify | `verify.js` | Thin adapter over the canonical `src/verifier/` (the **same** code the published doesitlie bench runs, so a report inherits its measured judge↔human agreement κ=0.75). Fabricated/Error verdicts are kept, not hidden. |
| gate | `triangulate.js` | A claim **triangulates** iff ≥3 *independent* (distinct eTLD+1) supporting domains at the tier floor, with ≥1 high-authority anchor. Else **low-confidence** with a reason. |
| report | `report.js` | `report.md` (human evidence layer) + `audit.json` (the receipt — every source/verdict/excerpt, re-checkable by hand). |

## CLI (the MVP surface)

```bash
node src/raas/cli.js <brief.json> [outDir]
# → <outDir>/report.md  +  <outDir>/audit.json
```

`brief.json` shape — see [`examples/brief.example.json`](examples/brief.example.json):

```json
{
  "question": "The buyer's real question",
  "candidatesFixture": "candidates.fixture.json",   // optional: run offline, no live /sweep
  "claims": [
    { "id": "c1", "text": "The load-bearing claim, verbatim", "priority": "focused",
      "queries": ["query likely to surface a supporting source", "..."] }
  ]
}
```

No web UI, no payment integration — **by design** (build-spec §c). The operator hand-authors the
claim list; the charge happens out-of-band. Keeping the core a pure `brief → {report, audit}`
function means a future paste-box or per-call API is a thin wrapper, not a rewrite.

## The gate, configurable

`DEFAULT_GATE = { minIndependent: 3, tierFloor: '2', requireOneAtLeast: '1B' }` — mirrors the
CLAUDE.md heavy-max "≥3 independent primary sources or low-confidence" rule. Override per call:

```js
import { runBrief } from './pipeline.js'
await runBrief(brief, { gate: { minIndependent: 2, tierFloor: '3', requireOneAtLeast: '3' } })
```

## Ship tripwire

If **< 50 %** of load-bearing claims triangulate, the report carries a prominent
`⚠️ NOT ship-ready` banner and the CLI prints a warning. A report that can't back half its claims
should not be sold as confident — the tripwire makes that impossible to miss.

## Tests

```bash
node --test test/unit/raas/raas.test.js      # 22 tests — tiers, gate, gather-parse, verify adapter, e2e
```

The suite injects a fake verifier (`setVerifier`) so it runs with **no live judge or network**.

## Honesty notes (read before charging)

- The seed domain→tier table in `tiers.js` is **illustrative** — curate/expand it before the first
  paid report. Unknown domains fall back to provenance (never silently to "authoritative").
- `registrableDomain` handles common two-label suffixes (`.co.uk`, `.gov.uk`, …) but is **not** a
  full public-suffix list — swap for `tldts`/`psl` before high-stakes production.
- Independence = distinct registrable domain. Cross-domain **syndication** (same wire story on N
  outlets) can inflate the independent count — a known MVP blind spot (build-spec §f Q5).
