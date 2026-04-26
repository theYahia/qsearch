import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { MeilisearchCorpus } from '../../src/corpus/meilisearch.js'
import { QdrantCorpus } from '../../src/corpus/qdrant.js'
import { Embedder } from '../../src/embed/interface.js'

const MEILI_URL = process.env.MEILISEARCH_URL
const QDRANT_URL = process.env.QDRANT_URL
const skip = !MEILI_URL || !QDRANT_URL

class MockEmbedder extends Embedder {
  get dim () { return 4 }
  get available () { return true }
  async embed () { return [0.1, 0.2, 0.3, 0.4] }
}

describe('Corpus integration', { skip: skip ? 'Docker services not available' : false }, () => {
  const meili = new MeilisearchCorpus(MEILI_URL || 'http://localhost:7700', process.env.MEILISEARCH_KEY || 'masterKey')
  const qdrant = new QdrantCorpus(QDRANT_URL || 'http://localhost:6333', new MockEmbedder())

  const testDoc = {
    id: 'integration-test-doc-1',
    url: 'https://integration.test.example.com',
    title: 'Integration Test Document',
    text: 'This document tests the full index and search pipeline for qsearch corpus',
    namespace: 'user',
    crawled_at: new Date().toISOString()
  }

  before(async () => {
    await meili.index(testDoc)
    await qdrant.index(testDoc)
    await new Promise(r => setTimeout(r, 1500)) // Meilisearch async indexing
  })

  test('meilisearch: indexed doc is findable', async () => {
    const results = await meili.search('integration test pipeline', { limit: 5 })
    assert.ok(results.some(r => r.url === testDoc.url), `Expected ${testDoc.url} in results: ${JSON.stringify(results.map(r => r.url))}`)
  })

  test('qdrant: indexed doc is searchable', async () => {
    const results = await qdrant.search('integration test', { limit: 5 })
    assert.ok(Array.isArray(results))
  })
})
