// doesitlie Bench — statistics. Turns raw counts into defensible numbers:
//   - Wilson score interval     → a 95% CI on every rate ("1 in 5" becomes "1 in 5, 95% CI 1-in-4.2…1-in-6.4")
//   - χ² test of independence   → "does citation honesty actually differ by domain, or is it noise?"
//   - Cohen's κ (+ per-group)   → judge↔human agreement corrected for chance (the credibility anchor)
//   - Bootstrap CI (seeded)     → distribution-free CI for any statistic; deterministic via a seeded PRNG
//
// Pure, dependency-free, and tested against textbook critical values (see test/stats.test.js).
// No network, no fabrication — it only re-expresses counts that already exist in audit.json.

// ── log-gamma (Lanczos g=7, n=9) ─────────────────────────────────────────────
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
]
export function gammaln (x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaln(1 - x) // reflection
  x -= 1
  let a = LANCZOS[0]
  const t = x + 7.5
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

// ── regularized incomplete gamma P(a,x) and Q(a,x)=1-P (Numerical Recipes gser/gcf) ──
const ITMAX = 300
const EPS = 3e-12
const FPMIN = 1e-300
function gser (a, x) { // series — converges fast for x < a+1
  if (x <= 0) return 0
  let ap = a
  let sum = 1 / a
  let del = sum
  for (let n = 0; n < ITMAX; n++) {
    ap++
    del *= x / ap
    sum += del
    if (Math.abs(del) < Math.abs(sum) * EPS) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaln(a))
}
function gcf (a, x) { // continued fraction → Q(a,x) — converges fast for x >= a+1
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i < ITMAX; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h
}
/** Regularized lower incomplete gamma P(a,x) ∈ [0,1]. */
export function gammp (a, x) {
  if (x < 0 || a <= 0) return NaN
  return x < a + 1 ? gser(a, x) : 1 - gcf(a, x)
}
/** Upper tail Q(a,x) = 1 - P(a,x). */
export function gammq (a, x) {
  if (x < 0 || a <= 0) return NaN
  return x < a + 1 ? 1 - gser(a, x) : gcf(a, x)
}

/**
 * χ² survival function: P(X > chi2) for X ~ chi-square with `df` degrees of freedom.
 * This is the p-value for a χ² statistic. Anchored in tests: χ²=3.8415,df=1 → 0.05.
 */
export function chiSquarePValue (chi2, df) {
  if (!(chi2 >= 0) || !(df > 0)) return NaN
  if (chi2 === 0) return 1
  return gammq(df / 2, chi2 / 2)
}

/**
 * Wilson score interval for a binomial proportion — the correct CI for rates near 0/1
 * and small n (the normal/Wald interval breaks there). Default z=1.96 → 95%.
 * @returns {{point:number, low:number, high:number, n:number, k:number, z:number}}
 */
export function wilsonInterval (k, n, z = 1.96) {
  if (n <= 0) return { point: 0, low: 0, high: 0, n: 0, k: 0, z }
  const phat = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (phat + z2 / (2 * n)) / denom
  const margin = (z / denom) * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)
  return { point: phat, low: Math.max(0, center - margin), high: Math.min(1, center + margin), n, k, z }
}

/**
 * χ² test of independence over an R×C contingency table (array of rows of observed counts).
 * Use it for "verdict × domain": are the verdict distributions the same across domains?
 * Returns Cramér's V as a magnitude-of-association effect size (χ² alone scales with n).
 * @returns {{chi2,df,pValue,cramersV,n,expected,minExpected,lowExpectedCells}}
 */
export function chiSquareIndependence (table) {
  const rows = table.length
  const cols = rows ? table[0].length : 0
  if (rows < 2 || cols < 2) return { chi2: NaN, df: 0, pValue: NaN, cramersV: NaN, n: 0, expected: [], minExpected: NaN, lowExpectedCells: 0 }
  const rowSum = table.map(r => r.reduce((a, b) => a + b, 0))
  const colSum = Array.from({ length: cols }, (_, j) => table.reduce((a, r) => a + r[j], 0))
  const n = rowSum.reduce((a, b) => a + b, 0)
  if (n === 0) return { chi2: NaN, df: (rows - 1) * (cols - 1), pValue: NaN, cramersV: NaN, n: 0, expected: [], minExpected: NaN, lowExpectedCells: 0 }
  const expected = table.map((r, i) => r.map((_, j) => rowSum[i] * colSum[j] / n))
  let chi2 = 0
  let minExpected = Infinity
  let lowExpectedCells = 0
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const e = expected[i][j]
      minExpected = Math.min(minExpected, e)
      if (e < 5) lowExpectedCells++
      if (e > 0) chi2 += (table[i][j] - e) ** 2 / e
    }
  }
  const df = (rows - 1) * (cols - 1)
  const pValue = chiSquarePValue(chi2, df)
  // Cramér's V ∈ [0,1]: χ² normalized by n and the smaller table dimension.
  const cramersV = Math.sqrt(chi2 / (n * Math.min(rows - 1, cols - 1)))
  return { chi2, df, pValue, cramersV, n, expected, minExpected, lowExpectedCells }
}

/**
 * Cohen's κ over [labelA, labelB] pairs — agreement corrected for chance.
 * Mirrors bench/agreement.js so the published κ and any new κ use one implementation.
 * >0.6 substantial, >0.8 near-perfect.
 */
export function cohenKappa (pairs) {
  const n = pairs.length
  if (!n) return null
  const cats = [...new Set(pairs.flat())]
  let po = 0
  for (const [a, b] of pairs) if (a === b) po++
  po /= n
  const ca = {}; const cb = {}
  for (const c of cats) { ca[c] = 0; cb[c] = 0 }
  for (const [a, b] of pairs) { ca[a]++; cb[b]++ }
  let pe = 0
  for (const c of cats) pe += (ca[c] / n) * (cb[c] / n)
  return pe >= 1 ? 1 : (po - pe) / (1 - pe)
}

/** Cohen's κ split by a grouping key. pairs: [{a,b,group}] → { group: {n, kappa} }. */
export function kappaByGroup (taggedPairs) {
  const byG = new Map()
  for (const { a, b, group } of taggedPairs) {
    const g = group ?? '(none)'
    if (!byG.has(g)) byG.set(g, [])
    byG.get(g).push([a, b])
  }
  const out = {}
  for (const [g, ps] of byG) out[g] = { n: ps.length, kappa: cohenKappa(ps) }
  return out
}

// ── seeded PRNG (mulberry32) → bootstrap is deterministic run-to-run ─────────
export function mulberry32 (seed) {
  let s = seed >>> 0
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Percentile bootstrap CI for an arbitrary statistic over a sample array.
 * Deterministic: resampling is driven by a seeded PRNG (default seed 1).
 * @param {Array} sample
 * @param {(resample:Array)=>number} statFn
 * @param {{iters?:number, alpha?:number, seed?:number}} [opts]
 * @returns {{point:number, low:number, high:number, iters:number}}
 */
export function bootstrapCI (sample, statFn, { iters = 2000, alpha = 0.05, seed = 1 } = {}) {
  const n = sample.length
  if (n === 0) return { point: NaN, low: NaN, high: NaN, iters: 0 }
  const rng = mulberry32(seed)
  const stats = new Array(iters)
  const resample = new Array(n)
  for (let b = 0; b < iters; b++) {
    for (let i = 0; i < n; i++) resample[i] = sample[(rng() * n) | 0]
    stats[b] = statFn(resample)
  }
  stats.sort((x, y) => x - y)
  const lo = stats[Math.max(0, Math.floor((alpha / 2) * iters))]
  const hi = stats[Math.min(iters - 1, Math.ceil((1 - alpha / 2) * iters) - 1)]
  return { point: statFn(sample), low: lo, high: hi, iters }
}

/**
 * Headline helper: given "k of n not fully supported", return the "1 in X" rate with a
 * Wilson CI expressed BOTH as a proportion and as the inverted "1 in X" the site headlines.
 */
export function oneInWithCI (k, n, z = 1.96) {
  const w = wilsonInterval(k, n, z)
  const inv = p => (p > 0 ? +(1 / p).toFixed(1) : null)
  return {
    k, n,
    pct: +(w.point * 100).toFixed(1),
    oneIn: inv(w.point),
    ci: {
      pctLow: +(w.low * 100).toFixed(1), pctHigh: +(w.high * 100).toFixed(1),
      // inverting flips the order: a HIGHER rate → a SMALLER "1 in X"
      oneInLow: inv(w.high), oneInHigh: inv(w.low)
    }
  }
}
