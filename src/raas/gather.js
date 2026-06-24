// qsearch RaaS — source gathering.
//
// For each claim, fan out its queries to the qsearch /sweep endpoint and collect candidate
// sources (URL + title + multi-engine provenance). /sweep returns markdown (parsed_snippets
// format, src/sweep/parsed_snippets.js): per result a `**N. Title**` line, a `- URL: …` line,
// and (when engines are present) a `- Engines: a, b (count=N)` line — parsed here into
// { url, title, engine_count } so tiers.js can use engine_count as a provenance signal.
//
// This is the ONLY network dependency of the core pipeline. If qsearch is down, the pipeline
// can be fed a static candidate fixture instead (loadCandidatesFromFixture) so it runs offline
// and reproducibly — prefer a recorded sweep over a live one for a report you intend to charge for.

const QSEARCH_URL = process.env.QSEARCH_URL || 'http://localhost:8080'

/**
 * @typedef {Object} ClaimBrief
 * @property {string} id
 * @property {string} text                       // the load-bearing claim, as it will be verified
 * @property {string[]} queries                  // sweep queries likely to surface supporting sources
 * @property {string} [priority]                 // 'broad' | 'focused' | 'critical' (default focused for RaaS)
 */

/**
 * Build the text/plain body /sweep expects: `label|query|priority` per line.
 * @param {ClaimBrief} claim
 * @returns {string}
 */
export function sweepBody (claim) {
  const pr = claim.priority || 'focused'
  return claim.queries.map((q, i) => `${claim.id}_${i}|${q}|${pr}`).join('\n') + '\n'
}

/**
 * Parse the qsearch /sweep markdown into deduped candidate sources.
 * Pure (no I/O) so it is unit-testable against a recorded /sweep body.
 * @param {string} md
 * @returns {import('./verify.js').Candidate[]}
 */
export function parseSweepMarkdown (md) {
  const found = []
  let cur = null
  const flush = () => { if (cur && cur.url) found.push(cur); cur = null }
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trim()
    const mTitle = line.match(/^\*\*\d+\.\s+(.*?)\*\*$/)
    if (mTitle) { flush(); cur = { title: mTitle[1].trim() }; continue }
    if (!cur) continue
    const mUrl = line.match(/^-\s*URL:\s*(\S+)/i)
    if (mUrl) { cur.url = mUrl[1]; continue }
    const mEng = line.match(/^-\s*Engines:.*\(count=(\d+)\)/i)
    if (mEng) { cur.engine_count = parseInt(mEng[1], 10); continue }
  }
  flush()
  // Dedupe by URL: keep the FIRST (highest-ranked) result's title, but take the MAX engine_count
  // seen across duplicates (richest provenance signal).
  const byUrl = new Map()
  for (const c of found) {
    const prev = byUrl.get(c.url)
    if (!prev) byUrl.set(c.url, { ...c })
    else if ((c.engine_count || 0) > (prev.engine_count || 0)) prev.engine_count = c.engine_count
  }
  return [...byUrl.values()]
}

/**
 * Call qsearch /sweep for one claim and return deduped candidate sources.
 * @param {ClaimBrief} claim
 * @param {{ baseUrl?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<import('./verify.js').Candidate[]>}
 */
export async function gatherForClaim (claim, opts = {}) {
  const base = opts.baseUrl || QSEARCH_URL
  const res = await fetch(`${base}/sweep`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: sweepBody(claim),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180000)
  })
  if (!res.ok) {
    const e = await res.text().catch(() => '')
    throw new Error(`qsearch /sweep ${res.status}: ${String(e).slice(0, 160)}`)
  }
  const text = await res.text()
  return parseSweepMarkdown(text)
}

/**
 * Offline path: load pre-recorded candidate sources for a claim from a fixture file.
 * Lets the pipeline + tests run without a live qsearch. Shape: { [claimId]: Candidate[] }.
 * @param {string} fixturePath
 * @param {string} claimId
 * @returns {Promise<import('./verify.js').Candidate[]>}
 */
export async function loadCandidatesFromFixture (fixturePath, claimId) {
  const { readFile } = await import('node:fs/promises')
  const all = JSON.parse(await readFile(fixturePath, 'utf-8'))
  return all[claimId] || []
}
