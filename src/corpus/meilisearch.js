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
    await idx.addDocuments([{ ...doc, id }])
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
      return { total: s.numberOfDocuments, size_mb: null }
    } catch { return { total: 0, size_mb: null } }
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
      appeared_in_sweeps: appearedInSweeps.slice(0, 20)
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
  async topByTrust ({ limit = 20, minEngines = 1 } = {}) {
    await this._ensureIndex()
    const idx = this._client.index(INDEX_NAME)

    const { hits } = await idx.search('', {
      filter: `engine_count >= ${minEngines}`,
      limit: 5000,
      attributesToRetrieve: ['url', 'title', 'sweep_label', 'engines', 'engine_count']
    })

    const urlMap = new Map()
    for (const h of hits) {
      if (!h.url) continue
      let u = urlMap.get(h.url)
      if (!u) {
        u = { url: h.url, title: h.title || '', sweepLabels: new Set(), engines: new Set(), topics: new Set() }
        urlMap.set(h.url, u)
      }
      if (h.sweep_label) {
        u.sweepLabels.add(h.sweep_label)
        u.topics.add(h.sweep_label.split('_')[0])
      }
      for (const e of h.engines || []) u.engines.add(e)
    }

    return [...urlMap.values()]
      .map((u) => ({
        url: u.url,
        title: u.title,
        trust_score: Number((Math.log(u.sweepLabels.size + 1) * u.engines.size * u.topics.size).toFixed(2)),
        sweep_count: u.sweepLabels.size,
        engine_count: u.engines.size,
        topic_diversity: u.topics.size
      }))
      .sort((a, b) => b.trust_score - a.trust_score)
      .slice(0, limit)
  }
}
