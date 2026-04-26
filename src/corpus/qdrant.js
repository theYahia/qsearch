import { QdrantClient } from '@qdrant/js-client-rest'
import { CorpusBackend } from './interface.js'

const COLLECTION = 'qsearch_corpus'

export class QdrantCorpus extends CorpusBackend {
  constructor (url, embedder) {
    super()
    this._client = new QdrantClient({ url })
    this._embedder = embedder
    this._ready = false
  }

  get name () { return 'qdrant' }

  async _ensureCollection () {
    if (this._ready) return
    try {
      await this._client.getCollection(COLLECTION)
    } catch {
      await this._client.createCollection(COLLECTION, {
        vectors: { size: this._embedder.dim, distance: 'Cosine' }
      })
    }
    this._ready = true
  }

  async ping () {
    try {
      await this._client.getCollections()
      return true
    } catch { return false }
  }

  async index (doc) {
    if (!this._embedder.available) return
    await this._ensureCollection()
    const vector = await this._embedder.embed(doc.text || doc.title)
    // Use numeric hash of URL as point ID (Qdrant requires uint64)
    const id = Math.abs(doc.url.split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0))
    await this._client.upsert(COLLECTION, {
      points: [{ id, vector, payload: { url: doc.url, title: doc.title, text: doc.text?.slice(0, 500), namespace: doc.namespace, crawled_at: doc.crawled_at } }]
    })
  }

  async search (query, opts = {}) {
    if (!this._embedder.available) return []
    try {
      await this._ensureCollection()
      const vector = await this._embedder.embed(query)
      const results = await this._client.search(COLLECTION, { vector, limit: opts.limit || 5, with_payload: true })
      return results.map(r => ({
        url: r.payload.url,
        title: r.payload.title,
        description: r.payload.text?.slice(0, 300) || null,
        extra_snippets: [],
        age: null,
        page_age: r.payload.crawled_at || null,
        language: null,
        source: 'corpus'
      }))
    } catch { return [] }
  }

  async stats () {
    try {
      await this._ensureCollection()
      const info = await this._client.getCollection(COLLECTION)
      return { total: info.points_count || 0 }
    } catch { return { total: 0 } }
  }
}
