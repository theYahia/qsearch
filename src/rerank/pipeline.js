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
import { rerankByLLM } from './llm_rerank.js'
import { applyQualityGate } from './quality_gate.js'

const RERANK_ENABLED = process.env.QSEARCH_RERANK_ENABLED === 'true'
const STAGE2_PRIORITIES = new Set(
  (process.env.QSEARCH_RERANK_STAGE2_PRIORITIES || 'critical').split(',').map(s => s.trim()).filter(Boolean)
)
const TOP_N_PER_QUERY = parseInt(process.env.QSEARCH_RERANK_TOP_N_PER_QUERY || '10', 10)
const QUALITY_GATE_ENABLED = process.env.QSEARCH_QUALITY_GATE_ENABLED === 'true'

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
  let stage2Ran = 0, stage2Calls = 0
  let gateRan = 0, totalKept = 0, totalRejected = 0
  const topN = opts.topN || TOP_N_PER_QUERY

  for (const [, entry] of merged) {
    if (!entry?.ok || !Array.isArray(entry.results) || entry.results.length <= 1) continue

    // Stage 1: embedding rerank (cosine similarity, ~100ms via Ollama nomic-embed-text)
    const { reranked, skipped } = await rerankByEmbedding(entry.query, entry.results)
    if (skipped) stage1Skipped++
    else stage1Ran++
    entry.results = reranked.slice(0, topN)

    // Stage 2: LLM scoring for critical priority (qwen2.5:7b, ~160 URLs/min on RTX 3080).
    // Re-ranks top-20 → top-5 within the entry's already-trimmed top-N.
    if (STAGE2_PRIORITIES.has(entry.priority) && entry.results.length > 1) {
      const r2 = await rerankByLLM(entry.query, entry.results)
      entry.results = r2.reranked
      stage2Ran++
      stage2Calls += r2.stage2_calls || 0
    }

    // Layer 8: composite quality gate. Off by default — flip QSEARCH_QUALITY_GATE_ENABLED
    // after dogfooding threshold + weights on real sprints (target ~60-75% rejection).
    if (QUALITY_GATE_ENABLED && entry.results.length > 0) {
      const gate = applyQualityGate(entry.results)
      entry._rejected = gate.rejected      // available for debug, not rendered in markdown
      entry._rejection_rate = gate.rejection_rate
      entry.results = gate.kept
      gateRan++
      totalKept += gate.kept.length
      totalRejected += gate.rejected.length
    }
  }

  return {
    ran: true, ms: Date.now() - t0,
    stage1: { ran: stage1Ran, skipped: stage1Skipped },
    stage2: { ran: stage2Ran, calls: stage2Calls, implemented: true },
    gate: QUALITY_GATE_ENABLED
      ? { ran: gateRan, kept: totalKept, rejected: totalRejected,
          rejection_rate: (totalKept + totalRejected) > 0
            ? Number((totalRejected / (totalKept + totalRejected)).toFixed(3))
            : 0 }
      : { ran: 0, enabled: false }
  }
}
