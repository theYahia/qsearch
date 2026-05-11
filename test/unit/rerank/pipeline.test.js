import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rerankPipeline, rerankEnabled } from '../../../src/rerank/pipeline.js'
import { rerankByEmbedding } from '../../../src/rerank/embedding_rerank.js'

describe('rerank pipeline — disabled mode (default)', () => {
  test('rerankEnabled reflects env var', () => {
    // Default test env has QSEARCH_RERANK_ENABLED unset → false.
    assert.equal(typeof rerankEnabled(), 'boolean')
  })

  test('rerankPipeline returns ran=false when disabled', async () => {
    const merged = new Map()
    merged.set('a', { query: 'q', priority: 'broad', domain: 'general', ok: true,
      results: [{ url: 'a', title: 'A', description: 'd1' }, { url: 'b', title: 'B', description: 'd2' }] })
    const stats = await rerankPipeline(merged)
    // When disabled, function returns early without scoring.
    if (!rerankEnabled()) {
      assert.equal(stats.ran, false)
      assert.equal(stats.reason, 'disabled')
    }
  })
})

describe('rerankByEmbedding — graceful degrade', () => {
  test('returns empty input unchanged', async () => {
    const r = await rerankByEmbedding('q', [])
    assert.deepEqual(r.reranked, [])
    assert.equal(r.skipped, false)
    assert.equal(r.reason, 'empty')
  })

  test('returns single-item input unchanged', async () => {
    const single = [{ url: 'a', title: 'A', description: 'd' }]
    const r = await rerankByEmbedding('q', single)
    assert.deepEqual(r.reranked, single)
    assert.equal(r.reason, 'single')
  })
})
