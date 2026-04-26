import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { BraveBackend } from '../../../src/backends/brave.js'

describe('BraveBackend', () => {
  let mockServer, mockPort

  before(async () => {
    mockServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ web: { results: [{ url: 'https://example.com', title: 'Test', description: 'Desc', extra_snippets: [], page_age: null, age: null, language: 'en', profile: null }] } }))
    })
    await new Promise(r => mockServer.listen(0, r))
    mockPort = mockServer.address().port
    process.env.BRAVE_BASE_URL = `http://localhost:${mockPort}`
    process.env.BRAVE_API_KEY = 'test-key'
  })

  after(() => mockServer.close())

  test('search returns SearchResult[]', async () => {
    const backend = new BraveBackend()
    const results = await backend.search('test query', { n_results: 1 })
    assert.ok(Array.isArray(results))
    assert.ok(results.length > 0)
    assert.ok(results[0].url)
    assert.ok(results[0].title)
  })
})
