// HTML fetcher + main-content extractor for /sweep_context (Phase 3 local LLM Context).
// Uses cheerio (lightweight) to strip nav/footer/scripts and pull readable text.
//
// Why this exists: Brave LLM Context endpoint (paid) returns pre-extracted excerpts.
// Local pipeline = fetch raw HTML → extract main-content → feed to Qwen3-600M for fact extraction.

import * as cheerio from 'cheerio'
import dns from 'node:dns/promises'
import net from 'node:net'

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (qsearch/1.0; +https://qsearch.pro)'

// ── SSRF guard (CSO-OPS 2026-05-21 P1-1) ───────────────────────────
// /sweep_context fetches caller-supplied URLs. Without this, a LAN/remote caller
// could relay to localhost services (Meilisearch :7700, Qdrant :6333) or cloud
// metadata (169.254.169.254). We resolve every host and reject private ranges,
// and re-validate on every redirect hop (TOCTOU-safe).
function ipIsBlocked (ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 127 || a === 10 || a === 0) return true        // loopback, 10/8, 0/8
    if (a === 172 && b >= 16 && b <= 31) return true          // 172.16/12
    if (a === 192 && b === 168) return true                   // 192.168/16
    if (a === 169 && b === 254) return true                   // link-local 169.254/16
    if (a === 100 && b >= 64 && b <= 127) return true         // CGNAT 100.64/10
    if (a >= 224) return true                                 // multicast + reserved
    return false
  }
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true           // loopback / unspecified
  if (lower.startsWith('fe80')) return true                    // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA fc00::/7
  if (lower.startsWith('::ffff:')) return ipIsBlocked(lower.slice(7)) // IPv4-mapped
  return false
}

export async function assertPublicHost (url) {
  let parsed
  try { parsed = new URL(url) } catch { throw new Error(`SSRF blocked: invalid URL ${url}`) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SSRF blocked: scheme ${parsed.protocol} not allowed`)
  }
  const host = parsed.hostname
  if (net.isIP(host)) {
    if (ipIsBlocked(host)) throw new Error(`SSRF blocked: ${host} is a private/loopback address`)
    return
  }
  let records
  try { records = await dns.lookup(host, { all: true }) } catch {
    throw new Error(`SSRF blocked: DNS lookup failed for ${host}`)
  }
  for (const { address } of records) {
    if (ipIsBlocked(address)) throw new Error(`SSRF blocked: ${host} → ${address} (private/loopback)`)
  }
}

/**
 * Fetch a URL with timeout + byte cap. Returns { html, status, contentType, finalUrl } or throws.
 * @param {string} url
 * @param {{ timeoutMs?: number, userAgent?: string, maxBytes?: number }} [opts]
 */
export async function fetchHtml (url, opts = {}) {
  const { timeoutMs = 30000, userAgent = DEFAULT_USER_AGENT, maxBytes = 2_000_000, maxRedirects = 5 } = opts
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // Manual redirect loop: validate the host before EVERY hop so a redirect to an
    // internal address (SSRF) is caught even if the first hop was public.
    let currentUrl = url
    let res
    for (let hop = 0; ; hop++) {
      await assertPublicHost(currentUrl)
      res = await fetch(currentUrl, {
        signal: ctrl.signal,
        headers: { 'User-Agent': userAgent, Accept: 'text/html,*/*;q=0.8' },
        redirect: 'manual'
      })
      if (![301, 302, 303, 307, 308].includes(res.status)) break
      const loc = res.headers.get('location')
      if (!loc) break
      if (hop >= maxRedirects) throw new Error(`Too many redirects (${maxRedirects}) for ${url}`)
      currentUrl = new URL(loc, currentUrl).toString()
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${currentUrl}`)
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('html') && !ct.includes('text')) {
      throw new Error(`Non-HTML content-type: ${ct}`)
    }
    // Read with byte cap to avoid OOM on huge pages
    const reader = res.body.getReader()
    const chunks = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        ctrl.abort()
        throw new Error(`Page exceeds maxBytes ${maxBytes}`)
      }
      chunks.push(value)
    }
    const html = Buffer.concat(chunks).toString('utf-8')
    return { html, status: res.status, contentType: ct, finalUrl: res.url }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Extract title + main readable content from HTML.
 * Strips nav/footer/scripts/styles/cookie-banners; prefers <article>/<main>/role=main when present.
 * Returns { title, text, paragraphs[] } where paragraphs are de-newlined chunks ≥ minParaChars.
 *
 * @param {string} html
 * @param {{ minParaChars?: number, maxParas?: number }} [opts]
 */
export function extractMainContent (html, opts = {}) {
  const { minParaChars = 40, maxParas = 200 } = opts
  const $ = cheerio.load(html)
  // strip noise
  $('script,style,nav,footer,header,aside,form,iframe,noscript').remove()
  $('[class*="cookie"],[class*="banner"],[class*="popup"],[id*="cookie"]').remove()

  const title = ($('title').first().text() || $('h1').first().text() || '').trim().slice(0, 280)

  // Prefer <article> / <main> / role=main if present
  const main = $('article, main, [role="main"]').first()
  const root = main.length ? main : $('body')

  const paragraphs = []
  root.find('p,h2,h3,h4,li,blockquote').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim()
    if (t.length >= minParaChars) paragraphs.push(t)
    if (paragraphs.length >= maxParas) return false  // break iteration
  })

  // Fallback: if no structured paragraphs found, use raw root text
  if (paragraphs.length === 0) {
    const t = root.text().replace(/\s+/g, ' ').trim().slice(0, 5000)
    if (t.length >= minParaChars) paragraphs.push(t)
  }

  return { title, text: paragraphs.join('\n\n'), paragraphs }
}
