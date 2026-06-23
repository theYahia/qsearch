// Tests for the corpus circuit breaker. Clock is injected so state transitions are deterministic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CircuitBreaker, withTimeout } from '../../../src/corpus/circuit_breaker.js'

const fail = () => { throw new Error('backend down') }
const ok = v => () => v

test('closed circuit returns the real result and resets failures', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3 })
  assert.equal(await cb.run(ok('hit'), 'fb'), 'hit')
  assert.equal(cb.state, 'closed')
  assert.equal(cb.failures, 0)
})

test('failures return the fallback (never throw) and open after the threshold', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 })
  assert.equal(await cb.run(fail, 'fb'), 'fb') // 1
  assert.equal(cb.state, 'closed')
  assert.equal(await cb.run(fail, 'fb'), 'fb') // 2
  assert.equal(await cb.run(fail, 'fb'), 'fb') // 3 → trips
  assert.equal(cb.state, 'open')
  assert.equal(cb.trips, 1)
})

test('open circuit skips fn entirely (fast fallback) during cooldown', async () => {
  let t = 1000
  const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5000, now: () => t })
  await cb.run(fail, 'fb') // trips immediately (threshold 1)
  assert.equal(cb.state, 'open')
  let called = false
  const r = await cb.run(() => { called = true; return 'real' }, 'fb')
  assert.equal(r, 'fb')
  assert.equal(called, false, 'fn must NOT run while the circuit is open in cooldown')
})

test('half-open after cooldown: success closes, failure re-opens', async () => {
  let t = 1000
  const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5000, now: () => t })
  await cb.run(fail, 'fb') // open at t=1000
  t = 6500 // cooldown elapsed
  // a successful probe closes the circuit
  assert.equal(await cb.run(ok('recovered'), 'fb'), 'recovered')
  assert.equal(cb.state, 'closed')
  // re-open, then a FAILED probe must re-open immediately (not wait for threshold)
  t = 7000; await cb.run(fail, 'fb'); assert.equal(cb.state, 'open')
  t = 13000; assert.equal(await cb.run(fail, 'fb'), 'fb'); assert.equal(cb.state, 'open')
})

test('timeout counts as a failure and yields the fallback', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, timeoutMs: 20 })
  const slow = () => new Promise(res => setTimeout(() => res('too late'), 200))
  const r = await cb.run(slow, 'fb')
  assert.equal(r, 'fb')
  assert.equal(cb.state, 'open')
})

test('withTimeout resolves fast path and supports a resolving onTimeout', async () => {
  assert.equal(await withTimeout(Promise.resolve('quick'), 50), 'quick')
  const slow = new Promise(res => setTimeout(() => res('late'), 100))
  assert.equal(await withTimeout(slow, 10, () => 'fallback'), 'fallback')
  assert.equal(await withTimeout('plain-value', 0), 'plain-value') // ms<=0 disables
})
