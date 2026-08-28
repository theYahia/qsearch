#!/usr/bin/env node
/**
 * r4_compare_judge_runs.mjs — is the C3 judge stable across two independent runs?
 *
 * bench/ru/results.json (run 1) judged 28 questions x 2 endpoints once. Its group table was
 * suspiciously symmetric (-40 / +40 / 0 pp) and one verdict was lost to a llama-server crash.
 * This compares run 1 against a fresh re-run of the SAME harness (scripts/bench_judge_ru.mjs,
 * same questions, same judge) question-by-question, endpoint-by-endpoint, and reports whether
 * the verdicts hold up.
 *
 * Pure comparison — no Ollama calls, no network. Run bench_judge_ru.mjs first to produce run 2.
 *
 * Usage:
 *   node scripts/r4_compare_judge_runs.mjs [--run1 bench/ru/results.json]
 *     [--run2 bench/ru/r4_results_rerun.json] [--json bench/ru/r4_judge_stability.json]
 */

import { readFileSync, writeFileSync } from 'node:fs'

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d }

const run1Path = arg('--run1', 'bench/ru/results.json')
const run2Path = arg('--run2', 'bench/ru/r4_results_rerun.json')
const outPath = arg('--json', 'bench/ru/r4_judge_stability.json')

const run1 = JSON.parse(readFileSync(run1Path, 'utf8'))
const run2 = JSON.parse(readFileSync(run2Path, 'utf8'))

const byId1 = new Map((run1.rows || []).map(r => [r.id, r]))
const byId2 = new Map((run2.rows || []).map(r => [r.id, r]))
const allIds = new Set([...byId1.keys(), ...byId2.keys()])

const perQuestion = []
const confusion = {} // run1 verdict -> run2 verdict -> count (comparable pairs only)
const bySide = { web: { matches: 0, total: 0 }, context: { matches: 0, total: 0 } }
let matches = 0
let comparisons = 0

for (const id of [...allIds].sort()) {
  const r1 = byId1.get(id)
  const r2 = byId2.get(id)
  for (const side of ['web', 'context']) {
    const v1 = r1?.[side]?.verdict ?? null
    const v2 = r2?.[side]?.verdict ?? null
    const comparable = Boolean(r1 && r2 && v1 && v2)
    const match = comparable ? v1 === v2 : null
    if (comparable) {
      comparisons++
      if (match) matches++
      bySide[side].total++
      if (match) bySide[side].matches++
      confusion[v1] = confusion[v1] || {}
      confusion[v1][v2] = (confusion[v1][v2] || 0) + 1
    }
    perQuestion.push({
      id,
      side,
      reference_from: r1?.reference_from ?? r2?.reference_from ?? null,
      run1_verdict: v1,
      run2_verdict: v2,
      comparable,
      match,
      missing_from: !r1 ? 'run1' : !r2 ? 'run2' : (v1 === null ? 'run1_verdict' : v2 === null ? 'run2_verdict' : null)
    })
  }
}

const agreementRate = comparisons ? matches / comparisons : null
const out = {
  generated: new Date().toISOString(),
  run1_path: run1Path,
  run2_path: run2Path,
  run1_generated: run1.generated || null,
  run2_generated: run2.generated || null,
  n_comparisons: comparisons,
  n_matches: matches,
  agreement_rate: agreementRate,
  agreement_by_side: {
    web: bySide.web.total ? bySide.web.matches / bySide.web.total : null,
    context: bySide.context.total ? bySide.context.matches / bySide.context.total : null
  },
  confusion_matrix_run1_to_run2: confusion,
  per_question: perQuestion,
  run1_summary_byGroup: run1.summary?.byGroup ?? null,
  run2_summary_byGroup: run2.summary?.byGroup ?? null,
  run1_summary_totals: run1.summary ? { web: run1.summary.web, context: run1.summary.context } : null,
  run2_summary_totals: run2.summary ? { web: run2.summary.web, context: run2.summary.context } : null
}

writeFileSync(outPath, JSON.stringify(out, null, 2))

console.log(`agreement: ${matches}/${comparisons} = ${agreementRate === null ? 'n/a' : (agreementRate * 100).toFixed(1) + '%'}`)
console.log(`  web:     ${bySide.web.matches}/${bySide.web.total} = ${bySide.web.total ? (100 * bySide.web.matches / bySide.web.total).toFixed(1) + '%' : 'n/a'}`)
console.log(`  context: ${bySide.context.matches}/${bySide.context.total} = ${bySide.context.total ? (100 * bySide.context.matches / bySide.context.total).toFixed(1) + '%' : 'n/a'}`)
console.log('\nconfusion (run1 verdict -> run2 verdict counts):')
console.log(JSON.stringify(confusion, null, 2))
console.log('\nrun2 per-group Supported% table:')
for (const [g, row] of Object.entries(out.run2_summary_byGroup || {})) {
  console.log(`  ${g.padEnd(12)} n=${row.n}  web ${row.web.supportedPct}%  context ${row.context.supportedPct}%  delta ${row.deltaPp >= 0 ? '+' : ''}${row.deltaPp}`)
}
console.log(`\nwrote ${outPath}`)
