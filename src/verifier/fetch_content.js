// qsearch verifier — content fetcher with fallback chain (closes the Error gap).
//   PDF (.pdf / Non-HTML)  → pdfjs-dist text extraction (born-digital legal PDFs)
//   HTML                   → fetchHtml + extractMainContent (qsearch)
//   403 / timeout / 5xx    → Crawl4AI headless render (qsearch src/crawl) — real browser, dodges bot-blocks
//   404 / dead domain      → fabricated (cite points nowhere)
//
// Returns: { paragraphs: string[] }  OR  { fabricated: true, error }  OR  { error }  (→ Error, excluded)
// Reuses public, battle-tested repos only (pdfjs = Mozilla/Firefox engine; Crawl4AI = Playwright-based).
// Sibling of index.js — this is the canonical home; doesitlie/bench/fetch_content.js re-exports it.

import { fetchHtml, extractMainContent } from '../fetch/html.js'
import { crawl } from '../crawl/crawl4ai.js'
import { mirrorsFor } from './mirrors.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Nav / boilerplate filter — keep prose, drop menus, link-lists, JS-app shells.
// Without this, headless pages (e.g. statutes.capitol.texas) yield nav text → false "Unsupported".
const NAV_RE = /^(\^|\[\d+\]\s|skip to|menu\b|navigation|search(?: options| icon)?|sign ?in|log ?in|subscribe|cookie|home page|select (?:statute|code|article)|©|all rights reserved|share to |advanced legislation|find your senator|get status alerts|aye nay|do you support this bill)/i
function isRefNoise (s) { return /Archived/.test(s) && /Wayback Machine/.test(s) } // Wikipedia references blocks
function stripMd (s) { return s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ').replace(/[*_`>#|]/g, ' ') }
function textToParagraphs (text, minChars = 40, maxParas = 250) {
  // Minimal, safe cleanup: strip markdown/link noise + drop lines that START with a nav keyword.
  // (The aggressive sentence/function-word filter over-pruned real legal prose — reverted.
  //  Residual excerpt imperfection is disclosed via the gold-agreement number, not hidden.)
  return String(text || '')
    .split(/\n{2,}|(?<=[.!?])\s{2,}/)
    .map(s => stripMd(s).replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= minChars && !NAV_RE.test(s) && !isRefNoise(s))
    .slice(0, maxParas)
}

async function fetchPdfParagraphs (url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true, isEvalSupported: false }).promise
  let text = ''
  const maxPages = Math.min(doc.numPages, 40)
  for (let i = 1; i <= maxPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent()
    text += tc.items.map(it => it.str).join(' ') + '\n\n'
  }
  return textToParagraphs(text)
}

async function crawlParagraphs (url) {
  const { pages, error } = await crawl(url, { depth: 0 })
  if (!pages || !pages.length) throw new Error(error || 'crawl returned no pages')
  let page = pages.find(p => p.url === url)
  if (!page) { try { const path = new URL(url).pathname; page = pages.find(p => { try { return new URL(p.url).pathname === path } catch { return false } }) } catch { /* */ } }
  page = page || pages[0]
  return textToParagraphs(page.text || '')
}

function isDead (msg) {
  return /HTTP 404|HTTP 410/i.test(msg) || /DNS lookup failed|invalid URL/i.test(msg) || /SSRF blocked.*(private|loopback)/i.test(msg)
}

const MIN_USABLE = 200

/**
 * Fetch a citation's source text.
 * Direct read first; if the publisher blocks robots (Justia/Cloudflare, uscode.house.gov) or serves
 * nothing readable, re-read THE SAME document from a canonical public mirror and report where via
 * `via` — the receipt shows the swap. Dead links are never mirrored: a 404 stays Fabricated.
 */
export async function fetchContent (url) {
  const direct = await fetchDirect(url)
  if (direct.fabricated) return direct
  if ((direct.paragraphs || []).join(' ').length >= MIN_USABLE) return direct

  for (const m of mirrorsFor(url)) {
    const alt = await fetchDirect(m.url)
    if ((alt.paragraphs || []).join(' ').length >= MIN_USABLE) {
      return { paragraphs: alt.paragraphs, via: { ...m, blocked: direct.error || 'no extractable content' } }
    }
  }
  return direct
}

async function fetchDirect (url) {
  // PDF by extension → pdfjs.
  if (/\.pdf(\?|#|$)/i.test(url)) {
    try { return { paragraphs: await fetchPdfParagraphs(url) } }
    catch (e) { const m = String(e.message || e); return isDead(m) ? { fabricated: true, error: m } : { error: `pdf: ${m}` } }
  }

  // HTML.
  let html
  try {
    ({ html } = await fetchHtml(url, { userAgent: UA, timeoutMs: 25000 }))
  } catch (e) {
    const m = String(e.message || e)
    if (isDead(m)) return { fabricated: true, error: m }
    // Server says non-HTML (often a PDF served without .pdf in the path) → try pdfjs.
    if (/Non-HTML/i.test(m)) {
      try { return { paragraphs: await fetchPdfParagraphs(url) } } catch { /* fall through to crawl */ }
    }
    // 403 bot-block / timeout / 5xx → headless render.
    try { return { paragraphs: await crawlParagraphs(url) } }
    catch (ce) { return { error: `${m} | crawl: ${String(ce.message || ce).slice(0, 70)}` } }
  }

  let paragraphs = []
  try { ({ paragraphs } = extractMainContent(html)) } catch (e) { return { error: `extract failed: ${e.message}` } }
  // HTML fetched but yielded no readable body (JS-app shell, e.g. leginfo/capitol) → headless retry.
  if (paragraphs.join(' ').length < 200) {
    try { const p = await crawlParagraphs(url); if (p.join(' ').length >= 200) return { paragraphs: p } } catch { /* keep what we had */ }
  }
  return { paragraphs }
}
