// HTML fetcher + main-content extractor for /sweep_context (Phase 3 local LLM Context).
// Uses cheerio (lightweight) to strip nav/footer/scripts and pull readable text.
//
// Why this exists: Brave LLM Context endpoint (paid) returns pre-extracted excerpts.
// Local pipeline = fetch raw HTML → extract main-content → feed to Qwen3-600M for fact extraction.

import * as cheerio from 'cheerio'

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (qsearch/1.0; +https://qsearch.pro)'

/**
 * Fetch a URL with timeout + byte cap. Returns { html, status, contentType, finalUrl } or throws.
 * @param {string} url
 * @param {{ timeoutMs?: number, userAgent?: string, maxBytes?: number }} [opts]
 */
export async function fetchHtml (url, opts = {}) {
  const { timeoutMs = 30000, userAgent = DEFAULT_USER_AGENT, maxBytes = 2_000_000 } = opts
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': userAgent, Accept: 'text/html,*/*;q=0.8' },
      redirect: 'follow'
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
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
