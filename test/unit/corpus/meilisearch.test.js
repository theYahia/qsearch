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
    await corpus.index({ id: 'test-meili-1', url: 'https://test.meili.example.com', title: 'Meilisearch Test Doc', text: 'qvac sdk install npm package testing', namespace: 'user', crawled_at: new Date().toISOString() })
    await new Promise(r => setTimeout(r, 1500)) // Meilisearch is async
    const results = await corpus.search('qvac sdk install', { limit: 5 })
    assert.ok(results.some(r => r.url === 'https://test.meili.example.com'))
  })
})
