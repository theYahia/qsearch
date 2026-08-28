#!/usr/bin/env node
// Smoke test for Phase 3 /sweep_context — verifies HTML extraction, fetchHtml timeout/cap,
// runSweepContext orchestration with mocked LLM. Uses local http server for mock URLs.
//
// Run:  node scripts/smoke-test-sweep-context.mjs
// Exit: 0 = all pass, 1 = any failure

import { fetchHtml, extractMainContent } from '../src/fetch/html.js'
import { runSweepContext } from '../src/sweep_context.js'
import http from 'node:http'
import assert from 'node:assert/strict'

let pass = 0, fail = 0
async function test (name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    pass++
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err.message}`)
    fail++
  }
}

console.log('\n[smoke] Phase 3 /sweep_context\n')

// ── extractMainContent ─────────────────────────────────────────────

await test('extractMainContent: strips script/style/nav/footer', async () => {
  const html = `
    <html><head><title>Test Title</title></head><body>
      <nav>nav junk</nav>
      <script>alert("evil")</script>
      <style>body{color:red}</style>
      <main>
        <p>This is the main content paragraph with enough chars to pass minimum threshold.</p>
        <p>Second paragraph also long enough to be captured by extraction.</p>
      </main>
      <footer>cookie banner trash</footer>
    </body></html>`
  const ex = extractMainContent(html)
  assert.equal(ex.title, 'Test Title')
  assert.equal(ex.paragraphs.length, 2, `expected 2 paragraphs, got ${ex.paragraphs.length}`)
  assert.ok(!ex.text.includes('alert'), 'script content must not leak')
  assert.ok(!ex.text.includes('nav junk'), 'nav must be stripped')
  assert.ok(!ex.text.includes('color:red'), 'style must be stripped')
})

await test('extractMainContent: title falls back to h1 when <title> absent', async () => {
  const html = '<html><body><h1>Heading One</h1><p>Some content with enough chars to qualify.</p></body></html>'
  const ex = extractMainContent(html)
  assert.equal(ex.title, 'Heading One')
})

await test('extractMainContent: respects minParaChars + maxParas', async () => {
  const shortPs = Array.from({ length: 5 }, () => '<p>tiny</p>').join('')
  const longPs = Array.from({ length: 300 }, (_, i) => `<p>This is a long paragraph number ${i} with enough chars to qualify above threshold.</p>`).join('')
  const ex = extractMainContent(`<html><body>${shortPs}${longPs}</body></html>`, { maxParas: 50 })
  assert.ok(ex.paragraphs.length <= 50, `expected ≤50 paras (cap), got ${ex.paragraphs.length}`)
  assert.ok(ex.paragraphs.length >= 50, `expected exactly 50 paras (cap), got ${ex.paragraphs.length}`)
})

await test('extractMainContent: fallback to body text when no structured elements', async () => {
  const html = '<html><body>Just some flat text without any structured tags but at least forty characters.</body></html>'
  const ex = extractMainContent(html)
  assert.ok(ex.paragraphs.length >= 1, 'must produce at least one paragraph from raw text')
})

// ── fetchHtml ──────────────────────────────────────────────────────

await test('fetchHtml: enforces timeout', async () => {
  // Server that hangs forever
  const srv = http.createServer((req, res) => {
    // never respond
  })
  await new Promise(r => srv.listen(0, r))
  const port = srv.address().port
  try {
    let threw = false
    try {
      await fetchHtml(`http://127.0.0.1:${port}/`, { timeoutMs: 200 })
    } catch (err) {
      threw = true
      assert.ok(/abort|timeout/i.test(err.message + ' ' + (err.name || '')), `unexpected error: ${err.message}`)
    }
    assert.ok(threw, 'fetchHtml must throw on timeout')
  } finally {
    srv.close()
  }
})

await test('fetchHtml: enforces maxBytes cap', async () => {
  const big = 'X'.repeat(10000)
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(big)
  })
  await new Promise(r => srv.listen(0, r))
  const port = srv.address().port
  try {
    let threw = false
    try {
      await fetchHtml(`http://127.0.0.1:${port}/`, { maxBytes: 100 })
    } catch (err) {
      threw = true
      assert.ok(err.message.includes('maxBytes'), `expected maxBytes error, got: ${err.message}`)
    }
    assert.ok(threw, 'fetchHtml must throw when response exceeds maxBytes')
  } finally {
    srv.close()
  }
})

await test('fetchHtml: rejects non-HTML content-type', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
  await new Promise(r => srv.listen(0, r))
  const port = srv.address().port
  try {
    let threw = false
    try {
      await fetchHtml(`http://127.0.0.1:${port}/`)
    } catch (err) {
      threw = true
      assert.ok(err.message.includes('Non-HTML'), `expected Non-HTML error, got: ${err.message}`)
    }
    assert.ok(threw)
  } finally {
    srv.close()
  }
})

await test('fetchHtml: returns html + status for valid response', async () => {
  const html = '<html><body><p>hello world from local server</p></body></html>'
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  })
  await new Promise(r => srv.listen(0, r))
  const port = srv.address().port
  try {
    const out = await fetchHtml(`http://127.0.0.1:${port}/`)
    assert.equal(out.status, 200)
    assert.ok(out.html.includes('hello world'))
  } finally {
    srv.close()
  }
})

// ── runSweepContext ────────────────────────────────────────────────

await test('runSweepContext: happy path with cache hit returns Brave-shape result', async () => {
  // mock cache that always hits
  const cache = {
    get: async () => ({ title: 'Cached', paragraphs: ['Para one with enough chars.', 'Para two also valid.'] }),
    set: async () => null
  }
  const out = await runSweepContext({
    urls: ['https://example.com/x'],
    focus_query: 'test query',
    cacheClient: cache
  })
  assert.equal(out.type, 'context')
  assert.equal(out.source, 'qsearch_local')
  assert.equal(out.cache_hits, 1)
  assert.equal(out.cache_misses, 0)
  assert.equal(out.results.length, 1)
  assert.equal(out.results[0].url, 'https://example.com/x')
  assert.equal(out.results[0].title, 'Cached')
  assert.ok(typeof out.results[0].snippet_count === 'number')
})

await test('runSweepContext: missing urls throws', async () => {
  let threw = false
  try { await runSweepContext({ focus_query: 'q' }) } catch (e) { threw = true; assert.ok(e.message.includes('urls')) }
  assert.ok(threw)
})

await test('runSweepContext: missing focus_query throws', async () => {
  let threw = false
  try { await runSweepContext({ urls: ['https://x'] }) } catch (e) { threw = true; assert.ok(e.message.includes('focus_query')) }
  assert.ok(threw)
})

await test('runSweepContext: failed URL produces error entry, others succeed', async () => {
  const cache = {
    get: async (url) => {
      if (url === 'https://ok.example/') return { title: 'OK', paragraphs: ['Good paragraph with enough chars to pass.'] }
      return null  // miss for the bad one → real fetch attempted on unreachable URL
    },
    set: async () => null
  }
  const out = await runSweepContext({
    urls: ['https://ok.example/', 'http://127.0.0.1:1/never'],
    focus_query: 'mixed test',
    cacheClient: cache,
    timeout_ms: 500
  })
  assert.equal(out.results.length, 2)
  const okRes = out.results.find(r => r.url === 'https://ok.example/')
  const badRes = out.results.find(r => r.url === 'http://127.0.0.1:1/never')
  assert.ok(okRes && !okRes.error, 'good URL should not have error')
  assert.ok(badRes && badRes.error, 'bad URL must surface error field')
})

console.log(`\n[smoke] ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
