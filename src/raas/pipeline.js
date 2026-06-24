// qsearch RaaS — orchestration.
//
// brief → { question, claims, meta }. Kept free of CLI/HTTP concerns so a future paste-box or
// per-call API is a thin wrapper, NOT a rewrite (build-spec §b decision 6). The MVP calls it from
// cli.js; the HTTP /raas/report endpoint (server.js) is another thin caller.
//
// Stage order (build-spec §b): gather → tier(drop excluded) → verify → gate → report.

import { gatherForClaim, loadCandidatesFromFixture } from './gather.js'
import { isExcluded } from './tiers.js'
import { verifyClaim } from './verify.js'
import { gateClaim, DEFAULT_GATE } from './triangulate.js'

/**
 * @typedef {Object} Brief
 * @property {string} question
 * @property {import('./gather.js').ClaimBrief[]} claims
 * @property {string} [candidatesFixture]   // optional ABSOLUTE path → offline candidates instead of live /sweep
 */

/**
 * Run one claim end-to-end: gather → drop excluded → verify → gate.
 * @param {import('./gather.js').ClaimBrief} claim
 * @param {Brief} brief
 * @param {import('./triangulate.js').GateConfig} [gate]
 * @returns {Promise<{ claim: import('./gather.js').ClaimBrief, verdict: import('./triangulate.js').ClaimVerdict }>}
 */
export async function runClaim (claim, brief, gate = DEFAULT_GATE) {
  let candidates = brief.candidatesFixture
    ? await loadCandidatesFromFixture(brief.candidatesFixture, claim.id)
    : await gatherForClaim(claim)
  candidates = candidates.filter(c => !isExcluded(c)) // drop tier-excluded before paying for verify
  const verified = await verifyClaim(claim.text, candidates)
  const verdict = gateClaim(verified, gate)
  return { claim, verdict }
}

/** Resolve judgeLabel() from the canonical verifier without hard-coupling (cosmetic meta field). */
async function safeJudgeLabel () {
  try { const m = await import('../verifier/index.js'); return m.judgeLabel() } catch { return 'unknown' }
}

/**
 * Run the whole brief. Returns the ReportInput report.js consumes.
 * @param {Brief} brief
 * @param {{ gate?: import('./triangulate.js').GateConfig, judge?: string, now?: string }} [opts]
 * @returns {Promise<import('./report.js').ReportInput>}
 */
export async function runBrief (brief, opts = {}) {
  const gate = opts.gate || DEFAULT_GATE
  const claims = []
  for (const claim of (brief.claims || [])) {
    claims.push(await runClaim(claim, brief, gate))
  }
  const judge = opts.judge || (await safeJudgeLabel())
  const generatedAt = opts.now || new Date().toISOString()
  return { question: brief.question, claims, meta: { judge, generatedAt } }
}
