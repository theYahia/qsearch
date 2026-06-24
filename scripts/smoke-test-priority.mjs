#!/usr/bin/env node
// Smoke test for Phase 2 priority routing — verifies parseQueriesText 3-field syntax,
// runSweep router-style dispatch, and per-priority stats aggregation.
//
// Run:  node scripts/smoke-test-priority.mjs
// Exit: 0 = all pass, 1 = any failure

import { parseQueriesText, runSweep, VALID_PRIORITIES } from '../src/sweep/runner.js'
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

console.log('\n[smoke] Phase 2 priority routing\n')

// ── parseQueriesText ───────────────────────────────────────────────

await test('parseQueriesText: label|query|broad → priority=broad', async () => {
  const q = parseQueriesText('cluster_a|self-hosted vector DB|broad')
  assert.equal(q.length, 1)
  assert.deepEqual(q[0], { label: 'cluster_a', query: 'self-hosted vector DB', priority: 'broad' })
})

await test('parseQueriesText: label|query|focused → priority=focused', async () => {
  const q = parseQueriesText('c2|qdrant vs weaviate|focused')
  assert.equal(q[0].priority, 'focused')
})

await test('parseQueriesText: label|query|critical → priority=critical', async () => {
  const q = parseQueriesText('c3|production qa 2026|critical')
  assert.equal(q[0].priority, 'critical')
})

await test('parseQueriesText: legacy 2-field → priority=broad (default)', async () => {
  const q = parseQueriesText('legacy|just a query')
  assert.deepEqual(q[0], { label: 'legacy', query: 'just a query', priority: 'broad' })
})

await test('parseQueriesText: unlabeled → auto-label + broad', async () => {
  const q = parseQueriesText('orphan query without label')
  assert.equal(q[0].label, 'q01')
  assert.equal(q[0].priority, 'broad')
})

await test('parseQueriesText: case-insensitive priority', async () => {
  const q = parseQueriesText('c|q|CRITICAL')
  assert.equal(q[0].priority, 'critical')
})

await test('parseQueriesText: invalid priority folds back into query', async () => {
  // Last part not in VALID_PRIORITIES → treat as part of query.
  const q = parseQueriesText('c|qdrant|notapriority')
  assert.equal(q[0].query, 'qdrant|notapriority')
  assert.equal(q[0].priority, 'broad')
})

await test('parseQueriesText: URL with | preserved when last part is real priority', async () => {
  const q = parseQueriesText('c|https://example.com/x|y|critical')
  assert.equal(q[0].query, 'https://example.com/x|y')
  assert.equal(q[0].priority, 'critical')
})

await test('parseQueriesText: comments and blank lines skipped', async () => {
  const q = parseQueriesText('# comment\n\nc|real|focused\n# another\n')
  assert.equal(q.length, 1)
  assert.equal(q[0].priority, 'focused')
})

await test('VALID_PRIORITIES exported set has expected members', async () => {
  assert.ok(VALID_PRIORITIES.has('broad'))
  assert.ok(VALID_PRIORITIES.has('focused'))
  assert.ok(VALID_PRIORITIES.has('critical'))
  assert.ok(!VALID_PRIORITIES.has('urgent'))
})

// ── runSweep router ────────────────────────────────────────────────

await test('runSweep: router-style fn dispatches different backends per priority', async () => {
  const queries = [
    { label: 'b1', query: 'broad query', priority: 'broad' },
    { label: 'f1', query: 'focused query', priority: 'focused' },
    { label: 'c1', query: 'critical query', priority: 'critical' }
  ]
  const calls = { broad: 0, focused: 0, critical: 0 }
  const router = (priority) => async (endpoint, query, params) => {
    calls[priority]++
    return { data: { web: { results: [{ url: `https://x/${priority}`, title: priority, description: 'd' }] } } }
  }
  const { stats } = await runSweep(queries, router)
  assert.equal(calls.broad, 1)
  assert.equal(calls.focused, 1)
  assert.equal(calls.critical, 1)
  assert.equal(stats.web_ok, 3)
  assert.equal(stats.by_priority.broad.ok, 1)
  assert.equal(stats.by_priority.focused.ok, 1)
  assert.equal(stats.by_priority.critical.ok, 1)
})

await test('runSweep: legacy plain searchFn (3-arity) still works for all queries', async () => {
  let calls = 0
  const plainFn = async (endpoint, query, params) => {
    calls++
    return { data: { web: { results: [{ url: `https://legacy/${calls}`, title: 't' }] } } }
  }
  const queries = [
    { label: 'q1', query: 'one', priority: 'broad' },
    { label: 'q2', query: 'two', priority: 'focused' }
  ]
  const { stats } = await runSweep(queries, plainFn)
  assert.equal(calls, 2)
  assert.equal(stats.web_ok, 2)
  assert.equal(stats.by_priority.broad.ok, 1)
  assert.equal(stats.by_priority.focused.ok, 1)
})

await test('runSweep: missing priority defaults to broad in stats', async () => {
  // queries without priority key (legacy callers pre-Phase 2)
  const queries = [{ label: 'q1', query: 'no-priority' }]
  const fn = async () => ({ data: { web: { results: [{ url: 'https://a', title: 't' }] } } })
  const { stats } = await runSweep(queries, fn)
  assert.equal(stats.by_priority.broad.ok, 1)
  assert.equal(stats.by_priority.focused.ok, 0)
})

await test('runSweep: per-priority fail counts', async () => {
  const queries = [
    { label: 'b', query: 'b', priority: 'broad' },
    { label: 'c', query: 'c', priority: 'critical' }
  ]
  const router = (priority) => async () => {
    if (priority === 'critical') throw new Error('brave down')
    return { data: { web: { results: [{ url: 'https://x', title: 't' }] } } }
  }
  const { stats } = await runSweep(queries, router)
  assert.equal(stats.by_priority.broad.ok, 1)
  assert.equal(stats.by_priority.critical.fail, 1)
})

await test('renderMarkdown: priority distribution shown in summary', async () => {
  const queries = [
    { label: 'b1', query: 'b', priority: 'broad' },
    { label: 'f1', query: 'f', priority: 'focused' }
  ]
  // Unique URL per query to avoid dedup zeroing out the second one
  const fn = async (endpoint, query) => ({
    data: { web: { results: [{ url: `https://x/${query}`, title: 't', description: 'd' }] } }
  })
  const { results, stats } = await runSweep(queries, fn)
  const md = renderMarkdown(results, queries, stats)
  assert.ok(md.includes('Priority:'), 'summary must include Priority line')
  assert.ok(md.includes('broad=1/1'), 'broad count must be visible')
  assert.ok(md.includes('focused=1/1'), 'focused count must be visible')
})

console.log(`\n[smoke] ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
