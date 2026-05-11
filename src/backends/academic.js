import { SearchBackend } from './interface.js'
import { arxivSearch } from './academic_clients/arxiv.js'
import { pubmedSearch } from './academic_clients/pubmed.js'
import { semanticScholarSearch } from './academic_clients/semanticscholar.js'

// Unified academic backend. Fans out a query to arxiv + PubMed + Semantic Scholar
// in parallel, dedupes by DOI / normalised title, returns the merged result list
// in the standard SearchBackend shape so the priority router can consume it.

function normTitle (s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80)
}

function dedupe (results) {
  const seenDoi = new Set()
  const seenTitle = new Set()
  const out = []
  for (const r of results) {
    const doi = r._doi ? r._doi.toLowerCase() : null
    if (doi && seenDoi.has(doi)) continue
    const tkey = normTitle(r.title)
    if (tkey && seenTitle.has(tkey)) continue
    if (doi) seenDoi.add(doi)
    if (tkey) seenTitle.add(tkey)
    out.push(r)
  }
  return out
}

export class AcademicBackend extends SearchBackend {
  constructor (opts = {}) {
    super()
    this._ncbiKey = opts.ncbiKey || process.env.NCBI_API_KEY || null
    this._s2Key = opts.s2Key || process.env.SEMANTIC_SCHOLAR_API_KEY || null
    // Which sub-engines to query. Default = all. Override via opts.sources.
    this._sources = opts.sources || ['arxiv', 'pubmed', 'semanticscholar']
  }

  get name () { return 'academic' }

  async search (query, opts = {}) {
    const n = opts.n_results || opts.count || 5
    const sources = opts.sources || this._sources
    const perSource = Math.max(2, Math.ceil(n / sources.length) + 1)

    const tasks = []
    if (sources.includes('arxiv')) {
      tasks.push(arxivSearch(query, { n_results: perSource }).catch(e => {
        console.warn(`[academic] arxiv failed: ${e.message}`); return []
      }))
    }
    if (sources.includes('pubmed')) {
      tasks.push(pubmedSearch(query, { n_results: perSource, api_key: this._ncbiKey }).catch(e => {
        console.warn(`[academic] pubmed failed: ${e.message}`); return []
      }))
    }
    if (sources.includes('semanticscholar')) {
      tasks.push(semanticScholarSearch(query, { n_results: perSource, api_key: this._s2Key }).catch(e => {
        console.warn(`[academic] semanticscholar failed: ${e.message}`); return []
      }))
    }

    const settled = await Promise.all(tasks)
    const merged = dedupe(settled.flat())
    // Interleave by source to prevent any single API from dominating top-N.
    const bySource = new Map()
    for (const r of merged) {
      if (!bySource.has(r.source)) bySource.set(r.source, [])
      bySource.get(r.source).push(r)
    }
    const interleaved = []
    let added = true
    while (added && interleaved.length < n) {
      added = false
      for (const arr of bySource.values()) {
        if (arr.length && interleaved.length < n) { interleaved.push(arr.shift()); added = true }
      }
    }
    return interleaved.slice(0, n)
  }
}
