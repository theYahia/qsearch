// Stage 2 rerank — LLM scoring for priority=critical queries.
// Pre-flight benchmark on RTX 3080: 160 URLs/min with qwen2.5:7b on short
// scoring prompts (5-token output). Top-20 → top-5 in ~7.5s on critical queries.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const LLM_MODEL = process.env.OLLAMA_CLEAN_MODEL || 'qwen2.5:7b-instruct'
const SCORE_TIMEOUT_MS = parseInt(process.env.OLLAMA_RERANK_TIMEOUT_MS || '15000', 10)
const STAGE2_TOP_IN = parseInt(process.env.QSEARCH_RERANK_STAGE2_TOP_IN || '20', 10)
const STAGE2_TOP_OUT = parseInt(process.env.QSEARCH_RERANK_STAGE2_TOP_OUT || '5', 10)
const STAGE2_CONCURRENCY = parseInt(process.env.QSEARCH_RERANK_STAGE2_CONCURRENCY || '6', 10)

const SCORE_PROMPT = (query, title, url, description) =>
`You score search results 1-5 for relevance to a research query.

Query: ${query}
Result:
  Title: ${title || ''}
  URL: ${url || ''}
  Description: ${(description || '').slice(0, 400)}

Score 1-5:
  5 = highly relevant primary source (peer-review, official docs, authoritative)
  4 = relevant secondary source
  3 = tangentially relevant
  2 = barely related
  1 = irrelevant or junk

Output only a single digit. No reasoning, no explanation.`

async function scoreOne (query, item) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SCORE_TIMEOUT_MS)
  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt: SCORE_PROMPT(query, item.title, item.url, item.description),
        stream: false,
        options: { temperature: 0.1, num_predict: 5 }
      }),
      signal: ctrl.signal
    })
    if (!r.ok) return null
    const data = await r.json()
    const m = String(data?.response || '').match(/\d/)
    if (!m) return null
    const score = parseInt(m[0], 10)
    return (score >= 1 && score <= 5) ? score : null
  } catch { return null }
  finally { clearTimeout(timer) }
}

async function batchScore (query, items, concurrency) {
  const out = new Array(items.length)
  let cursor = 0
  async function worker () {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await scoreOne(query, items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
  return out
}

export async function rerankByLLM (query, results, opts = {}) {
  if (!Array.isArray(results) || results.length <= 1) {
    return { reranked: results || [], skipped: false, reason: results?.length ? 'single' : 'empty', stage2_calls: 0 }
  }
  const topIn = Math.min(opts.topIn || STAGE2_TOP_IN, results.length)
  const topOut = Math.min(opts.topOut || STAGE2_TOP_OUT, topIn)
  const candidates = results.slice(0, topIn)
  const tail = results.slice(topIn)

  const scores = await batchScore(query, candidates, opts.concurrency || STAGE2_CONCURRENCY)
  const scored = candidates.map((r, i) => ({
    ...r,
    _rerank_score_llm: scores[i],
    _rerank_stage: scores[i] != null ? 'llm' : (r._rerank_stage || 'embedding')
  }))
  // Stable sort: LLM-scored items first (descending by score), tail at end.
  scored.sort((a, b) => (b._rerank_score_llm ?? -1) - (a._rerank_score_llm ?? -1))
  const top = scored.slice(0, topOut)
  return {
    reranked: [...top, ...tail],
    skipped: false,
    reason: 'ok',
    stage2_calls: candidates.length,
    stage2_kept: top.length
  }
}
