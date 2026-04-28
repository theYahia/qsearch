import { Meilisearch } from 'meilisearch'

const MEILI_URL = process.env.MEILISEARCH_URL || 'http://localhost:7700'
const MEILI_KEY = process.env.MEILISEARCH_KEY || 'masterKey'

/**
 * Re-rank corpus results by trust score.
 * trust = log(sweep_count + 1) × engine_diversity × topic_diversity
 * rerank_score = (1 / position) × log(trust + 1)
 *
 * @param {Array<Object>} results - corpus search results
 * @returns {Promise<Array<Object>>} re-ranked results with trust_score and rerank_score added
 */
export async function rerankByTrust (results) {
  if (!results.length) return results

  const client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY })
  const idx = client.index('qsearch_corpus')

  const ranked = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (!r.url) {
      ranked.push(r)
      continue
    }
    try {
      const { hits } = await idx.search('', {
        filter: `url = '${r.url.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
        limit: 50,
        attributesToRetrieve: ['sweep_label', 'engines']
      })

      const sweepLabels = new Set()
      const engines = new Set()
      const topics = new Set()
      for (const h of hits) {
        if (h.sweep_label) {
          sweepLabels.add(h.sweep_label)
          topics.add(h.sweep_label.split('_')[0])
        }
        for (const e of h.engines || []) engines.add(e)
      }

      const trustScore = Math.log(sweepLabels.size + 1) * engines.size * topics.size
      const relevance = 1 / (i + 1)
      const rerankScore = relevance * Math.log(trustScore + 1)

      ranked.push({
        ...r,
        trust_score: Number(trustScore.toFixed(2)),
        rerank_score: Number(rerankScore.toFixed(4))
      })
    } catch {
      ranked.push(r)
    }
  }

  ranked.sort((a, b) => (b.rerank_score || 0) - (a.rerank_score || 0))
  return ranked
}
