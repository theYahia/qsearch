#!/usr/bin/env node
// rd275: backfill crawled_at for old docs that pre-date issue #5 fix.
// Old docs have first_seen but no crawled_at. Copy first_seen → crawled_at
// so /pre_sweep_check freshness queries work on existing 143k corpus.
//
// Usage: node scripts/backfill-crawl-timestamp.mjs [--dry-run] [--batch=500]
// Idempotent — skips docs that already have crawled_at set.

import { Meilisearch } from 'meilisearch'

const MEILI_URL = process.env.MEILI_URL || 'http://localhost:7700'
const MEILI_KEY = process.env.MEILI_MASTER_KEY || 'masterKey'
const INDEX_NAME = 'qsearch'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const BATCH = Number((args.find(a => a.startsWith('--batch=')) || '--batch=500').split('=')[1])

const client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY })
const idx = client.index(INDEX_NAME)

console.log(`[backfill] target=${MEILI_URL} index=${INDEX_NAME} dry_run=${DRY_RUN} batch=${BATCH}`)

let offset = 0
let scanned = 0
let updated = 0
const t0 = Date.now()

while (true) {
  const { hits } = await idx.search('', {
    limit: BATCH,
    offset,
    attributesToRetrieve: ['id', 'url', 'crawled_at', 'first_seen', 'appeared_in_sweeps']
  })
  if (!hits.length) break

  const patch = []
  for (const h of hits) {
    scanned++
    if (h.crawled_at) continue
    const fallback = h.first_seen
      || (h.appeared_in_sweeps || []).map(s => s.crawled_at).filter(Boolean).sort()[0]
      || null
    if (!fallback) continue
    patch.push({ id: h.id, crawled_at: fallback })
  }

  if (patch.length && !DRY_RUN) {
    await idx.updateDocuments(patch)
    updated += patch.length
  } else if (patch.length) {
    updated += patch.length
  }

  if (hits.length < BATCH) break
  offset += BATCH
  if (scanned % 5000 === 0) console.log(`[backfill] scanned=${scanned} would-update=${updated} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

console.log(`[backfill] done scanned=${scanned} ${DRY_RUN ? 'would-update' : 'updated'}=${updated} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`)
