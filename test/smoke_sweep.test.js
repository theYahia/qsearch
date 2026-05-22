import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import http from 'node:http'
import { SearXNGBackend } from '../src/backends/searxng.js'

// Sweep smoke test (Phase 2 reliability). The rd1070 class of bug: /health returns
// ok while every broad /sweep silently returns zero because SearXNG's selected
// engines answer nothing. This mock reproduces that exact failure mode — it returns
// results ONLY for an explicit reliable-engine list, and EMPTY for the round-1
// `engines=general` / `categories=general` selection. A broad search via the default
// engine list must therefore come back non-empty, or this test goes red.
describe('sweep smoke — broad SearXNG path returns results (rd1070 guard)', () => {
  let mockServer, mockPort

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const params = new URL(req.url, 'http://x').searchParams
      const engines = params.get('engines') || ''
      const categories = params.get('categories') || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // Reproduce rd1070: the `general` category/engine selection yields nothing.
      if (engines === 'general' || categories === 'general') {
        res.end(JSON.stringify({ results: [], unresponsive_engines: [] }))
        return
      }
      // Reliable explicit engines (mojeek/bing) carry results; duckduckgo is CAPTCHA-blocked
      // (the real chronic degradation SearXNG reports via unresponsive_engines).
      res.end(JSON.stringify({
        results: [
          { url: 'https://a.example.com', title: 'A', content: 'first', engines: ['mojeek'], score: 1 },
          { url: 'https://b.example.com', title: 'B', content: 'second', engines: ['bing'], score: 0.9 },
          { url: 'https://c.example.com', title: 'C', content: 'third', engines: ['mojeek'], score: 0.8 }
        ],
        unresponsive_engines: [['duckduckgo', 'CAPTCHA']]
      }))
    })
    await new Promise(r => mockServer.listen(0, r))
    mockPort = mockServer.address().port
  })

  after(() => mockServer.close())

  test('default broad search returns non-empty results', async () => {
    const backend = new SearXNGBackend(`http://localhost:${mockPort}`)
    const results = await backend.search('any broad query', { n_results: 5 })
    assert.ok(results.length > 0, 'broad SearXNG search must return >0 results (rd1070 regression)')
  })

  test('returned items carry engine provenance (per-engine degradation visibility)', async () => {
    const backend = new SearXNGBackend(`http://localhost:${mockPort}`)
    const results = await backend.search('any broad query', { n_results: 5 })
    const engines = new Set(results.flatMap(r => r.engines || []))
    assert.ok(engines.size > 0, 'results must expose which engine answered, so degradation is observable')
  })

  test('probe() surfaces unresponsive_engines + counts contribution over full set (canary fix)', async () => {
    const backend = new SearXNGBackend(`http://localhost:${mockPort}`)
    const p = await backend.probe('any broad query')
    // unresponsive_engines normalized to {engine, reason} — the authoritative degradation signal
    assert.deepEqual(p.unresponsive_engines, [{ engine: 'duckduckgo', reason: 'CAPTCHA' }])
    // contribution counted over the FULL result set (not a top-N slice): mojeek appears twice
    assert.equal(p.contributing_engines.mojeek, 2, 'mojeek must be counted (not "silent") — it answered')
    assert.equal(p.contributing_engines.bing, 1)
    assert.equal(p.total, 3)
    assert.ok(p.configured_engines.includes('mojeek'))
  })
})
