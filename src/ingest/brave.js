import { readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { sanitizeText, canonicalizeUrl } from '../clean/sanitize.js'
import { snippetToText } from '../clean/structured.js'

/**
 * Read <label>__context.json next to <label>.json and return its grounding passages
 * keyed by canonical URL.
 *
 * These files were skipped outright until 2026-08-04 (`if (label.includes('__')) continue`),
 * so every LLM Context passage brave_sweep.py ever paid for — 8601 calls, ~$43 — stayed on
 * disk and never reached the corpus. They hold ~1077 chars per passage against 261 for a
 * web snippet: the deepest text available anywhere in the stack.
 */
function readContextPassages (braveDir, label) {
  const byUrl = new Map()
  let payload
  try {
    payload = JSON.parse(readFileSync(join(braveDir, `${label}__context.json`), 'utf8'))
  } catch {
    return byUrl // absent for non-critical queries — normal, not an error
  }
  for (const g of (payload?.grounding?.generic || [])) {
    if (!g?.url) continue
    const text = (g.snippets || []).filter(Boolean).map(snippetToText).join('\n').trim()
    if (!text) continue
    byUrl.set(canonicalizeUrl(g.url), { title: g.title || '', text })
  }
  return byUrl
}

/**
 * Ingest brave_sweep.py output directory into corpus.
 * Reads all <label>.json files (raw Brave API responses) from brave_dir, and folds in the
 * matching <label>__context.json grounding where it exists.
 *
 * @param {string} braveDir  - absolute path to brave/ output directory
 * @param {string} topic     - sweep topic label (used as sweep_label prefix)
 * @param {object} corpus    - MeilisearchCorpus instance
 * @returns {Promise<number>} - count of indexed documents
 */
export async function ingestBraveDir (braveDir, topic, corpus) {
  let files
  try {
    files = readdirSync(braveDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  } catch (e) {
    throw new Error(`Cannot read brave_dir: ${braveDir} — ${e.message}`)
  }

  let indexed = 0
  for (const file of files) {
    const label = basename(file, '.json')
    // Still skip the sibling endpoint payloads as entry points — __context.json is read
    // through its web file below, and __news.json has no consumer here.
    if (label.includes('__')) continue

    let payload
    try {
      payload = JSON.parse(readFileSync(join(braveDir, file), 'utf8'))
    } catch {
      continue
    }

    const ctxByUrl = readContextPassages(braveDir, label)
    const crawledAt = new Date().toISOString()

    const results = payload?.web?.results || []
    for (const r of results) {
      if (!r.url) continue
      try {
        const cleanUrl = canonicalizeUrl(r.url)
        const ctx = ctxByUrl.get(cleanUrl)
        if (ctx) ctxByUrl.delete(cleanUrl)
        const doc = {
          url: cleanUrl,
          title: sanitizeText(r.title || ''),
          description: sanitizeText(r.description || ''),
          // Appended, not substituted: corpus.index() spreads the new doc over the stored
          // one, so a context-only `text` would overwrite the web snippets for this URL.
          text: sanitizeText([r.title, r.description, ...(r.extra_snippets || []), ctx?.text]
            .filter(Boolean).join('\n')),
          namespace: 'sweep',
          sweep_label: label,
          engines: ['brave'],
          engine_count: 1,
          backend_source: 'brave',
          has_context: Boolean(ctx),
          crawled_at: crawledAt
        }
        await corpus.index(doc)
        indexed++
      } catch (e) {
        console.error(`[ingest/brave] ${r.url}: ${e.message}`)
      }
    }

    // Sources context found that the web results did not.
    for (const [url, ctx] of ctxByUrl) {
      try {
        await corpus.index({
          url,
          title: sanitizeText(ctx.title),
          description: '',
          text: sanitizeText([ctx.title, ctx.text].filter(Boolean).join('\n')),
          namespace: 'sweep',
          sweep_label: label,
          engines: ['brave'],
          engine_count: 1,
          backend_source: 'brave_context',
          has_context: true,
          crawled_at: crawledAt
        })
        indexed++
      } catch (e) {
        console.error(`[ingest/brave] context ${url}: ${e.message}`)
      }
    }
  }

  return indexed
}
