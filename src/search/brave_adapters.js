// Brave-response adapter family — extracted from server.js.
//
// These adapters normalize each backend (SearXNG, corpus/Meilisearch, Academic,
// Yandex, Brave-with-fallback) into a Brave-shaped response so runSweep's
// fetchAndDedupe and the /search|/news|/context handlers can consume one shape.
//
// They DO touch backend instances, so rather than capturing module-level closures
// they are built by a factory that binds an explicit deps object once at startup.
// Behavior is identical to the previous in-server closures.
//
// deps: { searxng, academic, yandex, meili, braveKey, braveFetch }

export function createBraveAdapters (deps) {
  const { searxng, academic, yandex, meili, braveKey, braveFetch } = deps

  async function searxngAsBraveResponse (query, params, opts = {}) {
    const t0 = Date.now()
    const searchOpts = { n_results: params.count || 3 }
    if (opts.language) searchOpts.language = opts.language
    if (opts.engines) searchOpts.engines = opts.engines
    const hits = await searxng.search(query, searchOpts)
    return { data: { web: { results: hits }, _searxng: true }, ms: Date.now() - t0, searxng: true }
  }

  // rd239 ultra-broad: corpus-only lookup. Returns { sufficient, response } where the
  // response is Brave-shaped. On insufficient corpus coverage the router falls through
  // to the broad tier. Thresholds tunable via QSEARCH_ULTRA_BROAD_* env vars.
  async function corpusLookupAsBrave (query, params) {
    const t0 = Date.now()
    const r = await meili.corpusLookup(query, {
      minScore: Number(process.env.QSEARCH_ULTRA_BROAD_MIN_SCORE) || 0.55,
      maxAgeDays: Number(process.env.QSEARCH_ULTRA_BROAD_MAX_AGE_DAYS) || 30,
      minTrust: Number(process.env.QSEARCH_ULTRA_BROAD_MIN_TRUST) || 0,
      limit: params.count || 5
    })
    // Pass the diagnostics through on the fall-through path too. corpusLookup already computes
    // max_trust, the per-hit scores and whether the freshness filter applied; dropping them here
    // left "why did this query miss the corpus?" answerable only by querying Meilisearch around
    // this module. `sufficient` gates on the MEAN score, so the spread is the interesting part.
    if (!r.sufficient) {
      return {
        sufficient: false,
        count: r.count,
        avgScore: r.avgScore,
        max_trust: r.max_trust,
        scores: r.scores,
        freshness_filtered: r.freshness_filtered
      }
    }
    return {
      sufficient: true,
      response: {
        data: {
          web: { results: r.hits },
          _corpus: true,
          _ultra_broad: {
            count: r.count,
            avg_score: Number(r.avgScore.toFixed(3)),
            max_trust: r.max_trust,
            scores: r.scores,
            freshness_filtered: r.freshness_filtered
          }
        },
        ms: Date.now() - t0,
        corpus: true
      }
    }
  }

  async function academicAsBraveResponse (query, params) {
    const t0 = Date.now()
    const hits = await academic.search(query, { n_results: params.count || 5 })
    return { data: { web: { results: hits }, _academic: true }, ms: Date.now() - t0, academic: true }
  }

  async function yandexAsBraveResponse (query, params) {
    const t0 = Date.now()
    const hits = await yandex.search(query, { n_results: params.count || 10 })
    return { data: { web: { results: hits }, _yandex: true }, ms: Date.now() - t0, yandex: true }
  }

  async function routedBraveFetch (endpoint, query, params) {
    // No Brave key → SearXNG primary
    if (!braveKey) {
      if (!searxng) throw new Error('Neither BRAVE_API_KEY nor SEARXNG_URL configured')
      if (endpoint !== 'web') {
        // SearXNG only supports web search; news/context not available
        const e = new Error(`Endpoint ${endpoint} requires Brave API key (SearXNG supports web search only)`)
        e.status = 501
        throw e
      }
      return await searxngAsBraveResponse(query, params)
    }
    try {
      return await braveFetch(endpoint, query, params)
    } catch (err) {
      // Fallback to SearXNG on Brave 5xx/429 (web search only)
      if (searxng && endpoint === 'web' && (err.status >= 500 || err.status === 429)) {
        console.warn(`Brave ${err.status} — falling back to SearXNG`)
        return await searxngAsBraveResponse(query, params)
      }
      throw err
    }
  }

  return {
    searxngAsBraveResponse,
    corpusLookupAsBrave,
    academicAsBraveResponse,
    yandexAsBraveResponse,
    routedBraveFetch
  }
}
