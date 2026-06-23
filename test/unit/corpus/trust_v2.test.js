// Trust formula v2 candidate + dispatcher. Pins the two properties v2 was designed for
// (no zero-collapse, diminishing returns) and that the default dispatch stays v1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeTrust, computeTrustV1, computeTrustV2, TRUST_VARIANT } from '../../../src/corpus/trust.js'

test('v1 collapses to 0 when engineDiversity is 0 (the documented defect)', () => {
  const f = { sweepCount: 9, engineDiversity: 0, topicDiversity: 3 }
  assert.equal(computeTrustV1(f), 0) // log(10)·0·3 = 0
})

test('v2 does NOT collapse — a multi-sweep, zero-engine URL still scores > 0', () => {
  const f = { sweepCount: 9, engineDiversity: 0, topicDiversity: 3 }
  const t = computeTrustV2(f)
  assert.ok(t > 0, `expected >0, got ${t}`)
  // log(10) · (1+ln1) · (1+ln4) = log(10)·1·(1+1.3863)
  assert.ok(Math.abs(t - Math.log(10) * 1 * (1 + Math.log1p(3))) < 1e-9)
})

test('v2 has diminishing returns on engine diversity (sub-linear)', () => {
  const base = { sweepCount: 5, topicDiversity: 1 }
  const t4 = computeTrustV2({ ...base, engineDiversity: 4 })
  const t8 = computeTrustV2({ ...base, engineDiversity: 8 })
  // doubling engines must increase trust by LESS than 2× (v1 would be exactly 2×)
  assert.ok(t8 / t4 < 2, `expected sub-linear, got ratio ${(t8 / t4).toFixed(3)}`)
  assert.ok(t8 > t4, 'more diversity should still increase trust')
})

test('v1 is exactly linear in engine diversity (contrast)', () => {
  const base = { sweepCount: 5, topicDiversity: 1 }
  const t4 = computeTrustV1({ ...base, engineDiversity: 4 })
  const t8 = computeTrustV1({ ...base, engineDiversity: 8 })
  assert.ok(Math.abs(t8 / t4 - 2) < 1e-9)
})

test('dispatcher defaults to v1 and honors opts.variant', () => {
  const f = { sweepCount: 7, engineDiversity: 3, topicDiversity: 2 }
  assert.equal(TRUST_VARIANT, 'v1') // default env in test
  assert.equal(computeTrust(f), computeTrustV1(f))
  assert.equal(computeTrust(f, { variant: 'v2' }), computeTrustV2(f))
  assert.notEqual(computeTrustV1(f), computeTrustV2(f)) // they genuinely differ here
})

test('decay applies to both variants identically (factor, not formula)', () => {
  const f = { sweepCount: 5, engineDiversity: 3, topicDiversity: 2, daysSinceLastSeen: 10 }
  const k = 0.05
  const decay = Math.exp(-k * 10)
  assert.ok(Math.abs(computeTrustV1(f, { decayK: k }) - computeTrustV1({ ...f, daysSinceLastSeen: 0 }, { decayK: k }) * decay) < 1e-9)
  assert.ok(Math.abs(computeTrustV2(f, { decayK: k }) - computeTrustV2({ ...f, daysSinceLastSeen: 0 }, { decayK: k }) * decay) < 1e-9)
})
