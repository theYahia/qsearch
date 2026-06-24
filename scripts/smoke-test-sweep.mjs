#!/usr/bin/env node
// Smoke test for sweep reliability (Phase 4) — verifies zero-result detection,
// retry-once logic, and warning aggregation for parsed_snippets.md.
//
// Tests run against runSweep + renderMarkdown directly with a mock searchFn.
// No HTTP server needed.
//
// Run:  node scripts/smoke-test-sweep.mjs
// Exit: 0 = all pass, 1 = any failure

import { runSweep } from '../src/sweep/runner.js'
import { renderMarkdown } from '../src/sweep/parsed_snippets.js'
import assert from 'node:assert/strict'

let pass = 0, fail = 0
function test (name, fn) {
  return (async () => {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      pass++
    } catch (err) {
      console.error(`  ✗ ${name}\n      ${err.message}`)
      fail++
    }
  })()
}

console.log('\n[smoke] sweep reliability\n')

// Mock backend factories
const mockOk = (count = 3) => async (endpoint, query) => ({
  data: { web: { results: Array.from({ length: count }, (_, i) => ({
    url: `https://ok.example/${query.replace(/\s+/g, '_')}/${i}`,
    title: `Result ${i} for ${query}`,
    description: `desc ${i}`
  })) } }
})

const mockEmpty = async () => ({ data: { web: { results: [] } } })

// Returns empty on first call per query, then results on retry — simulates flaky backend
const mockFlaky = () => {
  const seen = new Map()
  return async (endpoint, query) => {
    const n = (seen.get(query) || 0) + 1
    seen.set(query, n)
    if (n === 1) return { data: { web: { results: [] } } }
    return {
      data: { web: { results: [{ url: `https://flaky/${n}/${query}`, title: 'r', description: 'd' }] } }
    }
  }
}

const mockThrows = async () => { throw new Error('backend down') }

await test('happy path — all queries return results, ok counts match', async () => {
  const queries = [{ label: 'q1', query: 'foo' }, { label: 'q2', query: 'bar' }]
  const { results, stats } = await runSweep(queries, mockOk(3))
  assert.equal(stats.web_ok, 2)
  assert.equal(stats.web_fail, 0)
  assert.equal(stats.web_zero, 0)
  assert.equal(results.get('q1').ok, true)
  assert.equal(results.get('q1').results.length, 3)
})

await test('zero-result query is retried once and marked ok=false with reason=zero_results', async () => {
  const queries = [{ label: 'empty1', query: 'nothingmatches' }]
  const { results, stats } = await runSweep(queries, mockEmpty)
  assert.equal(stats.web_zero, 1, 'web_zero should be 1')
  assert.equal(stats.web_ok, 0, 'web_ok should be 0')
  const e = results.get('empty1')
  assert.equal(e.ok, false)
  assert.equal(e.reason, 'zero_results')
  assert.equal(e.error, 'zero_results')
  assert.deepEqual(e.results, [])
})

await test('flaky backend recovers on retry — counts to web_zero_recovered, ok=true', async () => {
  const queries = [{ label: 'flake1', query: 'flakyone' }, { label: 'flake2', query: 'flakytwo' }]
  const { results, stats } = await runSweep(queries, mockFlaky())
  assert.equal(stats.web_ok, 2, 'both should recover')
  assert.equal(stats.web_zero, 0)
  assert.equal(stats.web_zero_recovered, 2)
  assert.equal(results.get('flake1').ok, true)
  assert.equal(results.get('flake1').results.length, 1)
})

await test('thrown backend errors stay in web_fail — distinct from zero_results', async () => {
  const queries = [{ label: 'down', query: 'whatever' }]
  const { results, stats } = await runSweep(queries, mockThrows)
  assert.equal(stats.web_fail, 1)
  assert.equal(stats.web_zero, 0)
  const e = results.get('down')
  assert.equal(e.ok, false)
  assert.equal(e.error, 'backend down')
  assert.notEqual(e.reason, 'zero_results')
})

await test('retryZeroResults=false disables retry — single zero result counted', async () => {
  const queries = [{ label: 'norectry', query: 'noresults' }]
  let calls = 0
  const counter = async () => { calls++; return { data: { web: { results: [] } } } }
  const { stats } = await runSweep(queries, counter, { retryZeroResults: false })
  assert.equal(calls, 1, 'should only call backend once when retry disabled')
  assert.equal(stats.web_zero, 1)
})

await test('parsed_snippets.md surfaces zero-result warning block + per-query tag', async () => {
  const queries = [
    { label: 'good', query: 'foo' },
    { label: 'empty', query: 'nothing' }
  ]
  // Hybrid backend: 'foo' gets results, 'nothing' empty
  const hybrid = async (endpoint, query) => {
    if (query === 'foo') return { data: { web: { results: [{ url: 'https://x/y', title: 't', description: 'd' }] } } }
    return { data: { web: { results: [] } } }
  }
  const { results, stats } = await runSweep(queries, hybrid)
  const md = renderMarkdown(results, queries, stats)
  assert.ok(md.includes('## ⚠️ Sweep warnings'), 'must include warnings header')
  assert.ok(md.includes('Zero-result queries (1)'), 'must show count of zero-result queries')
  assert.ok(md.includes('empty'), 'must list empty label')
  assert.ok(md.includes('⚠️ ZERO RESULTS (after retry)'), 'per-query section must tag zero-result')
  assert.ok(md.includes('zero-result'), 'summary section must mention zero-result count')
})

await test('parsed_snippets.md without warnings — no warnings block when all ok', async () => {
  const queries = [{ label: 'ok1', query: 'foo' }]
  const { results, stats } = await runSweep(queries, mockOk(2))
  const md = renderMarkdown(results, queries, stats)
  assert.ok(!md.includes('## ⚠️ Sweep warnings'), 'no warnings block when all ok')
})

console.log(`\n[smoke] ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
