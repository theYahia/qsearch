#!/usr/bin/env node
// Smoke test for Phase 5 economy logger — verifies sprint_metrics schema, recordSprintMetric
// cost computation, and economyReport aggregation/filtering.
//
// Run:  node D:/Yahia/active/qsearch/scripts/smoke-test-economy.mjs
// Exit: 0 = all pass, 1 = any failure

import { QueryCache, COST_PER_CALL } from '../src/cache.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const tmp = mkdtempSync(join(tmpdir(), 'qsearch-economy-'))
const dbPath = join(tmp, 'test.db')
const cache = new QueryCache(dbPath)

let pass = 0, fail = 0
function test (name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++ }
  catch (err) { console.error(`  ✗ ${name}\n      ${err.message}`); fail++ }
}

console.log(`\n[smoke] Phase 5 economy at ${dbPath}\n`)

test('COST_PER_CALL: sane defaults — cache_hit/searxng/qsearch_local are $0', () => {
  assert.equal(COST_PER_CALL.cache_hit, 0)
  assert.equal(COST_PER_CALL.searxng, 0)
  assert.equal(COST_PER_CALL.qsearch_local, 0)
  assert.ok(COST_PER_CALL.brave_web > 0)
  assert.ok(COST_PER_CALL.brave_context > 0)
})

test('recordSprintMetric: cache_hit row → $0 cost', () => {
  const id = cache.recordSprintMetric({
    sprintId: 'sp-1', topic: 'topic-a', endpoint: '/cached_sweep',
    backend: 'cache_hit', queries: 50, cacheHits: 50
  })
  assert.ok(id > 0)
  const row = cache.db.prepare('SELECT * FROM sprint_metrics WHERE id = ?').get(id)
  assert.equal(row.cost_usd, 0)
  assert.equal(row.queries, 50)
  assert.equal(row.cache_hits, 50)
})

test('recordSprintMetric: brave_web row — cost = (queries - hits) × per_call', () => {
  const id = cache.recordSprintMetric({
    sprintId: 'sp-1', endpoint: '/sweep', priority: 'focused',
    backend: 'brave_web', queries: 30, cacheHits: 5
  })
  const row = cache.db.prepare('SELECT * FROM sprint_metrics WHERE id = ?').get(id)
  // Cost: 25 billable × $0.005 = $0.125
  const expected = 25 * COST_PER_CALL.brave_web
  assert.ok(Math.abs(row.cost_usd - expected) < 1e-6, `expected ${expected}, got ${row.cost_usd}`)
})

test('recordSprintMetric: brave_context row, no cache hits', () => {
  const id = cache.recordSprintMetric({
    sprintId: 'sp-1', endpoint: '/sweep', priority: 'critical',
    backend: 'brave_context', queries: 5
  })
  const row = cache.db.prepare('SELECT * FROM sprint_metrics WHERE id = ?').get(id)
  const expected = 5 * COST_PER_CALL.brave_context
  assert.ok(Math.abs(row.cost_usd - expected) < 1e-6)
})

test('recordSprintMetric: searxng broad row → $0', () => {
  cache.recordSprintMetric({
    sprintId: 'sp-1', endpoint: '/sweep', priority: 'broad',
    backend: 'searxng', queries: 100
  })
  const total = cache.db.prepare("SELECT SUM(cost_usd) AS c FROM sprint_metrics WHERE backend = 'searxng'").get()
  assert.equal(total.c, 0)
})

test('economyReport: aggregates total + by_backend + by_priority', () => {
  const r = cache.economyReport({})
  assert.ok(r.total.calls >= 4, `expected ≥4 calls, got ${r.total.calls}`)
  assert.ok(r.total.total_queries >= 185, 'total_queries should sum 50+30+5+100')
  assert.ok(r.by_backend.length >= 4, 'should split across cache_hit, brave_web, brave_context, searxng')
  // baseline = total_queries × ($0.005 + 0.1×$0.01) = 185 × $0.006 = $1.11
  const expectedBaseline = r.total.total_queries * (COST_PER_CALL.brave_web + 0.1 * COST_PER_CALL.brave_context)
  assert.ok(Math.abs(r.baseline_cost_all_brave - expectedBaseline) < 1e-6)
  assert.ok(r.savings_usd > 0, 'should show savings vs baseline')
})

test('economyReport: filter by sprint_id', () => {
  // Add row for different sprint
  cache.recordSprintMetric({ sprintId: 'sp-2', endpoint: '/sweep', backend: 'brave_web', queries: 1000 })
  const r1 = cache.economyReport({ sprintId: 'sp-1' })
  const r2 = cache.economyReport({ sprintId: 'sp-2' })
  assert.ok(r2.total.total_queries === 1000, `sp-2 should have exactly 1000 queries, got ${r2.total.total_queries}`)
  assert.ok(r1.total.total_queries < 1000, 'sp-1 should not include sp-2 1000 queries')
})

test('economyReport: filter by topic', () => {
  const r = cache.economyReport({ topic: 'topic-a' })
  // only the first cache_hit row had topic='topic-a'
  assert.equal(r.total.calls, 1)
  assert.equal(r.total.total_queries, 50)
})

test('economyReport: time-range filter', () => {
  const future = Date.now() + 86400_000  // tomorrow
  const r = cache.economyReport({ from: future })
  assert.equal(r.total.calls, 0, 'no rows in future')
})

test('schema migration is idempotent — re-open same db works', () => {
  cache.close()
  const cache2 = new QueryCache(dbPath)
  // sprint_metrics still has rows from prior session
  const r = cache2.economyReport({})
  assert.ok(r.total.calls >= 4)
  cache2.close()
})

rmSync(tmp, { recursive: true, force: true })
console.log(`\n[smoke] ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
