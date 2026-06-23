// Tests for bench/stats.js — anchored to textbook critical values so a wrong formula fails loudly.
// Run: node --test doesitlie/bench/test/stats.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gammaln, gammp, gammq, chiSquarePValue, wilsonInterval,
  chiSquareIndependence, cohenKappa, kappaByGroup, mulberry32, bootstrapCI, oneInWithCI
} from '../stats.js'

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (tol ${tol})`)

test('gammaln matches known values', () => {
  near(gammaln(1), 0, 1e-9)          // Γ(1)=1 → ln=0
  near(gammaln(2), 0, 1e-9)          // Γ(2)=1
  near(gammaln(5), Math.log(24), 1e-7) // Γ(5)=4!=24
  near(gammaln(0.5), Math.log(Math.sqrt(Math.PI)), 1e-7) // Γ(0.5)=√π
})

test('gammp + gammq sum to 1', () => {
  for (const [a, x] of [[2, 1], [3, 5], [0.5, 0.5], [10, 12]]) {
    near(gammp(a, x) + gammq(a, x), 1, 1e-9)
  }
})

test('chiSquarePValue hits textbook critical values', () => {
  // p=0.05 critical values
  near(chiSquarePValue(3.8414588, 1), 0.05, 2e-4)
  near(chiSquarePValue(5.991465, 2), 0.05, 2e-4)
  near(chiSquarePValue(7.814728, 3), 0.05, 2e-4)
  // p=0.01 / 0.001
  near(chiSquarePValue(6.634897, 1), 0.01, 2e-4)
  near(chiSquarePValue(10.82757, 1), 0.001, 2e-4)
  // edges
  assert.equal(chiSquarePValue(0, 1), 1)
  assert.ok(chiSquarePValue(1000, 1) < 1e-6)
})

test('wilsonInterval — 10/100 textbook', () => {
  const w = wilsonInterval(10, 100)
  near(w.point, 0.10, 1e-12)
  // statsmodels proportion_confint(10,100,method='wilson') → [0.05522, 0.17437]
  near(w.low, 0.05522, 1e-3)
  near(w.high, 0.17437, 1e-3)
  assert.ok(w.low > 0 && w.high < 1)
})

test('wilsonInterval — degenerate cases stay in [0,1]', () => {
  const z = wilsonInterval(0, 0); assert.equal(z.point, 0)
  const all = wilsonInterval(20, 20); assert.ok(all.high <= 1 && all.low > 0)
  const none = wilsonInterval(0, 20); assert.ok(none.low === 0 && none.high < 1)
})

test('chiSquareIndependence — known 2×2 table', () => {
  // [[10,20],[20,10]]: expected all 15, χ²=6.6667, df=1, Cramér V=1/3
  const r = chiSquareIndependence([[10, 20], [20, 10]])
  near(r.chi2, 6.6667, 1e-3)
  assert.equal(r.df, 1)
  near(r.cramersV, 1 / 3, 1e-3)
  assert.ok(r.pValue > 0.009 && r.pValue < 0.011, `p=${r.pValue}`)
  assert.equal(r.n, 60)
})

test('chiSquareIndependence — independent table gives χ²≈0, p≈1', () => {
  const r = chiSquareIndependence([[10, 10], [10, 10]])
  near(r.chi2, 0, 1e-9)
  assert.equal(r.pValue, 1)
  near(r.cramersV, 0, 1e-9)
})

test('chiSquareIndependence — low expected-count guard flags small cells', () => {
  const r = chiSquareIndependence([[1, 2], [2, 1]]) // every expected < 5
  assert.equal(r.lowExpectedCells, 4)
  assert.ok(r.minExpected < 5)
})

test('cohenKappa — chance agreement gives 0, perfect gives 1', () => {
  near(cohenKappa([['A', 'A'], ['A', 'B'], ['B', 'A'], ['B', 'B']]), 0, 1e-9)
  assert.equal(cohenKappa([['A', 'A'], ['B', 'B'], ['A', 'A']]), 1)
  assert.equal(cohenKappa([]), null)
})

test('kappaByGroup splits pairs by group', () => {
  const out = kappaByGroup([
    { a: 'A', b: 'A', group: 'legal' }, { a: 'B', b: 'B', group: 'legal' },
    { a: 'A', b: 'B', group: 'tech' }, { a: 'B', b: 'A', group: 'tech' }
  ])
  assert.equal(out.legal.n, 2)
  assert.equal(out.legal.kappa, 1)
  assert.equal(out.tech.n, 2)
})

test('mulberry32 is deterministic for a given seed', () => {
  const r1 = mulberry32(42); const r2 = mulberry32(42)
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2())
  assert.notEqual(mulberry32(1)(), mulberry32(2)())
})

test('bootstrapCI is deterministic and brackets the point estimate', () => {
  const sample = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? 1 : 0)) // mean 0.2
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length
  const a = bootstrapCI(sample, mean, { iters: 1000, seed: 7 })
  const b = bootstrapCI(sample, mean, { iters: 1000, seed: 7 })
  assert.deepEqual(a, b)                  // same seed → identical
  near(a.point, 0.2, 1e-9)
  assert.ok(a.low <= a.point && a.point <= a.high)
  assert.ok(a.low >= 0 && a.high <= 1)
})

test('oneInWithCI inverts rate to "1 in X" with correct CI ordering', () => {
  const o = oneInWithCI(40, 199)
  near(o.pct, 20.1, 0.1)
  near(o.oneIn, 5.0, 0.1)
  // a higher rate → a smaller "1 in X": oneInLow corresponds to ci.pctHigh
  assert.ok(o.ci.oneInLow < o.oneIn && o.oneIn < o.ci.oneInHigh)
  assert.ok(o.ci.pctLow < o.pct && o.pct < o.ci.pctHigh)
})
