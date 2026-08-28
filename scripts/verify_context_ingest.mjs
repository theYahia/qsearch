#!/usr/bin/env node
// Verify the C0 context backfill did what it claimed, and did not damage what was already there.
//
// Counting note: estimatedTotalHits from search() saturates at maxTotalHits (default 1000), so
// "1000 context documents" from a search is indistinguishable from a million. The documents
// endpoint returns an exact `total` and is used for every count here.
//
// Usage: node scripts/verify_context_ingest.mjs [--baseline 359092] [--sample 5]

import '../src/env.js'
import { Meilisearch } from 'meilisearch'

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d }
const BASELINE = Number(arg('--baseline', '359092'))
const SAMPLE = Number(arg('--sample', '5'))
const GROWTH_GUARD = 0.10

const client = new Meilisearch({
  host: process.env.MEILISEARCH_URL || 'http://127.0.0.1:7700',
  apiKey: process.env.MEILISEARCH_KEY || 'masterKey'
})
const idx = client.index('qsearch_corpus')

const exactCount = async (filter) => (await idx.getDocuments({ filter, limit: 1, fields: ['id'] })).total

const stats = await idx.getStats()
const total = stats.numberOfDocuments
const growth = (total - BASELINE) / BASELINE

console.log('=== corpus size ===')
console.log(`baseline ${BASELINE} → now ${total}   growth ${(growth * 100).toFixed(2)}%`)
console.log(growth > GROWTH_GUARD
  ? `⚠ growth exceeds the ${GROWTH_GUARD * 100}% guard — context URLs should mostly MERGE into existing web documents, not create new ones. Investigate before continuing.`
  : `✓ under the ${GROWTH_GUARD * 100}% guard: context text is deepening existing documents rather than duplicating them.`)

console.log('\n=== context reach ===')
const ctxOnly = await exactCount('backend_source = "brave_context"')
console.log(`documents whose ONLY source is llm/context : ${ctxOnly}`)
console.log(ctxOnly > 0
  ? '✓ non-zero — before this pass the corpus held exactly 0 context documents despite the endpoint being paid for.'
  : '✖ still zero — the ingest did not reach the index.')

console.log('\n=== merge integrity ===')
console.log('Five documents carrying context text, checked for the damage a bad merge would do:')
const page = await idx.getDocuments({
  filter: 'backend_source = "brave_context"', limit: SAMPLE,
  fields: ['url', 'title', 'text', 'description', 'engines', 'crawled_at', 'crawled_at_ms']
})
let intact = 0
for (const d of page.results || []) {
  const problems = []
  if (!d.title) problems.push('title lost')
  if (!d.text || d.text.length < 50) problems.push(`text suspiciously short (${d.text?.length || 0})`)
  if (!Array.isArray(d.engines) || !d.engines.length) problems.push('engines lost')
  if (!problems.length) intact++
  console.log(`  ${problems.length ? '✖ ' + problems.join('; ') : '✓'}  text=${String(d.text?.length || 0).padStart(6)}ch  engines=${(d.engines || []).join('/')}  ${String(d.url).slice(0, 58)}`)
}
console.log(`${intact}/${(page.results || []).length} intact`)

console.log('\n=== crawled_at_ms coverage (freshness filter prerequisite) ===')
const withMs = await exactCount('crawled_at_ms EXISTS')
const withIso = await exactCount('crawled_at EXISTS')
console.log(`crawled_at present    : ${withIso}`)
console.log(`crawled_at_ms present : ${withMs}  (${total ? (100 * withMs / total).toFixed(1) : 0}% of the corpus)`)
console.log(withMs < withIso
  ? `→ ${withIso - withMs} documents still lack the numeric field and are INVISIBLE to a freshness-filtered lookup. Run scripts/backfill-crawled-at-ms.mjs.`
  : '✓ every document with a timestamp has the numeric companion; the freshness filter can be trusted.')
