export class CorpusBackend {
  get name () { return 'unnamed' }
  async index (doc) { throw new Error('not implemented') }
  async search (query, opts = {}) { return [] }
  async stats () { return { total: 0 } }
}
// doc: { id, title, url, text, namespace, crawled_at }
