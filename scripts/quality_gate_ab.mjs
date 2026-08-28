#!/usr/bin/env node
/**
 * quality_gate_ab.mjs — what would the Layer 8 quality gate actually throw away?
 *
 * The plan called for A/B via two live sweeps. This runs the same comparison in-process on
 * saved sweep output instead, which is better on every axis that matters here:
 *
 *   - Both arms see BYTE-IDENTICAL results, so the difference is the gate and nothing else.
 *     Two live sweeps differ by whatever Brave returned the second time, and that noise lands
 *     directly on the rejection rate being measured.
 *   - It reads _quality_composite and _quality_parts per result. The live path renders markdown,
 *     so the component breakdown would have to be recovered by parsing prose.
 *   - It costs $0 on 28 queries instead of $0.20 on 20. The sweeps were already paid for.
 *
 * It does NOT modify quality_gate.js — the constraint behind choosing A/B in the first place.
 *
 * Two facts about the gate, both established by reading the code before running anything, and
 * both of which shape what the number will mean:
 *
 *  1. trust is ALWAYS 0 on this path. trust_score is attached in exactly two places —
 *     corpus/meilisearch.js and search/rerank.js (rerankByTrust) — and rerankByTrust is called
 *     only from handleSearch (server.js:263). The sweep path never annotates it, so the 0.1
 *     trust weight is dead on the one path where the gate actually runs.
 *  2. llm is 0 unless priority is critical (pipeline.js:49, STAGE2_PRIORITIES default 'critical').
 *
 * So on a focused sweep the composite is 0.4·emb + 0.3·authority, ceiling 0.7 — against a
 * default threshold of 0.4. With the unknown-host authority of 0.35 contributing 0.105, a result
 * needs emb >= 0.7375 to survive. That is a high cosine similarity, and it is a prediction this
 * script is written to test, not an assumption it relies on.
 *
 * Decision rule, fixed before the run (from the plan):
 *   60-80% rejected and nothing valuable in the reject pile → enable.
 *   > 90% → not a gate, a mute button. Re-check emb/llm rather than tuning the threshold.
 *   < 30% → not firing; enabling is pointless.
 *   OVERRIDING — if any URL cited in a bench/ru/questions.jsonl reference answer is rejected,
 *   do not enable, whatever the rate. Those are sources known to carry the answer.
 *
 * Usage: node scripts/quality_gate_ab.mjs [--priority focused|critical] [--threshold 0.4] [--json out.json]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import '../src/env.js'
import { rerankByEmbedding } from '../src/rerank/embedding_rerank.js'
import { rerankByLLM } from '../src/rerank/llm_rerank.js'
import { applyQualityGate } from '../src/rerank/quality_gate.js'
import { normalizeUrlKey } from '../src/rerank/ndcg.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d }

const PRIORITY = arg('--priority', 'focused')
const THRESHOLD = Number(arg('--threshold', process.env.QSEARCH_QUALITY_THRESHOLD || '0.4'))
const TOP_N = Number(arg('--top-n', '10'))

const questions = readFileSync(join(__dirname, '..', 'bench', 'ru', 'questions.jsonl'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))

// The overriding check needs the sources by canonical URL, and which question cited them.
const benchSources = new Map()
for (const q of questions) for (const s of (q.sources || [])) benchSources.set(normalizeUrlKey(s), q.id)

console.log(`quality gate A/B — priority=${PRIORITY} threshold=${THRESHOLD} topN=${TOP_N}`)
console.log(`trust component: structurally 0 on the sweep path; llm component: ${PRIORITY === 'critical' ? 'active' : '0 (stage 2 is critical-only)'}`)
console.log(`bench sources to protect: ${benchSources.size}\n`)

const rows = []
let keptAll = 0, rejectedAll = 0
let stage1Skipped = 0
const rejectedBenchSources = []
const composites = []
const partsAll = { emb: [], authority: [], llm: [], trust: [] }

console.log('  kept/tot   medComp   query')
for (const q of questions) {
  let web
  try { web = JSON.parse(readFileSync(q.pair_web, 'utf8')) } catch { continue }
  const results = (web?.web?.results || [])
    .filter(r => r?.url)
    .map(r => ({ url: r.url, title: r.title || '', description: r.description || '' }))
  if (results.length < 2) continue
  const query = web?.query?.original || q.question

  // Stage 1 populates _rerank_score, which carries 0.4 of the composite. Without it the gate
  // cannot clear 0.4 on any unknown host, so skipping it would guarantee a 100% rejection rate
  // that says nothing about the gate.
  const { reranked, skipped } = await rerankByEmbedding(query, results)
  if (skipped) stage1Skipped++
  let staged = reranked.slice(0, TOP_N)

  if (PRIORITY === 'critical' && staged.length > 1) {
    const r2 = await rerankByLLM(query, staged)
    staged = r2.reranked
  }

  const gate = applyQualityGate(staged, { threshold: THRESHOLD })
  keptAll += gate.kept.length
  rejectedAll += gate.rejected.length

  for (const r of [...gate.kept, ...gate.rejected]) {
    composites.push(r._quality_composite)
    partsAll.emb.push(r._quality_parts.emb)
    partsAll.authority.push(r._quality_parts.authority)
    partsAll.llm.push(r._quality_parts.llm)
    partsAll.trust.push(r._quality_parts.trust)
  }
  for (const r of gate.rejected) {
    const hit = benchSources.get(normalizeUrlKey(r.url))
    if (hit) rejectedBenchSources.push({ url: r.url, cited_by: hit, composite: r._quality_composite, parts: r._quality_parts })
  }

  const comps = [...gate.kept, ...gate.rejected].map(r => r._quality_composite).sort((a, b) => a - b)
  const med = comps.length ? comps[Math.floor(comps.length / 2)] : 0
  rows.push({
    id: q.id, query, kept: gate.kept.length, rejected: gate.rejected.length,
    rejection_rate: gate.rejection_rate, median_composite: med, stage1_skipped: skipped
  })
  console.log(`  ${String(gate.kept.length).padStart(4)}/${String(gate.kept.length + gate.rejected.length).padEnd(3)}   ${med.toFixed(3)}    ${query.slice(0, 46)}`)
}

const total = keptAll + rejectedAll
const rate = total ? rejectedAll / total : 0
composites.sort((a, b) => a - b)
const pct = p => composites.length ? composites[Math.min(composites.length - 1, Math.floor(p * composites.length))] : 0

console.log('\n' + '='.repeat(70))
console.log(`results: ${total}   kept ${keptAll}   rejected ${rejectedAll}   rejection rate ${(rate * 100).toFixed(1)}%`)
console.log(`composite percentiles  p10 ${pct(0.1).toFixed(3)}  p50 ${pct(0.5).toFixed(3)}  p90 ${pct(0.9).toFixed(3)}  max ${(composites[composites.length - 1] || 0).toFixed(3)}`)
if (stage1Skipped) console.log(`⚠ stage 1 (embedding) was SKIPPED on ${stage1Skipped} queries — emb=0 there, so those rejections are an artefact of a missing embedder, not of the gate.`)

// A gate is only useful if some threshold separates good results from bad ones. Sweeping the
// composites already computed shows what every alternative threshold would do — and whether the
// distribution has enough spread for any of them to be a real operating point.
console.log('\n  threshold   rejected%   (what moving the knob would do)')
for (const t of [0.30, 0.35, 0.38, 0.40, 0.42, 0.44, 0.46, 0.48, 0.50, 0.55]) {
  const rej = composites.filter(c => c < t).length
  const bar = '█'.repeat(Math.round(40 * rej / (composites.length || 1)))
  console.log(`     ${t.toFixed(2)}      ${(100 * rej / composites.length).toFixed(1).padStart(5)}%   ${bar}`)
}
const spread = (composites[composites.length - 1] || 0) - (composites[0] || 0)
console.log(`\n  composite range across ALL ${composites.length} results: ${(composites[0] || 0).toFixed(3)} … ${(composites[composites.length - 1] || 0).toFixed(3)} (spread ${spread.toFixed(3)})`)

// Which component is flat? A weighted sum can only separate results if at least one of its
// inputs varies. Reported per component so the answer is measured rather than inferred from
// the composite's shape.
console.log('\n  component     min     p50     max    spread   weight   contribution to spread')
const W = { emb: 0.4, authority: 0.3, llm: 0.2, trust: 0.1 }
const partStats = {}
for (const [name, vals] of Object.entries(partsAll)) {
  const v = [...vals].sort((a, b) => a - b)
  const lo = v[0] ?? 0, hi = v[v.length - 1] ?? 0, mid = v[Math.floor(v.length / 2)] ?? 0
  partStats[name] = { min: lo, p50: mid, max: hi, spread: hi - lo, weighted_spread: (hi - lo) * W[name] }
  console.log(`  ${name.padEnd(11)} ${lo.toFixed(3)}  ${mid.toFixed(3)}  ${hi.toFixed(3)}   ${(hi - lo).toFixed(3)}    ${W[name].toFixed(1)}      ${((hi - lo) * W[name]).toFixed(3)}`)
}

console.log('')
if (rejectedBenchSources.length) {
  console.log(`✖ OVERRIDING RULE TRIPPED: ${rejectedBenchSources.length} rejected URLs are cited sources in bench reference answers.`)
  for (const r of rejectedBenchSources.slice(0, 12)) {
    console.log(`   composite ${r.composite.toFixed(3)}  emb ${r.parts.emb.toFixed(2)} auth ${r.parts.authority.toFixed(2)} llm ${r.parts.llm.toFixed(2)} trust ${r.parts.trust.toFixed(2)}  ${r.cited_by}`)
    console.log(`     ${r.url}`)
  }
  if (rejectedBenchSources.length > 12) console.log(`   … and ${rejectedBenchSources.length - 12} more`)
  console.log('   → do not enable the gate, regardless of the rejection rate.')
} else {
  console.log('✓ no bench-cited source was rejected.')
}

console.log('')
if (rate > 0.90) {
  console.log(`VERDICT: ${(rate * 100).toFixed(1)}% rejected — this is a mute button, not a gate.`)
  console.log('  Check the emb and llm components before touching the threshold: a component that is')
  console.log('  structurally 0 caps the composite below the threshold no matter how good the result is.')
} else if (rate < 0.30) {
  console.log(`VERDICT: ${(rate * 100).toFixed(1)}% rejected — the gate barely fires. Enabling it buys nothing.`)
} else if (rate >= 0.60 && rate <= 0.80) {
  console.log(`VERDICT: ${(rate * 100).toFixed(1)}% rejected — inside the 60-80% target band.`)
  console.log(`  ${rejectedBenchSources.length ? 'But the overriding rule above blocks enabling it.' : 'Review the reject pile by hand before enabling.'}`)
} else {
  console.log(`VERDICT: ${(rate * 100).toFixed(1)}% rejected — outside the 60-80% target band but not degenerate.`)
}

const out = arg('--json', null)
if (out) {
  writeFileSync(out, JSON.stringify({
    generated: new Date().toISOString(), priority: PRIORITY, threshold: THRESHOLD, topN: TOP_N,
    total, kept: keptAll, rejected: rejectedAll, rejection_rate: rate,
    percentiles: { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9) },
    composites, composite_spread: spread, part_stats: partStats,
    threshold_sweep: [0.30, 0.35, 0.38, 0.40, 0.42, 0.44, 0.46, 0.48, 0.50, 0.55]
      .map(t => ({ t, rejected_pct: Number((100 * composites.filter(c => c < t).length / (composites.length || 1)).toFixed(1)) })),
    stage1_skipped_queries: stage1Skipped,
    rejected_bench_sources: rejectedBenchSources, rows
  }, null, 2))
  console.log(`\nwrote ${out}`)
}
