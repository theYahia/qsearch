// /sweep_context — local LLM Context endpoint (analogue of Brave LLM Context).
// Pipeline per URL: fetchHtml → extractMainContent → cleanContext (Qwen3-600M).
// Returns Brave-context-compatible shape so brave_sweep.py can swap backends.
//
// Cost: $0 (GPU only). Quality lower than Brave-internal but enough for Phase 4 grounding.

import { fetchHtml, extractMainContent } from './fetch/html.js'
import { cleanContext } from './clean/ollama.js'

const SEM_DEFAULT = 4  // local LLM is bottleneck — fewer concurrent than network sweep

class Sem {
  constructor (max) { this.max = max; this.cur = 0; this.q = [] }
  run (fn) {
    return new Promise((resolve, reject) => {
      const enter = async () => {
        this.cur++
        try { resolve(await fn()) } catch (e) { reject(e) } finally {
          this.cur--
          if (this.q.length) this.q.shift()()
        }
      }
      this.cur < this.max ? enter() : this.q.push(enter)
    })
  }
}

/**
 * @param {Object} args
 * @param {string[]} args.urls               URLs to fetch + extract
 * @param {string} args.focus_query          Used in cleanContext prompt for relevance
 * @param {number} [args.max_chars_per_url]  Truncate html-extracted text (default 50000)
 * @param {number} [args.snippets_per_url]   Snippets per URL fed to LLM (default 5)
 * @param {number} [args.timeout_ms]         Per-URL fetch timeout (default 30000)
 * @param {Object} [args.cacheClient]        Optional cache: { get(url, query)→{title,text,paragraphs}|null, set(url,query,payload) }
 */
export async function runSweepContext (args) {
  const {
    urls, focus_query,
    max_chars_per_url = 50000,
    snippets_per_url = 5,
    timeout_ms = 30000,
    cacheClient = null
  } = args
  if (!Array.isArray(urls) || !urls.length) throw new Error('urls[] required')
  if (!focus_query) throw new Error('focus_query required')

  const sem = new Sem(SEM_DEFAULT)
  let totalFetchMs = 0
  let totalCleanMs = 0
  let cacheHits = 0
  let cacheMisses = 0

  const results = await Promise.all(urls.map(url => sem.run(async () => {
    const tFetch0 = Date.now()
    let title = '', paragraphs = []

    let cached = null
    if (cacheClient) {
      try { cached = await cacheClient.get(url, focus_query) } catch { /* ignore */ }
    }

    if (cached) {
      cacheHits++
      title = cached.title || ''
      paragraphs = cached.paragraphs || []
    } else {
      cacheMisses++
      try {
        const { html } = await fetchHtml(url, { timeoutMs: timeout_ms })
        const ex = extractMainContent(html)
        title = ex.title
        // Truncate paragraphs to fit max_chars (approximate — sum lengths)
        let charsUsed = 0
        const limited = []
        for (const p of ex.paragraphs) {
          if (charsUsed + p.length > max_chars_per_url) break
          limited.push(p)
          charsUsed += p.length
        }
        paragraphs = limited
        if (cacheClient) {
          try { await cacheClient.set(url, focus_query, { title, paragraphs }) } catch { /* ignore */ }
        }
      } catch (err) {
        return { url, error: err.message, source: 'qsearch_local' }
      }
    }
    totalFetchMs += (Date.now() - tFetch0)

    // LLM extraction via existing cleanContext (qvac/qwen3-600m).
    // cleanContext signature: ({url, title, snippets[]}) → {cleanSnippets[], allSnippets, cleaned_markdown}
    const tClean0 = Date.now()
    let cleanOut = { cleanSnippets: [], cleaned_markdown: '' }
    try {
      cleanOut = await cleanContext({ url, title, snippets: paragraphs.slice(0, snippets_per_url) })
    } catch (err) {
      // Graceful: return raw paragraphs if LLM unavailable / timed out
      const fallback = paragraphs.slice(0, snippets_per_url)
      cleanOut = {
        cleanSnippets: fallback,
        cleaned_markdown: fallback.join('\n\n')
      }
    }
    totalCleanMs += (Date.now() - tClean0)

    return {
      url,
      title,
      snippet_count: cleanOut.cleanSnippets.length,
      snippets: cleanOut.cleanSnippets,
      cleaned_markdown: cleanOut.cleaned_markdown,
      source: 'qsearch_local'
    }
  })))

  return {
    query: focus_query,
    type: 'context',
    source: 'qsearch_local',
    results,
    total_fetch_ms: totalFetchMs,
    total_clean_ms: totalCleanMs,
    cache_hits: cacheHits,
    cache_misses: cacheMisses
  }
}
