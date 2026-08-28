#!/usr/bin/env node
/**
 * corpus_coverage_sweep.mjs — is _rankingScore usable as a corpus-coverage signal at all?
 *
 * The ultra-broad tier serves a query from the local corpus, for $0, when corpusLookup reports
 * `sufficient`. The shipped rule is: at least 3 hits AND the MEAN _rankingScore >= 0.55. Both
 * halves are questionable, and one is verifiably wrong:
 *
 *   - Averaging hides the spread. A set scoring 0.9 / 0.5 / 0.3 passes a 0.55 floor on the
 *     strength of a single hit.
 *   - 0.55 sits inside the noise band. Measured against the live index, "цена на бананы в
 *     Эквадоре сегодня" passed at avg 0.604. _rankingScore reflects Meilisearch's ranking
 *     rules — typo tolerance, proximity, partial token overlap — not relevance to the corpus,
 *     and partial overlap parks it around 0.5-0.6 for almost any Russian query.
 *
 * So this does not audit "is 0.55 right?", which presumes a right answer exists. It sweeps the
 * threshold across three different decision rules and asks whether ANY setting separates
 * queries the corpus can answer from queries it cannot:
 *
 *   mean       — current behaviour: mean(score) >= T
 *   floor      — per-hit: at least `minHits` of the top-5 hits score >= T
 *   floor_deep — the same floor over the top-20. Stands in for Meilisearch's native
 *                rankingScoreThreshold, which this server cannot accept: it runs 1.7.6 and the
 *                parameter arrived in 1.8.
 *
 * Decision rule, fixed before the run:
 *   a threshold reaching >= 80% recall on `covered` at <= 10% false positives → adopt it.
 *   no such threshold → _rankingScore does not work as a coverage signal. Leave the tier off
 *   and evaluate cosine similarity from embedding_rerank.js instead. DO NOT tune the number
 *   until the table looks good; "no threshold works" is a result, not a failed run.
 *
 * Reads only. Costs $0 — never touches a paid backend.
 *
 * Usage: node scripts/corpus_coverage_sweep.mjs [--min-hits 3] [--json out.json]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import '../src/env.js'
import { MeilisearchCorpus } from '../src/corpus/meilisearch.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d }

const MIN_HITS = Number(arg('--min-hits', '3'))
const LIMIT = Number(arg('--limit', '5'))
const RECALL_TARGET = 0.80
const FP_CEILING = 0.10
const THRESHOLDS = Array.from({ length: 14 }, (_, i) => Number((0.30 + i * 0.05).toFixed(2)))

const corpus = new MeilisearchCorpus(
  process.env.MEILISEARCH_URL || 'http://127.0.0.1:7700',
  process.env.MEILISEARCH_KEY || 'masterKey'
)

const set = JSON.parse(readFileSync(join(__dirname, '..', 'bench', 'corpus_coverage', 'queries.json'), 'utf8'))
const groups = set.groups

// ── collect once, evaluate many times ─────────────────────────────────────────
// maxAgeDays 0 deliberately: this measures the SCORE signal. Mixing in a freshness cut would
// confound "the corpus cannot answer this" with "the corpus answered it a while ago".
const observed = {}
for (const [group, items] of Object.entries(groups)) {
  observed[group] = []
  for (const item of items) {
    const r = await corpus.corpusLookup(item.q, { minScore: 0, minHits: 1, maxAgeDays: 0, limit: LIMIT })
    observed[group].push({ q: item.q, scores: r.scores || [], count: r.count, avg: r.avgScore })
  }
}

// Third rule: a floor applied over a DEEPER candidate list.
//
// This was meant to be Meilisearch's native rankingScoreThreshold, which drops weak hits
// server-side. It is not available here: the deployed server is 1.7.6 (commit 2024-04-10) and
// the parameter landed in 1.8 — it is rejected outright with
//   Unknown field `rankingScoreThreshold`: expected one of `q`, `vector`, ...
// so adopting it would mean upgrading Meilisearch, not just passing an argument.
//
// The client-side equivalent: pull DEEP_LIMIT hits and count how many clear the floor. Note
// that over the same list this is identical to the `floor` rule — the only thing the extra
// depth buys is the chance that hit 6..20 clears a bar that the top 5 did not.
const DEEP_LIMIT = Number(arg('--deep-limit', '20'))
const idx = await corpus.getIndex()
const deepScores = {}
for (const [group, items] of Object.entries(groups)) {
  deepScores[group] = []
  for (const item of items) {
    const res = await idx.search(item.q, { limit: DEEP_LIMIT, showRankingScore: true })
    deepScores[group].push({ q: item.q, scores: (res.hits || []).map(h => h._rankingScore ?? 0) })
  }
}

// ── the three decision rules ──────────────────────────────────────────────────
const RULES = {
  mean: (o, t) => o.count >= MIN_HITS && o.avg >= t,
  floor: (o, t) => o.scores.filter(s => s >= t).length >= MIN_HITS,
  floor_deep: (o, t, deep) => deep.scores.filter(s => s >= t).length >= MIN_HITS
}

const rate = (group, rule, t) =>
  observed[group].filter((o, i) => RULES[rule](o, t, deepScores[group][i])).length / observed[group].length

console.log(`corpus-coverage threshold sweep — minHits=${MIN_HITS}, limit=${LIMIT}`)
console.log(`covered=${groups.covered.length}  plausible_uncovered=${groups.plausible_uncovered.length}  alien=${groups.alien.length}`)
console.log(`target: recall >= ${RECALL_TARGET * 100}% at false positives <= ${FP_CEILING * 100}%\n`)

const table = {}
for (const rule of Object.keys(RULES)) {
  console.log(`── rule: ${rule} ${'─'.repeat(46)}`)
  console.log('    T     recall   FP(plausible)   FP(alien)   FP(all)   meets target')
  table[rule] = []
  for (const t of THRESHOLDS) {
    const recall = rate('covered', rule, t)
    const fpPlaus = rate('plausible_uncovered', rule, t)
    const fpAlien = rate('alien', rule, t)
    const nNeg = groups.plausible_uncovered.length + groups.alien.length
    const fpAll = (fpPlaus * groups.plausible_uncovered.length + fpAlien * groups.alien.length) / nNeg
    const meets = recall >= RECALL_TARGET && fpAll <= FP_CEILING
    table[rule].push({ t, recall, fpPlaus, fpAlien, fpAll, meets })
    console.log(`  ${t.toFixed(2)}   ${(recall * 100).toFixed(0).padStart(5)}%   ${(fpPlaus * 100).toFixed(0).padStart(11)}%   ${(fpAlien * 100).toFixed(0).padStart(8)}%   ${(fpAll * 100).toFixed(0).padStart(6)}%   ${meets ? '  ✓' : ''}`)
  }
  console.log('')
}

// ── verdict ───────────────────────────────────────────────────────────────────
const winners = []
for (const [rule, rows] of Object.entries(table)) {
  const ok = rows.filter(r => r.meets)
  if (ok.length) {
    // Among qualifying thresholds prefer the one with the most headroom over the FP ceiling,
    // breaking ties toward higher recall.
    ok.sort((a, b) => (a.fpAll - b.fpAll) || (b.recall - a.recall))
    winners.push({ rule, ...ok[0] })
  }
}

console.log('='.repeat(72))
if (!winners.length) {
  console.log('VERDICT: no threshold, under any of the three rules, reaches the target.')
  console.log(`  _rankingScore does not separate answerable queries from unanswerable ones on`)
  console.log('  this corpus. Do not enable ultra-broad and do not tune the number to fit.')
  console.log('  Next candidate signal: cosine similarity via src/rerank/embedding_rerank.js.')
} else {
  winners.sort((a, b) => (a.fpAll - b.fpAll) || (b.recall - a.recall))
  const w = winners[0]
  console.log(`VERDICT: rule=${w.rule} threshold=${w.t} → recall ${(w.recall * 100).toFixed(0)}%, false positives ${(w.fpAll * 100).toFixed(0)}%`)
  console.log(`  Meets the pre-registered target. Set QSEARCH_ULTRA_BROAD_MIN_SCORE=${w.t}` +
    (w.rule === 'mean' ? '.' : ` and switch the gate to the "${w.rule}" rule.`))
  if (winners.length > 1) console.log(`  (${winners.length} rules qualified; the others: ${winners.slice(1).map(x => `${x.rule}@${x.t}`).join(', ')})`)
}

// The single verified false positive gets called out by name — it is the reason for the sweep.
const banana = observed.alien.find(o => o.q.includes('бананы'))
if (banana) {
  console.log(`\n  "${banana.q}": ${banana.count} hits, avg ${banana.avg.toFixed(3)}, scores [${banana.scores.map(s => s.toFixed(2)).join(' ')}]`)
  console.log(`  shipped gate (mean >= 0.55): ${RULES.mean(banana, 0.55) ? 'PASSES — still a false positive' : 'correctly rejected'}`)
}

const out = arg('--json', null)
if (out) {
  writeFileSync(out, JSON.stringify({
    generated: new Date().toISOString(), minHits: MIN_HITS, limit: LIMIT, deepLimit: DEEP_LIMIT,
    meilisearch_version: '1.7.6', native_threshold_available: false,
    recallTarget: RECALL_TARGET, fpCeiling: FP_CEILING, observed, deepScores, table, winners
  }, null, 2))
  console.log(`\nwrote ${out}`)
}
