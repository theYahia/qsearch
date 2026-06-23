import { Meilisearch } from 'meilisearch'
import { CorpusBackend } from './interface.js'
import { computeTrust, topicDiversity, daysSince, latestCrawledAt } from './trust.js'

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
    // Issue #5 (rd275 sprint): crawled_at filterable+sortable for freshness queries.
    // updateSettings() is async on Meilisearch side — index keeps serving while
    // reindex runs in background. Existing 143k docs without crawled_at remain
    // queryable (Meilisearch allows missing fields). Backfill via separate script.
    await idx.updateFilterableAttributes(['engines', 'engine_count', 'namespace', 'backend_source', 'sweep_label', 'url', 'crawled_at'])
    await idx.updateSortableAttributes(['engine_count', 'sweep_count', 'first_seen', 'crawled_at'])
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

  // rd275: expose the underlying index handle for callers that need richer
  // queries than search()/topByTrust() expose — e.g. /pre_sweep_check freshness
  // coverage with custom attributesToRetrieve.
  async getIndex () {
    await this._ensureIndex()
    return this._client.index(INDEX_NAME)
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

  // rd239 ultra-broad tier: corpus-only lookup with a sufficiency gate. Returns
  // { sufficient, count, avgScore, hits[] }. Lets the sweep router skip the SearXNG
  // round-trip when past sprints already answered this query; on insufficient hits
  // the caller falls through to the broad tier. Freshness-filtered (crawled_at) so
  // stale corpus entries don't masquerade as a current answer.
  async corpusLookup (query, opts = {}) {
    await this._ensureIndex()
    const idx = this._client.index(INDEX_NAME)
    const minScore = opts.minScore ?? 0.55
    const minHits = opts.minHits ?? 3
    const maxAgeDays = opts.maxAgeDays ?? 30
    // Optional trust gate (QSEARCH_ULTRA_BROAD_MIN_TRUST; default 0 = off). When set,
    // a high-BM25 but low-trust hit (single engine / single sweep) no longer short-circuits
    // a paid sweep. Default off because making trust a *sufficiency* gate (vs a rerank
    // signal) is a design change to the ultra-broad tier — see ANALYSIS-2026-06-23.md T2.
    const minTrust = opts.minTrust ?? 0
    const base = {
      limit: opts.limit || 5,
      showRankingScore: true,
      attributesToRetrieve: ['url', 'title', 'text', 'crawled_at', 'engines', 'engine_count', 'appeared_in_sweeps', 'sweep_label']
    }
    let res
    if (maxAgeDays > 0) {
      const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString()
      try {
        res = await idx.search(query, { ...base, filter: `crawled_at >= "${cutoff}"` })
      } catch {
        // crawled_at not filterable yet (schema migration pending) — degrade unfiltered.
        res = await idx.search(query, base)
      }
    } else {
      res = await idx.search(query, base)
    }
    const hits = res.hits || []
    const scores = hits.map(h => (typeof h._rankingScore === 'number' ? h._rankingScore : 0))
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    // Peak trust across hits (only computed when the gate is active).
    let maxTrust = 0
    if (minTrust > 0) {
      for (const h of hits) {
        const sweeps = h.appeared_in_sweeps || []
        const sweepCount = Math.max(1, sweeps.length || (h.sweep_label ? 1 : 0))
        const engineDiversity = new Set(h.engines || []).size || (h.engine_count || 0)
        const labels = sweeps.map(s => s.sweep_label).filter(Boolean)
        if (!labels.length && h.sweep_label) labels.push(h.sweep_label)
        const t = computeTrust({ sweepCount, engineDiversity, topicDiversity: topicDiversity(labels) || 1, daysSinceLastSeen: daysSince(latestCrawledAt(sweeps)) })
        if (t > maxTrust) maxTrust = t
      }
    }
    return {
      sufficient: hits.length >= minHits && avgScore >= minScore && (minTrust <= 0 || maxTrust >= minTrust),
      count: hits.length,
      avgScore,
      max_trust: Number(maxTrust.toFixed(2)),
      hits: hits.map(h => ({
        url: h.url,
        title: h.title,
        description: h.text?.slice(0, 300) || null,
        extra_snippets: [],
        age: null,
        page_age: h.crawled_at || null,
        language: null,
        engines: h.engines || [],
        source: 'corpus'
      }))
    }
  }

  async stats () {
    try {
      await this._ensureIndex()
      const idx = this._client.index(INDEX_NAME)
      const s = await idx.getStats()
      const highTrust = await idx.search('', { filter: 'engine_count >= 3', limit: 0 })

      // Issue #5 fix (rd275): surface last_crawled_at + count of docs with timestamp.
      // Graceful query — schema migration may still be reindexing (async).
      let lastCrawledAt = null
      let withTimestamp = 0
      try {
        const withTs = await idx.search('', { filter: 'crawled_at EXISTS', limit: 0 })
        withTimestamp = withTs.estimatedTotalHits ?? 0
        if (withTimestamp > 0) {
          const latest = await idx.search('', {
            filter: 'crawled_at EXISTS',
            sort: ['crawled_at:desc'],
            limit: 1,
            attributesToRetrieve: ['crawled_at']
          })
          lastCrawledAt = latest.hits?.[0]?.crawled_at ?? null
        }
      } catch (e) {
        // Migration pending on 143k-doc index, or Meilisearch <1.4 (EXISTS filter). Degrade silently.
        if (!/unknown.*attribute|invalid.*filter/i.test(e.message || '')) {
          console.warn('[corpus] freshness query failed:', e.message)
        }
      }

      return {
        total: s.numberOfDocuments,
        size_mb: null,
        high_trust_count: highTrust.estimatedTotalHits ?? 0,
        last_crawled_at: lastCrawledAt,
        documents_with_crawl_timestamp: withTimestamp
      }
    } catch (e) {
      console.error('[corpus] stats() failed:', e.message)
      return { total: 0, size_mb: null, high_trust_count: 0, last_crawled_at: null, documents_with_crawl_timestamp: 0 }
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
    const appearedInSweeps = []

    for (const h of hits) {
      if (h.sweep_label) sweepLabels.add(h.sweep_label)
      for (const e of h.engines || []) allEngines.add(e)
      appearedInSweeps.push({
        sweep_label: h.sweep_label,
        crawled_at: h.crawled_at,
        engines: h.engines || []
      })
    }

    const sweepCount = sweepLabels.size
    const engineDiversity = allEngines.size
    const topicDiv = topicDiversity([...sweepLabels])
    const daysSinceLastSeen = daysSince(latestCrawledAt(appearedInSweeps))
    // Single formula (src/corpus/trust.js) — same as both topByTrust branches.
    const trustScore = computeTrust({ sweepCount, engineDiversity, topicDiversity: topicDiv, daysSinceLastSeen })

    return {
      url,
      title: hits[0].title,
      trust_score: Number(trustScore.toFixed(2)),
      sweep_count: sweepCount,
      engine_count: engineDiversity,
      topic_diversity: topicDiv,
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

    // One row builder so every sort path returns a consistent trust_score. The
    // non-trust branch previously hardcoded topic_diversity=1, so the same URL got a
    // ~10x lower trust_score under ?sort=engine_count than ?sort=trust — fixed here.
    const trustRow = (h) => {
      const sweeps = h.appeared_in_sweeps || []
      const sweepCount = Math.max(1, sweeps.length || (h.sweep_label ? 1 : 0))
      const engineDiversity = new Set(h.engines || []).size || (h.engine_count || 0)
      const labels = sweeps.map(s => s.sweep_label).filter(Boolean)
      if (!labels.length && h.sweep_label) labels.push(h.sweep_label)
      const topicDiv = topicDiversity(labels) || 1
      const daysSinceLastSeen = daysSince(latestCrawledAt(sweeps))
      const trustScore = computeTrust({ sweepCount, engineDiversity, topicDiversity: topicDiv, daysSinceLastSeen })
      return {
        url: h.url,
        title: h.title || '',
        trust_score: Number(trustScore.toFixed(2)),
        sweep_count: sweepCount,
        engine_count: engineDiversity,
        topic_diversity: topicDiv
      }
    }

    if (sort === 'trust') {
      const { hits } = await idx.search('', {
        filter: `engine_count >= ${minEngines}`,
        limit: 5000,
        attributesToRetrieve: ['url', 'title', 'engines', 'engine_count', 'appeared_in_sweeps', 'sweep_label', 'crawled_at']
      })
      const seen = new Map()
      for (const h of hits) {
        if (!h.url || seen.has(h.url)) continue
        seen.set(h.url, trustRow(h))
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
      attributesToRetrieve: ['url', 'title', 'engines', 'engine_count', 'sweep_count', 'first_seen', 'appeared_in_sweeps', 'sweep_label', 'crawled_at']
    })
    return hits.map(trustRow)
  }
}
