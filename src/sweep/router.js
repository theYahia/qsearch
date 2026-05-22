// rd275: shared priority+domain router for /sweep and /cached_sweep.
//
// Before extraction both handlers carried byte-identical bodies (server.js:796
// and server.js:1085) except for the error-message prefix. rd273 invariants
// required keeping them in sync by hand — see Cards/rd273.md §57. This factory
// removes that footgun: any future routing tweak (new backend, new domain,
// new priority tier) edits one function and both endpoints inherit it.
//
// Helpers (searxngAsBraveResponse, academicAsBraveResponse, yandexAsBraveResponse,
// braveFetch) stay in their original modules — they touch module-scoped backend
// instances, and lifting them out would balloon scope. They're injected here as
// callbacks so the router stays pure and unit-testable with mock backends.

export function createSweepRouter (deps) {
  const {
    searxng,
    academic,
    yandex,
    braveKey,
    braveFetch,
    searxngAsBraveResponse,
    academicAsBraveResponse,
    yandexAsBraveResponse,
    corpusLookup,
    endpointName = '/sweep'
  } = deps

  return (priority, domain) => async (endpoint, query, params) => {
    if (endpoint !== 'web') throw new Error(`${endpointName} only supports web endpoint (got ${endpoint})`)
    // Phase A: scholarly domain → academic backend (free, peer-reviewed). Overrides priority.
    if (domain === 'scholarly' && academic) return await academicAsBraveResponse(query, params)
    // Phase C: ru domain → direct Yandex backend if configured; else SearXNG with
    // language=ru-RU. Google/DDG return RU sites when biased.
    if (domain === 'ru' && yandex) {
      try { return await yandexAsBraveResponse(query, params) }
      catch (e) { console.warn(`[yandex] failed, falling back to SearXNG ru-RU: ${e.message}`) }
    }
    const searxngOpts = domain === 'ru' ? { language: 'ru-RU' } : {}
    // rd239 ultra-broad: try the local corpus first ($0, no network). On insufficient
    // coverage fall through to broad — never fail the query for a cache miss.
    if (priority === 'ultra-broad' && corpusLookup) {
      const r = await corpusLookup(query, params)
      if (r && r.sufficient) return r.response
    }
    if (priority === 'broad' || priority === 'ultra-broad') {
      if (searxng) return await searxngAsBraveResponse(query, params, searxngOpts)
      if (braveKey) return await braveFetch('web', query, params)
      throw new Error('broad priority needs SEARXNG_URL or BRAVE_API_KEY')
    }
    // focused / critical — prefer Brave with extra_snippets, SearXNG fallback only on missing key.
    if (braveKey) return await braveFetch('web', query, { ...params, extra_snippets: true })
    if (searxng) return await searxngAsBraveResponse(query, params, searxngOpts)
    throw new Error(`${priority} priority needs BRAVE_API_KEY (or SEARXNG_URL fallback)`)
  }
}
