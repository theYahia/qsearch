import { readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { sanitizeText, canonicalizeUrl } from '../clean/sanitize.js'

/**
 * Ingest brave_sweep.py output directory into corpus.
 * Reads all <label>.json files (raw Brave API responses) from brave_dir.
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
    // Skip non-web endpoints: <label>__news.json, <label>__context.json, etc.
    if (label.includes('__')) continue

    let payload
    try {
      payload = JSON.parse(readFileSync(join(braveDir, file), 'utf8'))
    } catch {
      continue
    }

    const results = payload?.web?.results || []
    for (const r of results) {
      if (!r.url) continue
      try {
        const cleanUrl = canonicalizeUrl(r.url)
        const doc = {
          url: cleanUrl,
          title: sanitizeText(r.title || ''),
          description: sanitizeText(r.description || ''),
          text: sanitizeText([r.title, r.description, ...(r.extra_snippets || [])].filter(Boolean).join('\n')),
          namespace: 'sweep',
          sweep_label: label,
          engines: ['brave'],
          engine_count: 1,
          backend_source: 'brave',
          crawled_at: new Date().toISOString()
        }
        await corpus.index(doc)
        indexed++
      } catch (e) {
        console.error(`[ingest/brave] ${r.url}: ${e.message}`)
      }
    }
  }

  return indexed
}
