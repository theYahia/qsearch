// PubMed search via NCBI E-utilities (esearch + esummary).
// Endpoints:
//   esearch: returns PMIDs for a query (JSON)
//   esummary: returns metadata (title, authors, journal, date) for PMIDs (JSON)
// Rate: 3 req/s without key; 10 req/s with NCBI_API_KEY.
// We use esummary instead of efetch — summaries lack abstract, but are JSON and fast.
// Abstract is fetched separately only if explicitly requested via _fetchAbstracts.

const ESEARCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'
const ESUMMARY = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi'

async function fetchJson (url, timeout_ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout_ms)
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'qsearch/0.4 (https://github.com/theYahia/qsearch)' },
      signal: ctrl.signal
    })
    if (!r.ok) {
      const e = new Error(`pubmed error ${r.status}`)
      e.status = r.status
      throw e
    }
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function pubmedSearch (query, { n_results = 5, timeout_ms = 15000, api_key = null } = {}) {
  const searchUrl = new URL(ESEARCH)
  searchUrl.searchParams.set('db', 'pubmed')
  searchUrl.searchParams.set('term', query)
  searchUrl.searchParams.set('retmode', 'json')
  searchUrl.searchParams.set('retmax', String(n_results))
  searchUrl.searchParams.set('sort', 'relevance')
  if (api_key) searchUrl.searchParams.set('api_key', api_key)

  const searchRes = await fetchJson(searchUrl.toString(), timeout_ms)
  const ids = searchRes?.esearchresult?.idlist || []
  if (!ids.length) return []

  const summaryUrl = new URL(ESUMMARY)
  summaryUrl.searchParams.set('db', 'pubmed')
  summaryUrl.searchParams.set('id', ids.join(','))
  summaryUrl.searchParams.set('retmode', 'json')
  if (api_key) summaryUrl.searchParams.set('api_key', api_key)

  const summaryRes = await fetchJson(summaryUrl.toString(), timeout_ms)
  const records = summaryRes?.result || {}
  const out = []
  for (const pmid of ids) {
    const r = records[pmid]
    if (!r) continue
    const authors = (r.authors || []).map(a => a.name).filter(Boolean)
    const journal = r.fulljournalname || r.source || ''
    const pubdate = r.pubdate || r.sortpubdate || null
    const doiObj = (r.articleids || []).find(a => a.idtype === 'doi')
    const doi = doiObj?.value || null
    out.push({
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      title: r.title || '',
      description: `${journal}${pubdate ? ` · ${pubdate}` : ''}${authors.length ? ` · ${authors.slice(0, 4).join(', ')}${authors.length > 4 ? ' et al.' : ''}` : ''}`,
      extra_snippets: [],
      age: null,
      page_age: pubdate,
      language: r.lang?.[0] || 'en',
      source: 'pubmed',
      _doi: doi,
      _pmid: pmid
    })
  }
  return out
}
