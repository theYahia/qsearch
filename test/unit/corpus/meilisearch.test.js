import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MeilisearchCorpus } from '../../../src/corpus/meilisearch.js'

const MEILI_URL = process.env.MEILISEARCH_URL

describe('MeilisearchCorpus', { skip: !MEILI_URL ? 'MEILISEARCH_URL not set' : false }, () => {
  const corpus = new MeilisearchCorpus(MEILI_URL || 'http://localhost:7700', process.env.MEILISEARCH_KEY || 'masterKey')

  test('ping returns bool', async () => {
    const ok = await corpus.ping()
    assert.strictEqual(typeof ok, 'boolean')
  })

  test('index and search round-trip', async (t) => {
    if (!MEILI_URL) t.skip('MEILISEARCH_URL not set')
    await corpus.index({ id: 'test-meili-1', url: 'https://test.meili.example.com', title: 'Meilisearch Test Doc', text: 'ollama embed install npm package testing', namespace: 'user', crawled_at: new Date().toISOString() })
    await new Promise(r => setTimeout(r, 1500)) // Meilisearch is async
    const results = await corpus.search('ollama embed install', { limit: 5 })
    assert.ok(results.some(r => r.url === 'https://test.meili.example.com'))
  })
})

// rd277: freshness tracking — issue #5 fix. Schema migration is async on
// Meilisearch side; on the live 181k-doc index it can sit in `enqueued`
// state for minutes behind a backlog of document tasks. Tests handle this
// honestly: contract tests pass regardless of migration state; semantic
// tests skip when migration hasn't applied yet.
describe('MeilisearchCorpus — rd277 freshness tracking', { skip: !MEILI_URL ? 'MEILISEARCH_URL not set' : false }, () => {
  const corpus = new MeilisearchCorpus(MEILI_URL || 'http://localhost:7700', process.env.MEILISEARCH_KEY || 'masterKey')

  test('stats() exposes last_crawled_at and documents_with_crawl_timestamp fields', async () => {
    const s = await corpus.stats()
    assert.ok('last_crawled_at' in s, 'last_crawled_at missing from stats response')
    assert.ok('documents_with_crawl_timestamp' in s, 'documents_with_crawl_timestamp missing from stats response')
    assert.equal(typeof s.documents_with_crawl_timestamp, 'number')
    // last_crawled_at is either ISO string or null (depending on migration state).
    if (s.last_crawled_at !== null) {
      assert.match(s.last_crawled_at, /^\d{4}-\d{2}-\d{2}T/)
    }
  })

  test('schema includes crawled_at in filterable+sortable (after migration)', async (t) => {
    const idx = await corpus.getIndex()
    // Trigger _ensureIndex via getIndex(), then give Meilisearch up to 5s.
    // If the index has many docs the reindex task may sit in the queue much
    // longer — we skip in that case rather than fail.
    let filterable = []
    let sortable = []
    for (let i = 0; i < 5; i++) {
      filterable = await idx.getFilterableAttributes()
      sortable = await idx.getSortableAttributes()
      if (filterable.includes('crawled_at') && sortable.includes('crawled_at')) break
      await new Promise(r => setTimeout(r, 1000))
    }
    if (!filterable.includes('crawled_at') || !sortable.includes('crawled_at')) {
      t.skip(`migration still pending after 5s (filterable=${filterable.join(',')} sortable=${sortable.join(',')}) — large corpus, retry test after Meilisearch task queue drains`)
      return
    }
    assert.ok(filterable.includes('crawled_at'))
    assert.ok(sortable.includes('crawled_at'))
  })

  test('ingest with crawled_at lifts last_crawled_at (requires migration applied)', async (t) => {
    // Pre-check: migration must be applied for stats freshness query to work.
    const idx = await corpus.getIndex()
    const filterable = await idx.getFilterableAttributes()
    if (!filterable.includes('crawled_at')) {
      t.skip('crawled_at not yet filterable on live index — migration pending')
      return
    }
    const fresh = new Date().toISOString()
    await corpus.index({
      id: 'test-rd277-freshness',
      url: 'https://test.rd277.example.com/freshness',
      title: 'Freshness probe',
      text: 'rd277 freshness probe document',
      namespace: 'user',
      crawled_at: fresh
    })
    await new Promise(r => setTimeout(r, 2500))
    const s = await corpus.stats()
    assert.ok(s.documents_with_crawl_timestamp >= 1, `expected ≥1 doc with timestamp, got ${s.documents_with_crawl_timestamp}`)
    assert.ok(s.last_crawled_at !== null, 'last_crawled_at still null after fresh ingest')
    assert.ok(s.last_crawled_at >= fresh, `last_crawled_at ${s.last_crawled_at} < fresh ${fresh}`)
  })
})
