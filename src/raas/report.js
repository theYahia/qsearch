// qsearch RaaS — report + receipt assembly.
//
// Emits TWO artifacts (build-spec §b data-flow step 5):
//   - report.md   : human-readable. The operator writes the narrative; this generates the verified
//                   EVIDENCE LAYER — a confidence summary + a per-claim table of (source, tier, verdict, evidence).
//   - audit.json  : the RECEIPT. Every (claim, source_url, verdict, evidence, excerpt) so a buyer or
//                   skeptic can re-check any row by hand (same shape as doesitlie audit.json).
//
// The receipt is the differentiator and the liability shield (build-spec §d): the report never claims
// more confidence than the verdicts support; low-confidence claims are flagged, not hidden.

import { confidenceSummary } from './triangulate.js'

/**
 * @typedef {Object} ReportInput
 * @property {string} question
 * @property {Array<{ claim: import('./gather.js').ClaimBrief, verdict: import('./triangulate.js').ClaimVerdict }>} claims
 * @property {{ judge: string, generatedAt: string }} meta
 */

function escCell (s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

/**
 * Render report.md (Markdown string). Pure — no I/O.
 * @param {ReportInput} input
 * @returns {string}
 */
export function renderReport (input) {
  const s = confidenceSummary(input.claims.map(c => c.verdict))
  const L = []
  L.push(`# ${input.question}`, '')
  L.push(`_Confidence: ${s.triangulated}/${s.total} load-bearing claims triangulated (≥3 independent tiered sources, ≥1 high-authority); ${s.lowConfidence} flagged low-confidence._`)
  L.push(`_Verified with the doesitlie method · judge ${input.meta.judge} · generated ${input.meta.generatedAt} · re-check any row in audit.json._`, '')
  if (s.total > 0 && s.triangulatedShare < 0.5) {
    L.push(`> ⚠️ **Less than half of load-bearing claims triangulated (${Math.round(s.triangulatedShare * 100)}%) — NOT ship-ready. Gather more sources or revise the claims before relying on this report.**`, '')
  }
  input.claims.forEach((c, i) => {
    const v = c.verdict
    const badge = v.triangulated ? '✓ triangulated' : '⚠ low-confidence'
    L.push(`## Claim ${i + 1} — ${escCell(c.claim.text)}  [${badge}]`, '')
    if (!v.triangulated && v.reason) L.push(`_Why low-confidence: ${v.reason}._`, '')
    if (v.triangulated) L.push(`_Backed by ${v.independentSupporting} independent sources: ${v.supportingDomains.join(', ')}._`, '')
    L.push('| Source | Tier | Verdict | Evidence |', '|---|---|---|---|')
    for (const src of v.sources) {
      L.push(`| ${escCell(src.source_url)} | ${escCell(src.tier)} | ${escCell(src.verdict)} | ${escCell(src.evidence).slice(0, 220)} |`)
    }
    L.push('')
  })
  L.push('---', '_This report only asserts what its cited sources support. Verdicts produced by an LLM-as-judge at temperature 0; the verbatim source excerpt for every verdict is in audit.json._', '')
  return L.join('\n')
}

/**
 * Build the machine-checkable receipt object (serialise with JSON.stringify(_, null, 2)).
 * @param {ReportInput} input
 * @returns {object}
 */
export function buildAudit (input) {
  const s = confidenceSummary(input.claims.map(c => c.verdict))
  return {
    question: input.question,
    meta: input.meta,
    summary: s,
    claims: input.claims.map(c => ({
      id: c.claim.id,
      text: c.claim.text,
      status: c.verdict.status,
      triangulated: c.verdict.triangulated,
      independentSupporting: c.verdict.independentSupporting,
      supportingDomains: c.verdict.supportingDomains,
      reason: c.verdict.reason || null,
      sources: (c.verdict.sources || []).map(src => ({
        source_url: src.source_url,
        tier: src.tier,
        verdict: src.verdict,
        evidence: src.evidence || '',
        excerpt: src.excerpt || ''
      }))
    }))
  }
}

/**
 * Write both artifacts to disk.
 * @param {ReportInput} input
 * @param {string} outDir
 * @returns {Promise<{ reportPath: string, auditPath: string }>}
 */
export async function writeReport (input, outDir) {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const path = await import('node:path')
  await mkdir(outDir, { recursive: true })
  const reportPath = path.join(outDir, 'report.md')
  const auditPath = path.join(outDir, 'audit.json')
  await writeFile(reportPath, renderReport(input))
  await writeFile(auditPath, JSON.stringify(buildAudit(input), null, 2))
  return { reportPath, auditPath }
}
