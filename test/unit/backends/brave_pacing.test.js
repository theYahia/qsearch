// Outbound pacing + 429 backoff for Brave (A4).
//
// Before this there was NO outbound limiter anywhere: concurrency was the only brake, the
// sweep Semaphore is per-runSweep-call (N concurrent /sweep → N×6 slots), and /search,
// /news and /context sat outside it entirely. A 429 was simply thrown away.

import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { retryDelayMs, _resetPacing } from '../../../src/backends/brave.js'

// Header bag shaped like fetch's Headers (case-insensitive get).
const H = obj => ({ get: k => obj[k.toLowerCase()] ?? null })

describe('retryDelayMs — obey Brave before guessing', () => {
  beforeEach(() => _resetPacing())

  test('Retry-After in seconds wins', () => {
    assert.equal(retryDelayMs(H({ 'retry-after': '3' }), 0), 3000)
  })

  test('Retry-After: 0 is honoured, not treated as missing', () => {
    // `Number('0') || fallback` would silently discard this.
    assert.equal(retryDelayMs(H({ 'retry-after': '0' }), 5), 0)
  })

  test('Retry-After as an HTTP date becomes a delay', () => {
    const when = new Date(Date.now() + 4000).toUTCString()
    const d = retryDelayMs(H({ 'retry-after': when }), 0)
    assert.ok(d > 2000 && d <= 5000, `expected ~4000, got ${d}`)
  })

  test('a past HTTP date clamps to zero rather than going negative', () => {
    const past = new Date(Date.now() - 60_000).toUTCString()
    assert.equal(retryDelayMs(H({ 'retry-after': past }), 0), 0)
  })

  test('falls back to X-RateLimit-Reset', () => {
    assert.equal(retryDelayMs(H({ 'x-ratelimit-reset': '2' }), 0), 2500)
  })

  test('X-RateLimit-Reset may be a comma list — take the first window', () => {
    assert.equal(retryDelayMs(H({ 'x-ratelimit-reset': '1, 3600' }), 0), 1500)
  })

  test('with no usable header, backs off exponentially', () => {
    assert.equal(retryDelayMs(H({}), 0), 1000)
    assert.equal(retryDelayMs(H({}), 1), 2000)
    assert.equal(retryDelayMs(H({}), 3), 8000)
  })

  test('never waits longer than 30s, however large the header', () => {
    assert.equal(retryDelayMs(H({ 'retry-after': '99999' }), 0), 30_000)
    assert.equal(retryDelayMs(H({}), 20), 30_000)
  })

  test('garbage headers do not throw and do not produce NaN', () => {
    for (const bad of [{ 'retry-after': 'soon' }, { 'x-ratelimit-reset': 'x' }, {}]) {
      const d = retryDelayMs(H(bad), 0)
      assert.ok(Number.isFinite(d) && d >= 0, `bad header ${JSON.stringify(bad)} → ${d}`)
    }
    // A plain object (no .get) must also be tolerated.
    assert.ok(Number.isFinite(retryDelayMs({ 'retry-after': '1' }, 0)))
    assert.ok(Number.isFinite(retryDelayMs(null, 0)))
  })
})

describe('braveFetch param serialisation', () => {
  // Guards the goggles bug: url.searchParams.set(k, String(['a','b'])) yields "a,b",
  // which Brave reads as ONE goggle rather than two.
  test('arrays append as repeated params instead of joining with commas', () => {
    const url = new URL('https://example.com/')
    const params = { goggles: ['https://a.example/g1', 'https://b.example/g2'], count: 20 }
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue
      if (Array.isArray(v)) { for (const item of v) if (item != null) url.searchParams.append(k, String(item)) } else { url.searchParams.set(k, String(v)) }
    }
    assert.deepEqual(url.searchParams.getAll('goggles'), ['https://a.example/g1', 'https://b.example/g2'])
    assert.ok(!url.toString().includes('g1%2Chttps'), 'must not be comma-joined')
    assert.equal(url.searchParams.get('count'), '20')
  })
})
