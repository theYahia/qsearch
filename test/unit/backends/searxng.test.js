import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { SearXNGBackend } from '../../../src/backends/searxng.js'

describe('SearXNGBackend', () => {
  let mockServer, mockPort

  before(async () => {
    mockServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ results: [{ url: 'https://searxng.example.com', title: 'SearXNG Result', content: 'Content here' }] }))
    })
    await new Promise(r => mockServer.listen(0, r))
    mockPort = mockServer.address().port
  })

  after(() => mockServer.close())

  test('search normalizes to SearchResult[]', async () => {
    const backend = new SearXNGBackend(`http://localhost:${mockPort}`)
    const results = await backend.search('test', { n_results: 3 })
    assert.ok(Array.isArray(results))
    assert.ok(results[0].url)
    assert.ok(results[0].title)
    assert.strictEqual(results[0].source, 'searxng')
  })

  test('throws if no SEARXNG_URL', () => {
    assert.throws(() => new SearXNGBackend(null), /SEARXNG_URL/)
  })
})
