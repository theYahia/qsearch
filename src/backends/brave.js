import { SearchBackend } from './interface.js'

// ⚠️ ENDPOINT ROUTING:
//   'web'         → /res/v1/web/search
//   'news'        → /res/v1/news/search
//   'llm/context' → /res/v1/llm/context  (NO /search suffix!)
export async function braveFetch (endpoint, query, params) {
  const suffix = endpoint === 'llm/context' ? '' : '/search'
  const base = process.env.BRAVE_BASE_URL || 'https://api.search.brave.com'
  const url = new URL(`${base}/res/v1/${endpoint}${suffix}`)
  url.searchParams.set('q', query)
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v))
  }
  const start = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  const r = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': process.env.BRAVE_API_KEY
    },
    signal: ctrl.signal
  }).catch((err) => {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      const e = new Error('Brave API timeout (10s)')
      e.status = 504
      e.detail = 'Request to Brave Search API timed out after 10 seconds'
      throw e
    }
    throw err
  })
  clearTimeout(timer)
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    const e = new Error(`Brave API error ${r.status}`)
    e.status = r.status
    e.detail = err?.error?.detail || 'Unknown Brave API error'
    throw e
  }
  const data = await r.json()
  return { data, ms: Date.now() - start }
}

export class BraveBackend extends SearchBackend {
  get name () { return 'brave' }

  async search (query, opts = {}) {
    const count = opts.n_results || opts.count || 3
    const { data } = await braveFetch('web', query, {
      count,
      extra_snippets: true,
      text_decorations: false,
      freshness: opts.freshness || null,
      search_lang: opts.search_lang || null,
      country: opts.country || null,
      safesearch: opts.safesearch || null
    })
    const items = data?.web?.results || []
    return items.map(r => ({
      url: r.url,
      title: r.title,
      description: r.description || null,
      extra_snippets: r.extra_snippets || [],
      age: r.age || null,
      page_age: r.page_age || null,
      language: r.language || null,
      source: r.profile?.name || null
    }))
  }
}
