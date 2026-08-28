import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeTrust, topicOf, topicDiversity, daysSince, latestCrawledAt } from '../../../src/corpus/trust.js'

describe('trust — computeTrust', () => {
  test('base formula = log(sweeps+1) * engines * topics', () => {
    const v = computeTrust({ sweepCount: 3, engineDiversity: 4, topicDiversity: 2 })
    assert.ok(Math.abs(v - Math.log(4) * 4 * 2) < 1e-9)
  })

  test('topic_diversity defaults to 1 when missing (never zeroes the score)', () => {
    const v = computeTrust({ sweepCount: 3, engineDiversity: 4 })
    assert.ok(Math.abs(v - Math.log(4) * 4 * 1) < 1e-9)
  })

  test('consistent regardless of how it is called (the topByTrust bug invariant)', () => {
    const fields = { sweepCount: 5, engineDiversity: 3, topicDiversity: 2 }
    // The same fields must always produce the same score — this is what the
    // sort=trust vs sort=engine_count branches violated before unification.
    assert.equal(computeTrust(fields), computeTrust({ ...fields }))
  })

  test('decay off by default (k=0) → no time effect', () => {
    const a = computeTrust({ sweepCount: 3, engineDiversity: 2, topicDiversity: 1, daysSinceLastSeen: 400 })
    const b = computeTrust({ sweepCount: 3, engineDiversity: 2, topicDiversity: 1, daysSinceLastSeen: 0 })
    assert.equal(a, b)
  })

  test('decay on (k>0) → fresh url scores higher than stale at equal counts', () => {
    const fresh = computeTrust({ sweepCount: 3, engineDiversity: 2, topicDiversity: 1, daysSinceLastSeen: 0 }, { decayK: 0.01 })
    const stale = computeTrust({ sweepCount: 3, engineDiversity: 2, topicDiversity: 1, daysSinceLastSeen: 180 }, { decayK: 0.01 })
    assert.ok(fresh > stale)
    assert.ok(Math.abs(stale - fresh * Math.exp(-0.01 * 180)) < 1e-9)
  })
})

describe('trust — topicOf / topicDiversity', () => {
  test('topicOf takes the snake_case prefix', () => {
    assert.equal(topicOf('russia_smb_q1'), 'russia')
    assert.equal(topicOf('single'), 'single')
    assert.equal(topicOf(''), null)
    assert.equal(topicOf(null), null)
  })

  test('topicDiversity counts distinct prefixes', () => {
    assert.equal(topicDiversity(['russia_a', 'russia_b', 'china_a']), 2)
    assert.equal(topicDiversity([]), 0)
    assert.equal(topicDiversity(['x_1', null, undefined, 'x_2']), 1)
  })
})

describe('trust — daysSince / latestCrawledAt', () => {
  test('daysSince computes whole-day distance, clamps to >=0', () => {
    const now = Date.parse('2026-06-23T00:00:00Z')
    assert.equal(daysSince('2026-06-13T00:00:00Z', now), 10)
    assert.equal(daysSince(null, now), null)
    assert.equal(daysSince('not-a-date', now), null)
    assert.equal(daysSince('2026-07-01T00:00:00Z', now), 0) // future clamps to 0
  })

  test('latestCrawledAt picks the most recent entry', () => {
    const entries = [
      { crawled_at: '2026-01-01T00:00:00Z' },
      { crawled_at: '2026-06-01T00:00:00Z' },
      { crawled_at: '2026-03-01T00:00:00Z' }
    ]
    assert.equal(latestCrawledAt(entries), '2026-06-01T00:00:00Z')
    assert.equal(latestCrawledAt([]), null)
  })
})
