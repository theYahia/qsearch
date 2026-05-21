import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { SearXNGBackend } from '../../../src/backends/searxng.js'

describe('SearXNGBackend', () => {
  let mockServer, mockPort, lastQuery

  before(async () => {
    mockServer = http.createServer((req, res) => {
      lastQuery = new URL(req.url, 'http://x').searchParams
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

  test('default query uses categories=general, not engines (rd1070)', async () => {
    // settings.yml `keep_only` restricts enabled engines to named subsets; the literal
    // `engines=general` matched no engine and SearXNG returned zero results, silently
    // emptying every broad /sweep query. The default must select the general *category*.
    const backend = new SearXNGBackend(`http://localhost:${mockPort}`)
    await backend.search('test', { n_results: 3 })
    assert.strictEqual(lastQuery.get('categories'), 'general')
    assert.strictEqual(lastQuery.get('engines'), null)
  })

  test('explicit engines list is forwarded as engines param', async () => {
    const backend = new SearXNGBackend(`http://localhost:${mockPort}`)
    await backend.search('test', { n_results: 3, engines: 'brave,bing' })
    assert.strictEqual(lastQuery.get('engines'), 'brave,bing')
    assert.strictEqual(lastQuery.get('categories'), null)
  })

  test('throws if no SEARXNG_URL', () => {
    assert.throws(() => new SearXNGBackend(null), /SEARXNG_URL/)
  })
})
