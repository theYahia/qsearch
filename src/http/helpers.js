// HTTP helpers — pure, stateless request/response utilities extracted from server.js.
// None of these capture module-level server state; they take args and return values.
// Keeping them here makes them unit-testable in isolation and shrinks the god-module.

// Request body size cap (OOM DoS guard). Mirrors server.js: Content-Length fast-path
// lives in the dispatcher; this streaming cap protects chunked / lying-length requests.
// Default resolves the same env var the server uses, so behavior is identical whether
// the caller passes maxBytes explicitly or relies on the default.
export const MAX_BODY_BYTES = Number(process.env.QSEARCH_MAX_BODY_BYTES) || 10 * 1024 * 1024

export function readBody (req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > maxBytes) {
        const e = new Error(`request body exceeds ${maxBytes} bytes`)
        e.status = 413
        req.destroy(e)
        reject(e)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function parseSearchParams (req) {
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`)
    return {
      query: (url.searchParams.get('q') || '').trim(),
      n_results: url.searchParams.get('n') || url.searchParams.get('n_results'),
      freshness: url.searchParams.get('freshness'),
      search_lang: url.searchParams.get('search_lang'),
      country: url.searchParams.get('country'),
      safesearch: url.searchParams.get('safesearch')
    }
  }
  return null
}

export function dedupeByUrl (items) {
  const seen = new Set()
  return items.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true })
}

// Endpoints reachable without auth (load-balancer health, homepage).
export function isPublicPath (req) {
  if (req.method !== 'GET') return false
  return req.url === '/' || req.url === '/index.html' || req.url === '/health' || req.url.startsWith('/health?')
}

// Normalize req.url to a bare route key for rate-limit bucketing.
export function routeKey (url) {
  const i = url.indexOf('?')
  return i === -1 ? url : url.slice(0, i)
}

// Parse per-endpoint TTL query params (?ttl_web=7&ttl_news=1&ttl_context=30).
// Returns null if no ttl_* params present (caller falls back to legacy max_age).
export function parseTtlMap (searchParams) {
  const map = {}
  let any = false
  for (const ep of ['web', 'news', 'context']) {
    const v = Number(searchParams.get(`ttl_${ep}`))
    if (Number.isFinite(v) && v > 0) { map[ep] = v; any = true }
  }
  const def = Number(searchParams.get('ttl_default'))
  if (Number.isFinite(def) && def > 0) { map.default = def; any = true }
  return any ? map : null
}

// Render the Layer 8 quality-gate "Rejected" markdown section from a sweep results map.
export function renderRejectedSection (resultsMap) {
  const lines = ['## Rejected (Layer 8 quality gate)']
  let anyRejected = false
  for (const [label, entry] of resultsMap) {
    if (!entry?._rejected?.length) continue
    anyRejected = true
    lines.push('', `### ${label}`)
    for (const r of entry._rejected) {
      const parts = r._quality_parts || {}
      const partsStr = Object.entries(parts).map(([k, v]) => `${k}=${Number(v).toFixed(3)}`).join(' ')
      lines.push(`- composite=${r._quality_composite} ${partsStr} — ${r.url || r.title || '(no url)'}`)
    }
  }
  if (!anyRejected) lines.push('', '_No rejections — quality gate either disabled or kept every result._')
  return lines.join('\n')
}
