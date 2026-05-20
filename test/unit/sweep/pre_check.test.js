// rd277: unit coverage for runPreSweepCheck. meiliIndex is stubbed — no real
// Meilisearch required. Each test constructs hits with controlled engine_count
// and crawled_at, then asserts the verdict + skip recommendation logic.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { runPreSweepCheck } from '../../../src/sweep/pre_check.js'

const ISO_NOW = () => new Date().toISOString()
const ISO_AGO_DAYS = (days) => new Date(Date.now() - days * 86400_000).toISOString()

function stubIndex (hitsByQuery) {
  return {
    async search (q) {
      const hits = hitsByQuery[q] ?? hitsByQuery['*'] ?? []
      return { hits }
    }
  }
}

function freshHit (engineCount = 4) {
  return { url: `https://h${Math.random()}.com`, engine_count: engineCount, crawled_at: ISO_NOW() }
}

function staleHit (daysOld = 30, engineCount = 4) {
  return { url: `https://h${Math.random()}.com`, engine_count: engineCount, crawled_at: ISO_AGO_DAYS(daysOld) }
}

describe('runPreSweepCheck — empty input', () => {
  test('empty queries returns no_queries recommendation', async () => {
    const out = await runPreSweepCheck({ queries: [] }, stubIndex({}))
    assert.equal(out.skip_sweep, false)
    assert.equal(out.recommendation, 'no_queries')
    assert.deepEqual(out.coverage, [])
  })

  test('whitespace-only queries are filtered', async () => {
    const out = await runPreSweepCheck({ queries: ['  ', '', '\t'] }, stubIndex({}))
    assert.equal(out.recommendation, 'no_queries')
  })
})

describe('runPreSweepCheck — verdict thresholds', () => {
  test('5+ fresh high-trust hits → covered', async () => {
    const idx = stubIndex({ q1: [freshHit(4), freshHit(4), freshHit(4), freshHit(4), freshHit(4)] })
    const out = await runPreSweepCheck({ queries: ['q1'] }, idx)
    assert.equal(out.coverage[0].verdict, 'covered')
    assert.equal(out.coverage[0].fresh_high_trust, 5)
  })

  test('1-4 fresh high-trust hits → partial', async () => {
    const idx = stubIndex({ q1: [freshHit(4), freshHit(4)] })
    const out = await runPreSweepCheck({ queries: ['q1'] }, idx)
    assert.equal(out.coverage[0].verdict, 'partial')
    assert.equal(out.coverage[0].fresh_high_trust, 2)
  })

  test('0 fresh high-trust hits → miss', async () => {
    const idx = stubIndex({ q1: [freshHit(1), freshHit(2)] }) // low engine_count
    const out = await runPreSweepCheck({ queries: ['q1'] }, idx)
    assert.equal(out.coverage[0].verdict, 'miss')
    assert.equal(out.coverage[0].fresh_high_trust, 0)
  })

  test('empty hits → miss', async () => {
    const out = await runPreSweepCheck({ queries: ['q1'] }, stubIndex({}))
    assert.equal(out.coverage[0].verdict, 'miss')
    assert.equal(out.coverage[0].corpus_hits, 0)
  })
})

describe('runPreSweepCheck — freshness filter', () => {
  test('stale hits (older than freshness_days) do not count as fresh', async () => {
    const idx = stubIndex({ q1: [staleHit(30), staleHit(30), staleHit(30), staleHit(30), staleHit(30)] })
    const out = await runPreSweepCheck({ queries: ['q1'], freshness_days: 7 }, idx)
    assert.equal(out.coverage[0].verdict, 'miss')
    assert.equal(out.coverage[0].fresh_hits, 0)
    assert.equal(out.coverage[0].corpus_hits, 5) // they're still corpus hits, just not fresh
  })

  test('freshness_days=999 makes 30-day-old hits count as fresh', async () => {
    const idx = stubIndex({ q1: [staleHit(30), staleHit(30), staleHit(30), staleHit(30), staleHit(30)] })
    const out = await runPreSweepCheck({ queries: ['q1'], freshness_days: 999 }, idx)
    assert.equal(out.coverage[0].fresh_hits, 5)
    assert.equal(out.coverage[0].verdict, 'covered')
  })
})

describe('runPreSweepCheck — overall recommendation', () => {
  test('all covered + coverage ≥ threshold → skip_sweep', async () => {
    const hits = Array.from({ length: 5 }, () => freshHit(4))
    const idx = stubIndex({ '*': hits })
    const out = await runPreSweepCheck({ queries: ['a', 'b', 'c'], overlap_threshold: 0.5 }, idx)
    assert.equal(out.skip_sweep, true)
    assert.equal(out.recommendation, 'skip_sweep')
    assert.equal(out.skip_queries.length, 3)
    assert.equal(out.overall_coverage, 1)
  })

  test('mixed covered + miss → partial_sweep', async () => {
    const fresh = Array.from({ length: 5 }, () => freshHit(4))
    const idx = stubIndex({ a: fresh, b: [] })
    const out = await runPreSweepCheck({ queries: ['a', 'b'], overlap_threshold: 0.6 }, idx)
    assert.equal(out.skip_sweep, false)
    assert.equal(out.recommendation, 'partial_sweep')
    assert.deepEqual(out.skip_queries, ['a'])
    assert.equal(out.overall_coverage, 0.5)
  })

  test('no coverage → run_sweep', async () => {
    const out = await runPreSweepCheck({ queries: ['a', 'b'] }, stubIndex({}))
    assert.equal(out.skip_sweep, false)
    assert.equal(out.recommendation, 'run_sweep')
    assert.deepEqual(out.skip_queries, [])
  })
})

describe('runPreSweepCheck — error handling', () => {
  test('meili.search throw produces miss verdict with error field, not crash', async () => {
    const idx = { search: async () => { throw new Error('meili down') } }
    const out = await runPreSweepCheck({ queries: ['q1', 'q2'] }, idx)
    assert.equal(out.coverage.length, 2)
    for (const c of out.coverage) {
      assert.equal(c.verdict, 'miss')
      assert.equal(c.corpus_hits, 0)
      assert.match(c.error, /meili down/)
    }
    assert.equal(out.recommendation, 'run_sweep')
  })
})
