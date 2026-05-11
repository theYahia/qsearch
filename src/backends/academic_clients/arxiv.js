// arxiv.org search via the public Atom API.
// Endpoint: http://export.arxiv.org/api/query (no auth required).
// Rate guidance: ≤1 req/3s. We rely on the caller's semaphore for global pacing.

function decodeXmlEntities (s) {
  if (!s) return ''
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
}

function extractTag (xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return m ? decodeXmlEntities(m[1].trim()) : null
}

function extractAllTags (xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g')
  const out = []
  let m
  while ((m = re.exec(xml)) !== null) out.push(decodeXmlEntities(m[1].trim()))
  return out
}

function extractAttr (xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`))
  return m ? m[1] : null
}

export async function arxivSearch (query, { n_results = 5, timeout_ms = 15000 } = {}) {
  const url = new URL('https://export.arxiv.org/api/query')
  url.searchParams.set('search_query', `all:${query}`)
  url.searchParams.set('start', '0')
  url.searchParams.set('max_results', String(n_results))
  url.searchParams.set('sortBy', 'relevance')
  url.searchParams.set('sortOrder', 'descending')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout_ms)
  let xml
  try {
    const r = await fetch(url.toString(), {
      headers: { Accept: 'application/atom+xml', 'User-Agent': 'qsearch/0.4 (https://github.com/theYahia/qsearch)' },
      signal: ctrl.signal
    })
    if (!r.ok) {
      const e = new Error(`arxiv error ${r.status}`)
      e.status = r.status
      throw e
    }
    xml = await r.text()
  } finally {
    clearTimeout(timer)
  }

  const entries = extractAllTags(xml, 'entry')
  return entries.map(entry => {
    const id = extractTag(entry, 'id') || ''
    const title = (extractTag(entry, 'title') || '').replace(/\s+/g, ' ').trim()
    const summary = (extractTag(entry, 'summary') || '').replace(/\s+/g, ' ').trim()
    const published = extractTag(entry, 'published')
    const updated = extractTag(entry, 'updated')
    const authorNames = extractAllTags(entry, 'name')
    const primaryCategory = extractAttr(entry, 'arxiv:primary_category', 'term') ||
      extractAttr(entry, 'category', 'term')
    return {
      url: id,
      title,
      description: summary.slice(0, 1500),
      extra_snippets: authorNames.length ? [`Authors: ${authorNames.slice(0, 6).join(', ')}`] : [],
      age: null,
      page_age: published || updated || null,
      language: 'en',
      source: 'arxiv',
      _doi: null,
      _category: primaryCategory || null
    }
  })
}
