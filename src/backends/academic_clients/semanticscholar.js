// Semantic Scholar Graph API — paper search.
// Endpoint: https://api.semanticscholar.org/graph/v1/paper/search
// Rate: ~100 req/5min without key; higher with SEMANTIC_SCHOLAR_API_KEY.
// Returns title, abstract, year, venue, citationCount, externalIds (DOI), authors.

const S2_BASE = 'https://api.semanticscholar.org/graph/v1/paper/search'
const FIELDS = 'paperId,title,abstract,year,venue,citationCount,externalIds,authors.name,publicationDate,openAccessPdf,url'

export async function semanticScholarSearch (query, { n_results = 5, timeout_ms = 15000, api_key = null } = {}) {
  const url = new URL(S2_BASE)
  url.searchParams.set('query', query)
  url.searchParams.set('limit', String(Math.min(n_results, 20)))
  url.searchParams.set('fields', FIELDS)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout_ms)
  const headers = { Accept: 'application/json', 'User-Agent': 'qsearch/0.4 (https://github.com/theYahia/qsearch)' }
  if (api_key) headers['x-api-key'] = api_key

  let json
  try {
    const r = await fetch(url.toString(), { headers, signal: ctrl.signal })
    if (!r.ok) {
      const e = new Error(`semanticscholar error ${r.status}`)
      e.status = r.status
      throw e
    }
    json = await r.json()
  } finally {
    clearTimeout(timer)
  }

  const papers = json?.data || []
  return papers.map(p => {
    const authors = (p.authors || []).map(a => a.name).filter(Boolean)
    const doi = p.externalIds?.DOI || null
    const arxivId = p.externalIds?.ArXiv || null
    const link = p.openAccessPdf?.url || p.url || `https://www.semanticscholar.org/paper/${p.paperId}`
    const tail = []
    if (p.venue) tail.push(p.venue)
    if (p.year) tail.push(String(p.year))
    if (typeof p.citationCount === 'number') tail.push(`${p.citationCount} citations`)
    return {
      url: link,
      title: p.title || '',
      description: (p.abstract || tail.join(' · ')).slice(0, 1500),
      extra_snippets: authors.length ? [`Authors: ${authors.slice(0, 6).join(', ')}`] : [],
      age: null,
      page_age: p.publicationDate || (p.year ? String(p.year) : null),
      language: 'en',
      source: 'semanticscholar',
      _doi: doi,
      _arxiv: arxivId,
      _citations: typeof p.citationCount === 'number' ? p.citationCount : null
    }
  })
}
