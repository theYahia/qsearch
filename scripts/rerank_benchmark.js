// Rerank NDCG benchmark (Tier 4, 2026-06-23).
//
// Answers the open question from ANALYSIS-2026-06-23.md T4: does the rerank pipeline
// actually improve ordering, or just reshuffle? Computes NDCG@5 of the /search ordering
// against a golden relevance set. Run it twice to compare:
//
//   # baseline (server started normally)
//   node scripts/rerank_benchmark.js
//   # reranked (restart server with QSEARCH_RERANK_ENABLED=true), then:
//   node scripts/rerank_benchmark.js
//
// A <5% mean-NDCG lift from rerank means nomic-embed-text is too weak for this corpus
// (evaluate BGE / E5). Requires the server on :8080 and a filled golden set.
//
// Golden set: test/integration/golden/rerank_golden.json

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ndcgForRanking } from '../src/rerank/ndcg.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.QSEARCH_URL || 'http://localhost:8080'
const K = Number(process.env.BENCH_NDCG_K) || 5

const golden = JSON.parse(readFileSync(join(__dirname, '..', 'test', 'integration', 'golden', 'rerank_golden.json'), 'utf8'))
const queries = (golden.queries || []).filter(q => q.query && q.relevance && Object.keys(q.relevance).length)
if (!queries.length) {
  console.error('Golden set is empty — fill test/integration/golden/rerank_golden.json with real judgments first.')
  process.exit(1)
}

async function searchUrls (query) {
  const r = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, n_results: Math.max(K, 10), clean: false })
  })
  if (!r.ok) throw new Error(`/search ${r.status} for "${query}"`)
  const body = await r.json()
  return (body.results || []).map(x => x.url).filter(Boolean)
}

const scores = []
console.log(`NDCG@${K} over ${queries.length} golden queries (server: ${BASE})\n`)
for (const q of queries) {
  try {
    const ranked = await searchUrls(q.query)
    const score = ndcgForRanking(ranked, q.relevance, K)
    scores.push(score)
    console.log(`  ${score.toFixed(3)}  ${q.query.slice(0, 60)}`)
  } catch (e) {
    console.log(`  ----   ${q.query.slice(0, 60)}  (${e.message})`)
  }
}

if (scores.length) {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  console.log(`\nMean NDCG@${K} = ${mean.toFixed(4)}  (n=${scores.length})`)
  console.log('Record this with QSEARCH_RERANK_ENABLED off and on; a lift < 0.05 means the embedder is too weak.')
}
