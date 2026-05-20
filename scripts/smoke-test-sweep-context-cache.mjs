#!/usr/bin/env node
// rd277: smoke test for /sweep_context URL-cache. Hits the same (url, focus_query)
// twice, asserts second call is fast + reports cache_hits. Then verifies ?bust=1
// param forces a refresh.
//
// Pre-flight: server up, Ollama up (sweep_context calls qwen3-600M).
// Uses a stable public URL so subsequent runs of this script also benefit.
//
// Usage: node scripts/smoke-test-sweep-context-cache.mjs [base_url]

import assert from 'node:assert/strict'

const BASE = process.argv[2] || process.env.QSEARCH_URL || 'http://localhost:8080'
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434'
let pass = 0, fail = 0

async function test (name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    pass++
  } catch (err) {
    console.log(`  ✗ ${name}\n    ${err.message}`)
    fail++
  }
}

async function sweepContext (urls, focus_query, opts = {}) {
  const t0 = Date.now()
  const path = opts.bust ? '/sweep_context?bust=1' : '/sweep_context'
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, focus_query, ...(opts.body || {}) })
  })
  const json = await r.json().catch(() => null)
  return { status: r.status, json, elapsedMs: Date.now() - t0 }
}

console.log(`\n[smoke] /sweep_context URL-cache against ${BASE}\n`)

// Pre-flight
{
  const q = await fetch(`${BASE}/health`).catch(() => null)
  if (!q || q.status !== 200) {
    console.error(`[smoke] qsearch at ${BASE} not responding — start server first`)
    process.exit(2)
  }
  const o = await fetch(`${OLLAMA}/api/tags`).catch(() => null)
  if (!o || o.status !== 200) {
    console.error(`[smoke] Ollama at ${OLLAMA} not reachable — /sweep_context requires it. Skipping.`)
    process.exit(2)
  }
}

// Use a unique URL per run so we control whether cache is cold or warm.
// example.com is small + stable; the cache key includes focus_query so a
// fresh query string keeps each run independent.
const SENTINEL_URL = 'https://example.com/'
const SENTINEL_QUERY = `rd277 smoke ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

let firstElapsed = 0
await test('first call (cache cold) populates cache', async () => {
  const r = await sweepContext([SENTINEL_URL], SENTINEL_QUERY)
  assert.equal(r.status, 200, `first sweep_context failed: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
  assert.ok(Array.isArray(r.json.results))
  // First call MISSES cache
  assert.equal(r.json.cache_hits, 0, `expected cache_hits=0 on cold call, got ${r.json.cache_hits}`)
  assert.equal(r.json.cache_misses, 1)
  firstElapsed = r.elapsedMs
  console.log(`    (cold call ${firstElapsed}ms)`)
})

await test('second call (cache warm) hits cache and is faster', async () => {
  const r = await sweepContext([SENTINEL_URL], SENTINEL_QUERY)
  assert.equal(r.status, 200)
  assert.equal(r.json.cache_hits, 1, `expected cache_hits=1 on warm call, got ${r.json.cache_hits}`)
  assert.equal(r.json.cache_misses, 0)
  // Warm call should beat cold by a wide margin — no Ollama extraction.
  // Use 50% threshold to be lenient against network jitter.
  assert.ok(r.elapsedMs < firstElapsed * 0.5,
    `expected warm call < 50% of cold (${firstElapsed}ms), got ${r.elapsedMs}ms`)
  console.log(`    (warm call ${r.elapsedMs}ms vs cold ${firstElapsed}ms)`)
})

await test('normalised key — different casing hits same cache entry', async () => {
  // Mixed-case URL + extra-whitespace query should hit the same row per
  // QueryCache.normalizeUrl + normalizeKey.
  const r = await sweepContext(
    [SENTINEL_URL.toUpperCase().replace('HTTPS', 'https')],
    `  ${SENTINEL_QUERY.toUpperCase()}  `
  )
  assert.equal(r.status, 200)
  assert.equal(r.json.cache_hits, 1, `expected normalised-equivalent key to hit cache, got ${r.json.cache_hits}`)
})

await test('?bust=1 forces cache miss + refresh', async () => {
  const r = await sweepContext([SENTINEL_URL], SENTINEL_QUERY, { bust: true })
  assert.equal(r.status, 200)
  assert.equal(r.json.cache_hits, 0, `bust=1 should force miss, got cache_hits=${r.json.cache_hits}`)
  assert.equal(r.json.cache_misses, 1)
})

await test('post-bust cache is repopulated (next call hits)', async () => {
  const r = await sweepContext([SENTINEL_URL], SENTINEL_QUERY)
  assert.equal(r.status, 200)
  assert.equal(r.json.cache_hits, 1, `expected re-populated cache to hit, got ${r.json.cache_hits}`)
})

console.log(`\n[smoke] ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
