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
}
