// Stage 1 rerank — cosine similarity between query embedding and each result's
// title+description embedding. Fast O(N) at small dims; bottleneck is the embed call.
//
// Uses Ollama (nomic-embed-text by default) since QVAC embeddings are unavailable
// in @qvac/sdk 0.9.1. Graceful fallback: if Ollama is down, returns results
// unchanged with score=null so the pipeline can skip stage 1.

import { ollamaEmbed, ollamaEmbedBatch, ollamaEmbedAvailable } from '../embed/ollama.js'

function cosineSim (a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom > 0 ? dot / denom : 0
}

function resultText (r) {
  const title = r.title || ''
  const desc = r.description || ''
  return `${title}\n${desc}`.slice(0, 800)
}

export async function rerankByEmbedding (query, results, opts = {}) {
  if (!Array.isArray(results) || results.length <= 1) {
    return { reranked: results || [], skipped: false, reason: results?.length ? 'single' : 'empty' }
  }
  if (!(await ollamaEmbedAvailable())) {
    return { reranked: results, skipped: true, reason: 'ollama_unavailable' }
  }
  const qVec = await ollamaEmbed(query).catch(() => null)
  if (!qVec) return { reranked: results, skipped: true, reason: 'query_embed_failed' }

  const texts = results.map(resultText)
  const vecs = await ollamaEmbedBatch(texts, { concurrency: opts.concurrency || 6 })

  const scored = results.map((r, i) => {
    const v = vecs[i]
    const score = v ? cosineSim(qVec, v) : 0
    return { ...r, _rerank_score: score, _rerank_stage: 'embedding' }
  })
  scored.sort((a, b) => (b._rerank_score || 0) - (a._rerank_score || 0))
  return { reranked: scored, skipped: false, reason: 'ok' }
}
