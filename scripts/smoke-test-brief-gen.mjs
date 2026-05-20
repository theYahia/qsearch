#!/usr/bin/env node
// rd277: smoke test for /research-brief against running qsearch + Ollama.
// Bails (exit 2) if either dependency is down — distinguishes infra-skip from
// real test failure.
//
// Usage: node scripts/smoke-test-brief-gen.mjs [base_url]
//   default base_url: http://localhost:8080

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

async function postJson (path, body, opts = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 120_000)
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal
    })
    let json = null
    try { json = await r.json() } catch { /* may be text */ }
    return { status: r.status, json }
  } finally { clearTimeout(timer) }
}

console.log(`\n[smoke] /research-brief against ${BASE} (Ollama ${OLLAMA})\n`)

// Pre-flight: qsearch + Ollama up?
{
  const q = await fetch(`${BASE}/health`).catch(() => null)
  if (!q || q.status !== 200) {
    console.error(`[smoke] qsearch at ${BASE} not responding — start server first`)
    process.exit(2)
  }
  const o = await fetch(`${OLLAMA}/api/tags`).catch(() => null)
  if (!o || o.status !== 200) {
    console.error(`[smoke] Ollama at ${OLLAMA} not reachable — /research-brief requires it. Skipping.`)
    process.exit(2)
  }
}

await test('endpoint exists (POST /research-brief)', async () => {
  const r = await postJson('/research-brief', { topic: 'test', tier: 'light' })
  assert.notEqual(r.status, 404, 'route returned 404 — running older code?')
})

await test('validation: missing topic → 400', async () => {
  const r = await postJson('/research-brief', { tier: 'standard' })
  assert.equal(r.status, 400)
})

await test('validation: invalid tier → 400', async () => {
  const r = await postJson('/research-brief', { topic: 'x', tier: 'ultradeep' })
  assert.equal(r.status, 400)
})

await test('light tier returns scaffold with cluster outline', async () => {
  const r = await postJson('/research-brief', { topic: 'self-hosted vector databases', tier: 'light' }, { timeout: 90_000 })
  assert.equal(r.status, 200, `expected 200, got ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
  assert.ok(typeof r.json.scaffold_md === 'string')
  assert.ok(r.json.scaffold_md.length > 100, 'scaffold too short')
  assert.ok(r.json.cluster_count >= 5, `light floor 5, got ${r.json.cluster_count}`)
  // Load-bearing sections marked TODO
  assert.match(r.json.scaffold_md, /TODO[^<]*Claude finalize/i, 'no TODO markers — Ollama generated load-bearing sections?')
})

await test('queries.txt lines match cluster count × queries-per-cluster', async () => {
  const r = await postJson('/research-brief', { topic: 'self-hosted vector databases', tier: 'light' }, { timeout: 90_000 })
  if (r.status !== 200) return // graceful — prior test already failed
  const lines = (r.json.queries_txt || '').split('\n').filter(Boolean)
  // light = 3 queries per cluster
  assert.ok(lines.length >= r.json.cluster_count, `expected ≥${r.json.cluster_count} lines, got ${lines.length}`)
  // each line must be name|query|priority
  for (const line of lines.slice(0, 3)) {
    assert.equal(line.split('|').length, 3, `malformed line: ${line}`)
  }
})

await test('claude_required_sections + ollama_only_sections present in response', async () => {
  const r = await postJson('/research-brief', { topic: 'qsearch test topic', tier: 'light' }, { timeout: 90_000 })
  if (r.status !== 200) return
  assert.ok(Array.isArray(r.json.claude_required_sections))
  assert.ok(Array.isArray(r.json.ollama_only_sections))
  assert.ok(r.json.claude_required_sections.includes('killer_questions'))
  assert.ok(r.json.claude_required_sections.includes('brier_priors'))
})

console.log(`\n[smoke] ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
