#!/usr/bin/env node
// rd277: smoke test for /pre_sweep_check against a running qsearch server.
// Polls /health first; bails with non-zero exit if server not up.
//
// Usage: node scripts/smoke-test-pre-check.mjs [base_url]
//   default base_url: http://localhost:8080

import assert from 'node:assert/strict'

const BASE = process.argv[2] || process.env.QSEARCH_URL || 'http://localhost:8080'
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

async function postJson (path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  let json = null
  try { json = await r.json() } catch { /* may be text */ }
  return { status: r.status, json }
}

async function getJson (path) {
  const r = await fetch(`${BASE}${path}`)
  let json = null
  try { json = await r.json() } catch { /* may be text */ }
  return { status: r.status, json }
}

console.log(`\n[smoke] /pre_sweep_check against ${BASE}\n`)

// Bail early if server not up
{
  const r = await getJson('/health').catch(() => ({ status: 0 }))
  if (r.status !== 200) {
    console.error(`[smoke] server at ${BASE} not responding to /health — start qsearch first`)
    process.exit(2)
  }
}

await test('endpoint exists (POST /pre_sweep_check)', async () => {
  const r = await postJson('/pre_sweep_check', { queries: ['hello world'] })
  // 200 (corpus reachable) or 500 (corpus down) — both valid; 404 means route missing.
  assert.notEqual(r.status, 404, `route returned 404 — server may be running older code`)
  assert.ok([200, 500].includes(r.status), `unexpected status ${r.status}`)
})

await test('validation: empty body → 400', async () => {
  const r = await postJson('/pre_sweep_check', {})
  assert.equal(r.status, 400)
  assert.match(r.json.error || '', /queries\[\] required/)
})

await test('validation: queries cap at 500 → 400', async () => {
  const queries = Array.from({ length: 501 }, (_, i) => `q${i}`)
  const r = await postJson('/pre_sweep_check', { queries })
  assert.equal(r.status, 400)
  assert.match(r.json.error || '', /capped at 500/)
})

await test('fresh-random query returns coverage with valid verdict', async () => {
  const sentinel = `rd277-fresh-sentinel-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const r = await postJson('/pre_sweep_check', {
    queries: [sentinel],
    freshness_days: 7,
    overlap_threshold: 0.6
  })
  if (r.status === 500) {
    console.log('    (corpus unreachable, recommended verdict path tested in Tier 1)')
    return // graceful skip — endpoint at least responded with structured error
  }
  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.json.coverage), 'coverage[] missing')
  assert.equal(r.json.coverage.length, 1)
  assert.match(r.json.coverage[0].verdict, /^(covered|partial|miss)$/)
  // A fresh random sentinel should always miss
  assert.equal(r.json.coverage[0].verdict, 'miss', `expected miss for sentinel, got ${r.json.coverage[0].verdict}`)
  assert.match(r.json.recommendation, /^(skip_sweep|partial_sweep|run_sweep|no_queries)$/)
})

await test('overall_coverage is a number 0-1', async () => {
  const r = await postJson('/pre_sweep_check', {
    queries: ['rd277', 'qsearch', 'something else'],
    freshness_days: 30
  })
  if (r.status === 500) return // graceful skip
  assert.equal(r.status, 200)
  assert.equal(typeof r.json.overall_coverage, 'number')
  assert.ok(r.json.overall_coverage >= 0 && r.json.overall_coverage <= 1, `coverage out of [0,1]: ${r.json.overall_coverage}`)
})

console.log(`\n[smoke] ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
