// qsearch RaaS — the triangulation GATE.
//
// This is the product, encoded. A load-bearing claim PASSES iff it has enough INDEPENDENT,
// SUFFICIENTLY-AUTHORITATIVE sources whose verdict is "Supported". Otherwise the claim is
// flagged LOW-CONFIDENCE (never silently dropped). Mirrors build-spec §b decision 3 and the
// CLAUDE.md heavy-max "Triangulation gate Phase 4" rule:
//   "Каждое load-bearing число ≥3 independent primary sources, иначе low-confidence".
//
// Independence = distinct registrable domain (eTLD+1), NOT distinct URL — three pages on one
// site count as one source. (Syndication across domains is a known MVP blind spot — build-spec §f Q5.)

import { registrableDomain, meetsFloor, tierRank } from './tiers.js'

/**
 * @typedef {Object} VerifiedSource
 * @property {string} source_url
 * @property {'Supported'|'Partial'|'Unsupported'|'Contradicted'|'Fabricated'|'Error'} verdict
 * @property {import('./tiers.js').Tier} tier
 * @property {string} [evidence]
 * @property {string} [excerpt]
 */

/**
 * @typedef {Object} GateConfig
 * @property {number} minIndependent     // default 3 — the "≥3 independent sources" rule
 * @property {import('./tiers.js').Tier} tierFloor          // default '2' — every counted source ≥ this tier
 * @property {import('./tiers.js').Tier} requireOneAtLeast  // default '1B' — ≥1 counted source ≥ this tier
 */

/** @type {GateConfig} */
export const DEFAULT_GATE = { minIndependent: 3, tierFloor: '2', requireOneAtLeast: '1B' }

/**
 * @typedef {Object} ClaimVerdict
 * @property {boolean} triangulated
 * @property {'triangulated'|'low-confidence'} status
 * @property {number} independentSupporting
 * @property {string[]} supportingDomains
 * @property {string} [reason]
 * @property {VerifiedSource[]} sources
 */

/**
 * Apply the gate to one claim's verified sources.
 *
 * Rules (all must hold to triangulate):
 *   (a) ≥ cfg.minIndependent sources with verdict 'Supported' AND distinct registrable domain
 *       AND tier meeting cfg.tierFloor.
 *   (b) ≥ 1 of those counted (deduped) sources meets cfg.requireOneAtLeast (a high-authority anchor).
 * Fabricated / Error / Unsupported / Partial never count toward (a). Partial is conservatively
 * NOT counted ("plausibility is not support" — build-spec §d-4).
 *
 * @param {VerifiedSource[]} verified
 * @param {GateConfig} [cfg]
 * @returns {ClaimVerdict}
 */
export function gateClaim (verified, cfg = DEFAULT_GATE) {
  const supported = (verified || []).filter(
    v => v.verdict === 'Supported' && meetsFloor(v.tier, cfg.tierFloor)
  )
  // Dedupe supported by registrable domain → keep the most authoritative tier per domain.
  const byDomain = new Map()
  for (const v of supported) {
    const dom = registrableDomain(v.source_url)
    if (!dom) continue
    const prev = byDomain.get(dom)
    if (!prev || tierRank(v.tier) < tierRank(prev.tier)) byDomain.set(dom, v)
  }
  const supportingDomains = [...byDomain.keys()]
  const independentSupporting = supportingDomains.length
  const hasAnchor = [...byDomain.values()].some(v => meetsFloor(v.tier, cfg.requireOneAtLeast))
  const triangulated = independentSupporting >= cfg.minIndependent && hasAnchor

  let reason
  if (!triangulated) {
    if (independentSupporting < cfg.minIndependent) {
      reason = `only ${independentSupporting} independent supporting domain(s) at tier ≥ ${cfg.tierFloor} (need ${cfg.minIndependent})`
    } else {
      reason = `${independentSupporting} independent sources, but none meets the tier-${cfg.requireOneAtLeast} authority anchor`
    }
  }

  return {
    triangulated,
    status: triangulated ? 'triangulated' : 'low-confidence',
    independentSupporting,
    supportingDomains,
    reason,
    sources: verified || []
  }
}

/**
 * Summarise a whole report's confidence (used in report.js header + the secondary build tripwire).
 * @param {ClaimVerdict[]} claimVerdicts
 * @returns {{ total: number, triangulated: number, lowConfidence: number, triangulatedShare: number }}
 */
export function confidenceSummary (claimVerdicts) {
  const total = claimVerdicts.length
  const triangulated = claimVerdicts.filter(c => c.triangulated).length
  return {
    total,
    triangulated,
    lowConfidence: total - triangulated,
    triangulatedShare: total ? triangulated / total : 0 // build-spec §c tripwire: < 0.5 → stop, do not ship
  }
}
