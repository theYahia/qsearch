import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter, parseLimits } from '../../../src/middleware/ratelimit.js'

describe('ratelimit — parseLimits', () => {
  test('parses route=limit pairs', () => {
    assert.deepEqual(parseLimits('/index=10,/search=100'), { '/index': 10, '/search': 100 })
  })
  test('ignores malformed entries', () => {
    assert.deepEqual(parseLimits('/index=abc,/search=50'), { '/search': 50 })
  })
})

describe('ratelimit — createRateLimiter', () => {
  test('allows up to the limit, blocks the next', () => {
    const rl = createRateLimiter({ windowMs: 1000, limits: { '/index': 3 } })
    const now = 1_000_000
    assert.equal(rl.check('1.1.1.1', '/index', now).ok, true)   // 1
    assert.equal(rl.check('1.1.1.1', '/index', now).ok, true)   // 2
    assert.equal(rl.check('1.1.1.1', '/index', now).ok, true)   // 3
    const blocked = rl.check('1.1.1.1', '/index', now)          // 4 → over
    assert.equal(blocked.ok, false)
    assert.equal(blocked.limit, 3)
    assert.ok(blocked.retryAfterMs > 0)
  })

  test('unlimited route (no limit) always ok', () => {
    const rl = createRateLimiter({ windowMs: 1000, limits: { '/index': 1 } })
    const now = 2_000_000
    for (let i = 0; i < 5; i++) assert.equal(rl.check('2.2.2.2', '/health', now).ok, true)
  })

  test('separate buckets per IP', () => {
    const rl = createRateLimiter({ windowMs: 1000, limits: { '/index': 1 } })
    const now = 3_000_000
    assert.equal(rl.check('1.1.1.1', '/index', now).ok, true)
    assert.equal(rl.check('1.1.1.1', '/index', now).ok, false)
    assert.equal(rl.check('2.2.2.2', '/index', now).ok, true) // different IP, fresh bucket
  })

  test('window resets after windowMs', () => {
    const rl = createRateLimiter({ windowMs: 1000, limits: { '/index': 1 } })
    const t0 = 4_000_000
    assert.equal(rl.check('1.1.1.1', '/index', t0).ok, true)
    assert.equal(rl.check('1.1.1.1', '/index', t0).ok, false)
    assert.equal(rl.check('1.1.1.1', '/index', t0 + 1001).ok, true) // new window
  })
})
