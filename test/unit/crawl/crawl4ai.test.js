import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

describe('crawl4ai wrapper', () => {
  test('crawl module exports crawl function', async () => {
    const mod = await import('../../../src/crawl/crawl4ai.js')
    assert.strictEqual(typeof mod.crawl, 'function')
  })
})
