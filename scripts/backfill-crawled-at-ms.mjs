#!/usr/bin/env node
// Backfill crawled_at_ms — the numeric companion that makes the freshness filter work.
//
// Why it is needed: Meilisearch's >= is a NUMERIC operator, so corpusLookup's
// `crawled_at >= "<ISO string>"` failed with invalid_search_filter on every call and the bare
// catch retried unfiltered. src/corpus/meilisearch.js now writes crawled_at_ms on every index()
// and filters on it, but documents written before that have no such field — and Meilisearch
// excludes documents that lack a filtered attribute, so without this pass a freshness-filtered
// lookup returns nothing at all.
//
// NOT a copy of backfill-crawl-timestamp.mjs, which fills a different field (crawled_at, from
// first_seen) and is left untouched. One difference matters beyond the field name: that script
// paginates with search(), which Meilisearch caps at maxTotalHits (default 1000), so it cannot
// reach past the first 1000 documents of a 370k index. This one uses the documents endpoint,
// which is not capped.
//
// Usage: node scripts/backfill-crawled-at-ms.mjs [--dry-run] [--batch=1000]
// Idempotent — skips documents that already have a valid crawled_at_ms.

import { Meilisearch } from 'meilisearch'

const MEILI_URL = process.env.MEILI_URL || process.env.MEILISEARCH_URL || 'http://localhost:7700'
const MEILI_KEY = process.env.MEILI_MASTER_KEY || process.env.MEILISEARCH_KEY || 'masterKey'
const INDEX_NAME = process.env.MEILI_INDEX || 'qsearch_corpus'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const BATCH = Number((args.find(a => a.startsWith('--batch=')) || '--batch=1000').split('=')[1])

const client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY })
const idx = client.index(INDEX_NAME)

const stats = await idx.getStats()
console.log(`[backfill-ms] target=${MEILI_URL} index=${INDEX_NAME} docs=${stats.numberOfDocuments} dry_run=${DRY_RUN} batch=${BATCH}`)

let offset = 0
let scanned = 0
let updated = 0
let noSource = 0
const t0 = Date.now()

while (true) {
  const page = await idx.getDocuments({
    offset,
    limit: BATCH,
    fields: ['id', 'crawled_at', 'crawled_at_ms', 'first_seen']
  })
  const docs = page.results || []
  if (!docs.length) break

  const patch = []
  for (const d of docs) {
    scanned++
    if (Number.isFinite(d.crawled_at_ms)) continue
    // crawled_at is the sweep timestamp; first_seen is the fallback for pre-issue-#5 documents.
    const ms = Date.parse(d.crawled_at) || Date.parse(d.first_seen)
    if (!Number.isFinite(ms)) { noSource++; continue }
    patch.push({ id: d.id, crawled_at_ms: ms })
  }

  if (patch.length) {
    if (!DRY_RUN) await idx.updateDocuments(patch)
    updated += patch.length
  }

  offset += docs.length
  if (scanned % 20000 < BATCH) {
    console.log(`[backfill-ms] scanned=${scanned} ${DRY_RUN ? 'would-update' : 'updated'}=${updated} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }
  if (docs.length < BATCH) break
}

console.log(`[backfill-ms] done scanned=${scanned} ${DRY_RUN ? 'would-update' : 'updated'}=${updated} no_timestamp_source=${noSource} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (noSource) console.log(`[backfill-ms] ${noSource} documents carry neither crawled_at nor first_seen — they stay invisible to freshness-filtered lookups.`)
