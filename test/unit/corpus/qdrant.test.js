import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { QdrantCorpus } from '../../../src/corpus/qdrant.js'
import { Embedder } from '../../../src/embed/interface.js'

class MockEmbedder extends Embedder {
  get dim () { return 4 }
  get available () { return true }
  async embed () { return [0.1, 0.2, 0.3, 0.4] }
}

const QDRANT_URL = process.env.QDRANT_URL

describe('QdrantCorpus', { skip: !QDRANT_URL ? 'QDRANT_URL not set' : false }, () => {
  const corpus = new QdrantCorpus(QDRANT_URL || 'http://localhost:6333', new MockEmbedder())

  test('ping returns bool', async () => {
    const ok = await corpus.ping()
    assert.strictEqual(typeof ok, 'boolean')
  })

  test('index and vector search round-trip', async (t) => {
    if (!QDRANT_URL) t.skip('QDRANT_URL not set')
    await corpus.index({ url: 'https://test.qdrant.example.com', title: 'Qdrant Test', text: 'vector search test document', namespace: 'user', crawled_at: new Date().toISOString() })
    const results = await corpus.search('vector test', { limit: 5 })
    assert.ok(Array.isArray(results))
  })
})
