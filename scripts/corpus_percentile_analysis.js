// Trust-score percentile calibration (Tier 4, 2026-06-23).
//
// The quality gate normalizes trust by saturating at a fixed 2.0 — arbitrary. This
// utility reads the live corpus, computes the trust_score distribution, and recommends
// QSEARCH_QUALITY_TRUST_SATURATION (= p90) so the trust signal isn't collapsed for the
// top decile of URLs. Also reports the corpus age spread to sanity-check a decay-k.
//
// Run with the corpus up:  node scripts/corpus_percentile_analysis.js
//
// Reads MEILISEARCH_URL / MEILISEARCH_KEY from .env.local (same as the server).

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const { MeilisearchCorpus } = await import('../src/corpus/meilisearch.js')

function percentile (sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

const url = process.env.MEILISEARCH_URL || 'http://localhost:7700'
const key = process.env.MEILISEARCH_KEY || 'masterKey'
const meili = new MeilisearchCorpus(url, key)

if (!(await meili.ping())) {
  console.error(`Meilisearch unreachable at ${url} — start it (docker compose up -d) and retry.`)
  process.exit(1)
}

console.log(`Reading corpus from ${url} …`)
const rows = await meili.topByTrust({ limit: 100000, minEngines: 1, sort: 'trust' })
if (!rows.length) {
  console.error('Corpus is empty (no URLs with engine_count >= 1). Run some sweeps first.')
  process.exit(1)
}

const trust = rows.map(r => r.trust_score).sort((a, b) => a - b)
const pcts = [10, 25, 50, 75, 90, 95, 99]
console.log(`\nSample size: ${trust.length} URLs`)
console.log('Trust score percentiles:')
for (const p of pcts) console.log(`  p${p.toString().padStart(2)} = ${percentile(trust, p)}`)
console.log(`  max  = ${trust[trust.length - 1]}`)

const p90 = percentile(trust, 90)
console.log('\nRecommendation:')
console.log(`  QSEARCH_QUALITY_TRUST_SATURATION=${p90}   # current default 2.0; p90 keeps the top decile distinguishable`)
console.log('\nNote: with the default saturation 2.0, the fraction of URLs already clipped to 1.0 is ' +
  `${(trust.filter(t => t >= 2).length / trust.length * 100).toFixed(1)}% — if that is large, the trust signal is being wasted.`)
