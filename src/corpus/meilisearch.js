import { Meilisearch } from 'meilisearch'
import { CorpusBackend } from './interface.js'

const INDEX_NAME = 'qsearch_corpus'

export class MeilisearchCorpus extends CorpusBackend {
  constructor (url, key) {
    super()
    this._client = new Meilisearch({ host: url, apiKey: key })
    this._ready = false
  }

  get name () { return 'meilisearch' }

  async _ensureIndex () {
    if (this._ready) return
    try {
      await this._client.createIndex(INDEX_NAME, { primaryKey: 'id' })
    } catch (e) {
      if (!e.message?.includes('already exists')) throw e
    }
    const idx = this._client.index(INDEX_NAME)
    await idx.updateSearchableAttributes(['title', 'text', 'url'])
    await idx.updateFilterableAttributes(['engines', 'engine_count', 'namespace', 'backend_source', 'sweep_label', 'url'])
    await idx.updateSortableAttributes(['engine_count', 'sweep_count', 'first_seen'])
    this._ready = true
  }

  async ping () {
    try {
      await this._client.health()
      return true
    } catch { return false }
  }

  _urlToId (url) {
    // Meilisearch IDs: alphanumeric + hyphens + underscores only. Hash the URL.
    let h = 0
    for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0
    return 'doc-' + Math.abs(h).toString(36) + '-' + url.replace(/[^a-z0-9]/gi, '_').slice(0, 40)
  }

  async index (doc) {
    await this._ensureIndex()
    const idx = this._client.index(INDEX_NAME)
    const id = this._urlToId(doc.url)

    let merged = { ...doc, id }
    try {
      const existing = await idx.getDocument(id)
      const engines = [...new Set([...(existing.engines || []), ...(doc.engines || [])])]
      const prevSweeps = existing.appeared_in_sweeps || []
      const newSweepEntry = { sweep_label: doc.sweep_label ?? null, crawled_at: doc.crawled_at, engines: doc.engines || [] }
      const alreadyRecorded = doc.sweep_label != null && prevSweeps.some(s => s.sweep_label === doc.sweep_label)
      merged = {
        ...existing,
        ...doc,
        id,
        engines,
        engine_count: engines.length,
        appeared_in_sweeps: alreadyRecorded ? prevSweeps : [...prevSweeps, newSweepEntry]
      }
    } catch (e) {
      // Only "document_not_found" (404) is expected — log anything else
      if (!e.message?.includes('not_found') && e.httpStatus !== 404) {
        console.error('[corpus] getDocument unexpected error:', e.message)
      }
      merged.appeared_in_sweeps = [{ sweep_label: doc.sweep_label ?? null, crawled_at: doc.crawled_at, engines: doc.engines || [] }]
    }

    await idx.addDocuments([merged])
  }

  async search (query, opts = {}) {
    await this._ensureIndex()
    const idx = this._client.index(INDEX_NAME)
    const { hits } = await idx.search(query, { limit: opts.limit || 5 })
    return hits.map(h => ({
      url: h.url,
      title: h.title,
      description: h.text?.slice(0, 300) || null,
      extra_snippets: [],
      age: null,
      page_age: h.crawled_at || null,
      language: null,
      source: 'corpus'
    }))
  }

  async stats () {
    try {
      await this._ensureIndex()
      const idx = this._client.index(INDEX_NAME)
      const s = await idx.getStats()
      const highTrust = await idx.search('', { filter: 'engine_count >= 3', limit: 0 })
      return { total: s.numberOfDocuments, size_mb: null, high_trust_count: highTrust.estimatedTotalHits ?? 0 }
    } catch (e) {
      console.error('[corpus] stats() failed:', e.message)
      return { total: 0, size_mb: null, high_trust_count: 0 }
    }
  }

  /**
   * Compute trust score for a given URL by scanning corpus.
   * trust = log(sweep_count + 1) × engine_diversity × topic_diversity
   *
   * @param {string} url
   * @returns {Promise<Object|null>} trust object or null if URL not found
   */
  async trustScore (url) {
    await this._ensureIndex()
    const idx = this._client.index(INDEX_NAME)

    const { hits } = await idx.search('', {
      filter: `url = '${url.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
      limit: 100,
      attributesToRetrieve: ['url', 'title', 'sweep_label', 'engines', 'engine_count', 'crawled_at', 'namespace']
    })

    if (!hits.length) return null

    const sweepLabels = new Set()
    const allEngines = new Set()
    const topics = new Set()
    const appearedInSweeps = []

    for (const h of hits) {
      if (h.sweep_label) {
        sweepLabels.add(h.sweep_label)
        topics.add(h.sweep_label.split('_')[0])
      }
      for (const e of h.engines || []) allEngines.add(e)
      appearedInSweeps.push({
        sweep_label: h.sweep_label,
        crawled_at: h.crawled_at,
        engines: h.engines || []
      })
    }

    const sweepCount = sweepLabels.size
    const engineDiversity = allEngines.size
    const topicDiversity = topics.size
    const trustScore = Math.log(sweepCount + 1) * engineDiversity * topicDiversity

    return {
      url,
      title: hits[0].title,
      trust_score: Number(trustScore.toFixed(2)),
      sweep_count: sweepCount,
      engine_count: engineDiversity,
      topic_diversity: topicDiversity,
      engines: [...allEngines],
      first_seen: hits.map((h) => h.crawled_at).filter(Boolean).sort()[0] || null,
      appeared_in_sweeps: appearedInSweeps
    }
  }

  /**
   * Top URLs in corpus ranked by trust score.
   *
   * @param {Object} opts
   * @param {number} opts.limit
   * @param {number} opts.minEngines - filter to URLs with engine_count >= this
   * @returns {Promise<Array<Object>>}
   */
  async topByTrust ({ limit = 20, minEngines = 1, sort = 'trust', offset = 0 } = {}) {
    await this._ensureIndex()
    const idx = this._client.index(INDEX_NAME)

    if (sort === 'trust') {
      const { hits } = await idx.search('', {
        filter: `engine_count >= ${minEngines}`,
        limit: 5000,
        attributesToRetrieve: ['url', 'title', 'engines', 'engine_count', 'appeared_in_sweeps', 'sweep_label']
      })
      const seen = new Map()
      for (const h of hits) {
        if (!h.url || seen.has(h.url)) continue
        const sweepCount = Math.max(1, (h.appeared_in_sweeps || []).length || (h.sweep_label ? 1 : 0))
        const engines = new Set(h.engines || [])
        const topics = new Set((h.appeared_in_sweeps || []).map(s => s.sweep_label?.split('_')[0]).filter(Boolean))
        if (!topics.size && h.sweep_label) topics.add(h.sweep_label.split('_')[0])
        const trustScore = Math.log(sweepCount + 1) * engines.size * (topics.size || 1)
        seen.set(h.url, {
          url: h.url,
          title: h.title || '',
          trust_score: Number(trustScore.toFixed(2)),
          sweep_count: sweepCount,
          engine_count: engines.size,
          topic_diversity: topics.size || 1
        })
      }
      return [...seen.values()]
        .sort((a, b) => b.trust_score - a.trust_score)
        .slice(offset, offset + limit)
    }

    const sortMap = { engine_count: 'engine_count:desc', sweep_count: 'sweep_count:desc', first_seen: 'first_seen:asc' }
    const msSort = sortMap[sort] || 'engine_count:desc'
    const { hits } = await idx.search('', {
      filter: `engine_count >= ${minEngines}`,
      sort: [msSort],
      limit,
      offset,
      attributesToRetrieve: ['url', 'title', 'engine_count', 'sweep_count', 'first_seen', 'appeared_in_sweeps', 'sweep_label']
    })
    return hits.map(h => ({
      url: h.url,
      title: h.title || '',
      trust_score: Number((Math.log(((h.appeared_in_sweeps || []).length || 1) + 1) * (h.engine_count || 0)).toFixed(2)),
      sweep_count: (h.appeared_in_sweeps || []).length || (h.sweep_label ? 1 : 0),
      engine_count: h.engine_count || 0,
      topic_diversity: 1
    }))
  }
}
