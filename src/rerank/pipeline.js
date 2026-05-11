// Rerank pipeline orchestrator. Default flow:
//   stage 1 (embedding) — fast, always on when Ollama embed available
//   stage 2 (LLM scoring) — optional, only for priority=critical by default
//   trust composite — multiply by per-URL trust score from corpus history
//
// Configurable via env:
//   QSEARCH_RERANK_ENABLED         on|off (default: off — flip to on after dogfood)
//   QSEARCH_RERANK_STAGE2_PRIORITIES  comma list (default: 'critical')
//   QSEARCH_RERANK_TOP_N_PER_QUERY  integer (default: 10)

import { rerankByEmbedding } from './embedding_rerank.js'

const RERANK_ENABLED = process.env.QSEARCH_RERANK_ENABLED === 'true'
const STAGE2_PRIORITIES = new Set(
  (process.env.QSEARCH_RERANK_STAGE2_PRIORITIES || 'critical').split(',').map(s => s.trim()).filter(Boolean)
)
const TOP_N_PER_QUERY = parseInt(process.env.QSEARCH_RERANK_TOP_N_PER_QUERY || '10', 10)

export function rerankEnabled () { return RERANK_ENABLED }

/**
 * Rerank a Map<label, {query, priority, domain, results}> in place.
 * Returns timing + per-stage skip flags.
 */
export async function rerankPipeline (merged, opts = {}) {
  if (!RERANK_ENABLED || !merged?.size) {
    return { ran: false, reason: RERANK_ENABLED ? 'empty' : 'disabled', ms: 0 }
  }
  const t0 = Date.now()
  let stage1Ran = 0, stage1Skipped = 0
  let stage2Ran = 0
  const topN = opts.topN || TOP_N_PER_QUERY

  for (const [, entry] of merged) {
    if (!entry?.ok || !Array.isArray(entry.results) || entry.results.length <= 1) continue

    // Stage 1: embedding rerank
    const { reranked, skipped } = await rerankByEmbedding(entry.query, entry.results)
    if (skipped) stage1Skipped++
    else stage1Ran++
    entry.results = reranked.slice(0, topN)

    // Stage 2: LLM scoring (placeholder — only flagged active for critical priority).
    // Full implementation gated behind a separate feature flag once QVAC/Ollama-LLM
    // throughput is benchmarked. For now we just tag the priority so the metric
    // shows where stage 2 would run.
    if (STAGE2_PRIORITIES.has(entry.priority)) {
      stage2Ran++
      entry._stage2_pending = true
    }
  }

  return {
    ran: true, ms: Date.now() - t0,
    stage1: { ran: stage1Ran, skipped: stage1Skipped },
    stage2: { ran: stage2Ran, implemented: false }
  }
}
