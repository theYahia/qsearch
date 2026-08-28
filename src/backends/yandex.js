import { SearchBackend } from './interface.js'

// Yandex Cloud Search API (XML) — legacy endpoint, 0 executions ever (WORK-413 дефект №7).
// Endpoint: https://yandex.com/search/xml — GET with folderid + apikey query params.
// Docs: https://yandex.cloud/en/docs/search-api/quickstart
// Free tier: 1000 queries/day after Yandex Cloud account setup.
//
// ponytail: env var name was YANDEX_API_KEY, which no other integration in this repo
// uses — all 8 working Yandex Cloud integrations (Wordstat included) use
// YANDEX_SEARCH_API_KEY against searchapi.api.cloud.yandex.net. Renamed for consistency
// so a key dropped into .env.local following the project convention actually gets picked
// up here too. Did NOT touch the XML request/response shape or switch to the newer
// Search API v2 host — that's a different wire format I haven't verified against real
// responses, and guessing it would be worse than leaving this backend unconfigured.

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

// Yandex returns title/headline/passage wrapped in <hlword> tags to highlight match.
// Strip them for clean text output.
function stripHl (s) { return String(s || '').replace(/<\/?hlword[^>]*>/g, '').trim() }

export class YandexBackend extends SearchBackend {
  constructor (opts = {}) {
    super()
    this._apiKey = opts.apiKey || process.env.YANDEX_SEARCH_API_KEY || null
    this._folderId = opts.folderId || process.env.YANDEX_FOLDER_ID || null
    this._base = opts.base || process.env.YANDEX_BASE_URL || 'https://yandex.com/search/xml'
    if (!this._apiKey || !this._folderId) {
      throw new Error('YandexBackend requires YANDEX_SEARCH_API_KEY and YANDEX_FOLDER_ID')
    }
  }

  get name () { return 'yandex' }

  async search (query, opts = {}) {
    const n = opts.n_results || opts.count || 5
    const url = new URL(this._base)
    url.searchParams.set('folderid', this._folderId)
    url.searchParams.set('apikey', this._apiKey)
    url.searchParams.set('query', query)
    url.searchParams.set('l10n', 'ru')
    url.searchParams.set('sortby', 'rlv')
    // groupby format: attr=d.mode=deep.groups-on-page=N.docs-in-group=1
    url.searchParams.set('groupby', `attr=d.mode=deep.groups-on-page=${Math.min(n, 50)}.docs-in-group=1`)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeout_ms || 15000)
    let xml
    try {
      const r = await fetch(url.toString(), {
        headers: { Accept: 'application/xml', 'User-Agent': 'qsearch/0.4 (https://github.com/theYahia/qsearch)' },
        signal: ctrl.signal
      })
      if (!r.ok) {
        const body = await r.text().catch(() => '')
        const e = new Error(`yandex ${r.status}`)
        e.status = r.status
        e.detail = body.slice(0, 300)
        throw e
      }
      xml = await r.text()
    } finally {
      clearTimeout(timer)
    }

    // Top-level <error> response when apikey/folderid is invalid.
    const err = extractTag(xml, 'error')
    if (err) {
      const e = new Error(`yandex API error: ${err.slice(0, 200)}`)
      e.status = 502
      throw e
    }

    const docs = extractAllTags(xml, 'doc')
    return docs.slice(0, n).map(doc => {
      const url = extractTag(doc, 'url')
      const title = stripHl(extractTag(doc, 'title') || '')
      const headline = stripHl(extractTag(doc, 'headline') || '')
      const passages = extractAllTags(doc, 'passage').map(stripHl).filter(Boolean)
      const modtime = extractTag(doc, 'modtime')
      return {
        url,
        title,
        description: headline || passages[0] || null,
        extra_snippets: passages.slice(0, 3),
        age: null,
        page_age: modtime || null,
        language: 'ru',
        source: 'yandex'
      }
    }).filter(r => r.url)
  }
}
