#!/usr/bin/env node
/**
 * pre_check_falsepos.mjs — how often does /pre_sweep_check claim coverage it does not have?
 *
 * The endpoint decides whether a sprint can skip paying Brave. Its verdict never looks at
 * relevance: a query is `covered` when at least 5 hits are both fresh (crawled_at inside the
 * window) and high-trust (engine_count >= 3). Both halves drift the wrong way over time:
 *
 *   - engine_count is a UNION across every sweep a URL ever appeared in, so it only ever grows.
 *   - crawled_at records when the corpus last re-swept the URL, not how current the page is.
 *
 * So the gate gets more permissive as the corpus ages, for every query, regardless of whether
 * the corpus actually knows anything about it. This measures that against the same three-group
 * set the threshold sweep uses — the `alien` group is the one that matters: any `covered`
 * verdict there is a query that would have been silently dropped from a paid sweep while the
 * corpus held nothing relevant.
 *
 * One thing that is NOT broken here, checked before assuming: the freshness comparison
 * `h.crawled_at >= freshCutoffIso` is a JS string comparison, and for ISO-8601 timestamps
 * lexicographic order equals chronological order. Unlike the Meilisearch-side filter this is
 * correct. Reads only, $0.
 *
 * Usage: node scripts/pre_check_falsepos.mjs [--freshness-days 7] [--json out.json]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import '../src/env.js'
import { MeilisearchCorpus } from '../src/corpus/meilisearch.js'
import { runPreSweepCheck } from '../src/sweep/pre_check.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d }
const FRESHNESS = Number(arg('--freshness-days', '7'))

const corpus = new MeilisearchCorpus(
  process.env.MEILISEARCH_URL || 'http://127.0.0.1:7700',
  process.env.MEILISEARCH_KEY || 'masterKey'
)
const idx = await corpus.getIndex()

const set = JSON.parse(readFileSync(join(__dirname, '..', 'bench', 'corpus_coverage', 'queries.json'), 'utf8'))
const out = {}

console.log(`/pre_sweep_check false-positive probe — freshness_days=${FRESHNESS}`)
console.log('covered = >=5 hits that are BOTH fresh AND engine_count>=3. Relevance is never consulted.\n')

for (const [group, items] of Object.entries(set.groups)) {
  const res = await runPreSweepCheck({ queries: items.map(i => i.q), freshness_days: FRESHNESS }, idx)
  out[group] = res.coverage
  const tally = { covered: 0, partial: 0, miss: 0 }
  console.log(`── ${group} (${items.length}) ${'─'.repeat(Math.max(0, 40 - group.length))}`)
  console.log('  verdict   hits  fresh  fresh+trust   query')
  for (const c of res.coverage) {
    tally[c.verdict]++
    console.log(`  ${c.verdict.padEnd(8)} ${String(c.corpus_hits).padStart(5)} ${String(c.fresh_hits).padStart(6)} ${String(c.fresh_high_trust).padStart(12)}   ${c.query.slice(0, 42)}`)
  }
  console.log(`  → covered ${tally.covered}, partial ${tally.partial}, miss ${tally.miss}\n`)
  out[group + '_tally'] = tally
}

const fp = out.alien_tally.covered + out.plausible_uncovered_tally.covered
const nNeg = set.groups.alien.length + set.groups.plausible_uncovered.length
console.log('='.repeat(66))
console.log(`recall on covered            : ${out.covered_tally.covered}/${set.groups.covered.length}`)
console.log(`false "covered" on alien     : ${out.alien_tally.covered}/${set.groups.alien.length}`)
console.log(`false "covered" on plausible : ${out.plausible_uncovered_tally.covered}/${set.groups.plausible_uncovered.length}`)
console.log(`false-positive rate overall  : ${(100 * fp / nNeg).toFixed(0)}%`)
console.log('')
if (fp > 0) {
  console.log('Every false "covered" is a query that would be dropped from a paid sweep while the')
  console.log('corpus holds nothing that answers it — the sprint silently loses that question.')
} else {
  console.log('No false "covered" verdicts at this corpus age. Worth re-running as the corpus grows:')
  console.log('engine_count only ever increases, so this gate loosens with time, not tightens.')
}

const j = arg('--json', null)
if (j) { writeFileSync(j, JSON.stringify({ generated: new Date().toISOString(), freshness_days: FRESHNESS, groups: out }, null, 2)); console.log(`\nwrote ${j}`) }
