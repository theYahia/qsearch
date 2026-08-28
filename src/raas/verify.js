// qsearch RaaS — verification adapter.
//
// Thin wrapper over the canonical qsearch citation verifier (src/verifier/index.js — the same
// implementation the published doesitlie bench runs). RaaS does NOT reimplement verification, so
// a RaaS report inherits the bench's MEASURED judge↔human agreement (87.3% / κ=0.75 binary,
// doesitlie README) and its committed verdict cache (reproducible re-runs).

import { tierOf } from './tiers.js'

let _verifyImpl = null

/** Test seam: inject a fake verifyCitation. */
export function setVerifier (fn) { _verifyImpl = fn }

/**
 * Resolve the canonical verifyCitation. Lazy/dynamic so a test can inject a fake via setVerifier()
 * without loading the real judge stack.
 * @returns {Promise<(input: {claim: string, url: string}) => Promise<any>>}
 */
export async function loadVerifier () {
  if (_verifyImpl) return _verifyImpl
  const mod = await import('../verifier/index.js')
  _verifyImpl = mod.verifyCitation
  return _verifyImpl
}

/**
 * @typedef {Object} Candidate
 * @property {string} url
 * @property {string} [title]
 * @property {number} [engine_count]
 */

/** Bounded-concurrency map (the judge call is the expensive part). */
async function mapLimit (items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx) }
  }))
  return out
}

/**
 * Verify one claim against all its candidate sources, attaching each source's tier.
 * Fabricated/Error verdicts are RETURNED, not dropped — the receipt shows coverage honestly.
 *
 * @param {string} claim
 * @param {Candidate[]} candidates
 * @param {{ concurrency?: number }} [opts]
 * @returns {Promise<import('./triangulate.js').VerifiedSource[]>}
 */
export async function verifyClaim (claim, candidates, opts = {}) {
  const verify = await loadVerifier()
  const limit = opts.concurrency ?? 4
  return mapLimit(candidates, limit, async (c) => {
    const r = await verify({ claim, url: c.url })
    return {
      source_url: c.url,
      verdict: r.verdict,
      evidence: r.evidence || '',
      excerpt: r.excerpt || '',
      tier: tierOf(c)
    }
  })
}
