import { SearchBackend } from './interface.js'

// rd1070: reliable no-key, no-CAPTCHA general engines (mojeek + bing carry results;
// duckduckgo + brave are opportunistic — SearXNG skips them while CAPTCHA/rate-limited).
export const DEFAULT_ENGINES = 'mojeek,bing,duckduckgo,brave'

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
    // `categories` selects a group of engines. rd1070 round 1 switched the broken
    // hard-coded `engines=general` to `categories=general`, but the *active* engines in
    // the general category are duckduckgo + brave — and both are perpetually blocked
    // (DDG CAPTCHA, Brave "Suspended: too many requests"), so /sweep still returned zero.
    // rd1070 round 2: default to an explicit list of engines that answer without
    // API keys or CAPTCHA walls (mojeek + bing both return ~10 each, verified
    // 2026-05-22); ddg/brave stay in the list as opportunistic extras — SearXNG silently
    // skips them while they're blocked. Caller can still override via opts.engines.
    if (opts.engines) searchUrl.searchParams.set('engines', opts.engines)
    else searchUrl.searchParams.set('engines', DEFAULT_ENGINES)
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

  // Health probe for the /health?deep=1 canary. Unlike search(), it does NOT slice to
  // top-N and returns engine-level metadata: which engines actually contributed (over the
  // FULL result set) and SearXNG's own unresponsive_engines verdict. This is the authoritative
  // per-engine health signal — counting engines in a top-N slice is misleading (rd1070 lesson:
  // a well-ranked brave/bing can mask a CAPTCHA-blocked duckduckgo, and a low-ranked mojeek
  // looks "silent" when it actually answered).
  async probe (query, opts = {}) {
    const engines = opts.engines || DEFAULT_ENGINES
    const searchUrl = new URL(`${this._url}/search`)
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('format', 'json')
    searchUrl.searchParams.set('engines', engines)
    if (opts.language) searchUrl.searchParams.set('language', opts.language)

    const r = await fetch(searchUrl.toString(), { headers: { Accept: 'application/json' } })
    if (!r.ok) {
      const e = new Error(`SearXNG error ${r.status}`)
      e.status = r.status
      throw e
    }
    const data = await r.json()
    const results = data.results || []
    const contributing = {}
    for (const item of results) {
      const engs = Array.isArray(item.engines) && item.engines.length
        ? item.engines
        : (item.engine ? [item.engine] : [])
      for (const e of engs) contributing[e] = (contributing[e] || 0) + 1
    }
    // SearXNG returns unresponsive_engines as [["duckduckgo","CAPTCHA"], ...] — normalize.
    const unresponsive = (data.unresponsive_engines || []).map(u =>
      Array.isArray(u) ? { engine: u[0], reason: u[1] ?? null } : u)
    return {
      total: results.length,
      configured_engines: engines.split(','),
      contributing_engines: contributing,
      unresponsive_engines: unresponsive
    }
  }
}
