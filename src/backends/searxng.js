import { SearchBackend } from './interface.js'

export class SearXNGBackend extends SearchBackend {
  constructor (url) {
    super()
    if (!url) throw new Error('SEARXNG_URL is required')
    this._url = url
  }

  get name () { return 'searxng' }

  async search (query, opts = {}) {
    const limit = opts.n_results || opts.count || 3
    const searchUrl = new URL(`${this._url}/search`)
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('format', 'json')
    searchUrl.searchParams.set('engines', 'general')

    const r = await fetch(searchUrl.toString(), {
      headers: { Accept: 'application/json' }
    })
    if (!r.ok) {
      const e = new Error(`SearXNG error ${r.status}`)
      e.status = r.status
      throw e
    }
    const data = await r.json()
    const items = (data.results || []).slice(0, limit)
    return items.map(item => {
      const engines = Array.isArray(item.engines) && item.engines.length
        ? item.engines
        : (item.engine ? [item.engine] : [])
      return {
        url: item.url,
        title: item.title,
        description: item.content || item.description || null,
        extra_snippets: [],
        age: null,
        page_age: null,
        language: item.language || null,
        engines,
        score: typeof item.score === 'number' ? item.score : null,
        source: 'searxng'
      }
    })
  }
}
