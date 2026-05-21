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
    // SearXNG's `engines` param is a list of *engine names* (google, bing…), while
    // `categories` selects a group of engines. With settings.yml `keep_only` restricting
    // enabled engines to a named subset, the old hard-coded `engines=general` matched no
    // engine and SearXNG returned zero results — silently emptying every broad /sweep
    // query (rd1070). Default to the `general` *category* so all enabled engines run;
    // only set `engines` when the caller passes an explicit comma-separated name list.
    if (opts.engines) searchUrl.searchParams.set('engines', opts.engines)
    else searchUrl.searchParams.set('categories', 'general')
    // Phase C: language/region bias — domain=ru sets language=ru-RU upstream.
    if (opts.language) searchUrl.searchParams.set('language', opts.language)

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
