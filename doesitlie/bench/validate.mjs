// doesitlie Bench — integrity + reproducibility gate.
// Proves the published numbers are DERIVED, not asserted: it re-computes every headline figure,
// every board metric, and the judge↔human κ straight from the raw receipts (audit.json + labels.json)
// and fails if the committed site/data.json (or badge.json) disagrees by a hair. It also schema-checks
// every receipt and confirms no receipt was invented (every site receipt traces to a real audit verdict).
//
// This is what lets a skeptic trust the leaderboard: "re-run this, the 1-in-N falls out of the data."
// Exit 1 on any hard mismatch → wire it into CI as a merge gate.
//
// Usage: node doesitlie/bench/validate.mjs   (paths default relative to this file; override via argv)

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { scoreAgent } from './harness.js'
import { cohenKappa } from './stats.js'
import { VERDICTS } from './verifier.js'

// pathToFileURL(resolve()) — NOT `new URL(argv, base)`, which parses a Windows "D:/…" path as a URL scheme.
const arg = (i, def) => process.argv[i] ? pathToFileURL(path.resolve(process.argv[i])) : new URL(def, import.meta.url)
const AUDIT = arg(2, '../bench/out/all/audit.json')
const GOLD = arg(3, '../bench/gold/labels.json')
const DATA = arg(4, '../site/data.json')
const BADGE = new URL('../site/badge.json', import.meta.url)

const errors = []
const warnings = []
const ok = []
const fail = (c, m) => errors.push(`✖ [${c}] ${m}`)
const warn = (c, m) => warnings.push(`⚠ [${c}] ${m}`)
const pass = m => ok.push(`✓ ${m}`)
const readJson = u => { try { return JSON.parse(fs.readFileSync(u, 'utf-8')) } catch (e) { return { __err: e.message } } }
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
// ckey: 80-char-claim key for matching GOLD↔audit (mirrors build_site.mjs/agreement.js, so the
// re-derived κ uses the same matching the published κ did — must stay consistent with them).
const ckey = (u, c) => norm(u) + '||' + norm(c).slice(0, 80)
// fullKey: FULL-claim hash for the receipts-integrity check. The 80-char slice was forgeable —
// 79% of real claims exceed 80 chars, so a receipt could reuse a real url+prefix with a fabricated
// tail under the correct verdict and slip past. Hashing the whole claim closes that hole.
const fullKey = (u, c) => norm(u) + '||' + crypto.createHash('sha256').update(norm(c)).digest('hex')

const audit = readJson(AUDIT)
if (audit.__err || !Array.isArray(audit)) { console.error(`FATAL: cannot read audit.json (${AUDIT.pathname}): ${audit.__err || 'not an array'}`); process.exit(2) }
const gold = readJson(GOLD)
const data = readJson(DATA)
const badge = readJson(BADGE)

// ── 1. Schema: every result is well-formed ───────────────────────────────────
let malformed = 0
const allResults = []
for (const ag of audit) {
  if (typeof ag.agent !== 'string' || !Array.isArray(ag.results)) { fail('schema', `agent entry malformed: ${JSON.stringify(ag).slice(0, 80)}`); continue }
  for (const r of ag.results) {
    allResults.push(r)
    if (typeof r.claim !== 'string' || typeof r.source_url !== 'string' || !VERDICTS.includes(r.verdict)) { malformed++ }
  }
}
if (malformed) fail('schema', `${malformed} results have a missing/invalid claim, url, or verdict`)
else pass(`schema: ${allResults.length} results well-formed (verdict ∈ {${VERDICTS.join(',')}})`)

// ── 2. Stored per-agent score must re-derive from its own results ─────────────
let scoreDrift = 0
for (const ag of audit) {
  if (!ag.score || !ag.score.counts) continue // older audits may omit score; build_site recomputes anyway
  const re = scoreAgent(ag.results)
  for (const v of VERDICTS) if ((ag.score.counts[v] || 0) !== (re.counts[v] || 0)) { scoreDrift++; fail('score-drift', `${ag.agent}: stored ${v}=${ag.score.counts[v]} ≠ recomputed ${re.counts[v]}`) }
  for (const k of ['fabricatedRate', 'unsupportedRate', 'supportedOfTotal', 'supportRate']) {
    if (ag.score[k] != null && !close(ag.score[k], re[k])) { scoreDrift++; fail('score-drift', `${ag.agent}: stored ${k}=${ag.score[k]} ≠ recomputed ${re[k].toFixed(6)}`) }
  }
}
if (!scoreDrift) pass('per-agent scores re-derive exactly from results (no score drift)')

// ── 3. site/data.json board + headline must re-derive from audit ──────────────
if (!data.__err) {
  // recompute board the way build_site does
  const reBoard = audit.map(a => ({ agent: a.agent, ...scoreAgent(a.results) }))
  const byAgent = new Map(reBoard.map(b => [b.agent, b]))
  let boardDrift = 0
  for (const b of (data.board || [])) {
    const re = byAgent.get(b.agent)
    if (!re) { fail('data-board', `data.json board has agent "${b.agent}" with no matching audit entry`); continue }
    for (const v of VERDICTS) if ((b.counts?.[v] || 0) !== (re.counts[v] || 0)) { boardDrift++; fail('data-board', `${b.agent}: data.json ${v}=${b.counts?.[v]} ≠ audit ${re.counts[v]}`) }
    if (b.fabricatedRate != null && !close(b.fabricatedRate, re.fabricatedRate)) { boardDrift++; fail('data-board', `${b.agent}: data.json fabricatedRate ${b.fabricatedRate} ≠ ${re.fabricatedRate.toFixed(6)}`) }
  }
  if (!boardDrift && data.board) pass(`data.json board (${data.board.length} agents) matches recomputation from audit`)

  // recompute headline
  const totals = { total: 0, scorable: 0, Supported: 0, Partial: 0, Unsupported: 0, Fabricated: 0, Error: 0 }
  for (const b of reBoard) { totals.total += b.total; totals.scorable += b.scorable; for (const v of VERDICTS) totals[v] += b.counts[v] || 0 }
  const notFully = totals.Partial + totals.Unsupported + totals.Fabricated
  const oneIn = notFully ? Math.round(totals.scorable / notFully) : null
  const h = data.meta?.headline
  if (h) {
    if (h.notFully !== notFully) fail('headline', `data.json notFully=${h.notFully} ≠ recomputed ${notFully}`)
    else if (h.oneIn !== oneIn) fail('headline', `data.json oneIn=${h.oneIn} ≠ recomputed ${oneIn}`)
    else if (h.scorable !== totals.scorable) fail('headline', `data.json scorable=${h.scorable} ≠ recomputed ${totals.scorable}`)
    else pass(`headline re-derives: ${notFully}/${totals.scorable} not-fully-supported → 1 in ${oneIn}`)
  } else warn('headline', 'data.json has no meta.headline to verify')

  // ── 4. receipts integrity: every published receipt traces to a real audit verdict (nothing invented) ──
  if (Array.isArray(data.receipts)) {
    const auditSet = new Set()
    for (const ag of audit) for (const r of ag.results) auditSet.add(ag.agent + '||' + fullKey(r.source_url, r.claim) + '||' + r.verdict)
    let orphan = 0; let receiptCites = 0
    for (const rc of data.receipts) for (const c of (rc.cites || [])) {
      receiptCites++
      if (!auditSet.has(rc.agent + '||' + fullKey(c.url, c.claim) + '||' + c.verdict)) { orphan++; if (orphan <= 3) fail('receipts', `orphan receipt (no matching audit verdict): ${rc.agent} | ${String(c.claim).slice(0, 50)} → ${c.verdict}`) }
    }
    if (orphan > 3) fail('receipts', `…and ${orphan - 3} more orphan receipts`)
    if (!orphan) pass(`receipts integrity: all ${receiptCites} published cites trace to a real audit verdict`)
  }

  // ── 5. agreement κ re-derivation (the credibility number) ──
  if (!gold.__err && Array.isArray(gold) && data.meta?.agreement) {
    const judgeBy = new Map()
    for (const ag of audit) for (const r of ag.results) judgeBy.set(ckey(r.source_url, r.claim), r.verdict)
    const p4 = []; const pBin = []
    const binv = v => (v === 'Supported' ? 'Supported' : 'not')
    for (const g of gold) { const jv = judgeBy.get(ckey(g.url, g.claim)); if (!jv) continue; p4.push([jv, g.gold]); pBin.push([binv(jv), binv(g.gold)]) }
    const reBinK = +cohenKappa(pBin).toFixed(3)
    const reExactK = +cohenKappa(p4).toFixed(3)
    const a = data.meta.agreement
    if (a.n !== p4.length) warn('agreement', `data.json agreement.n=${a.n} ≠ matched ${p4.length} (gold/audit may have changed)`)
    if (a.binary_kappa != null && !close(a.binary_kappa, reBinK, 0.001)) fail('agreement', `binary κ: data.json ${a.binary_kappa} ≠ recomputed ${reBinK}`)
    else if (a.exact_kappa != null && !close(a.exact_kappa, reExactK, 0.001)) fail('agreement', `exact κ: data.json ${a.exact_kappa} ≠ recomputed ${reExactK}`)
    else pass(`judge↔human κ re-derives: binary κ=${reBinK}, exact κ=${reExactK} over n=${p4.length}`)
  }

  // ── 5b. freshness: warn (don't fail) when the published audit is going stale ──
  if (data.meta?.generated) {
    const ageDays = Math.floor((Date.now() - Date.parse(data.meta.generated)) / 86400000)
    const STALE_DAYS = +(process.env.DOESITLIE_STALE_DAYS || 45)
    if (Number.isFinite(ageDays) && ageDays > STALE_DAYS) warn('freshness', `audit is ${ageDays} days old (>${STALE_DAYS}) — re-run the bench (needs a judge: local Ollama or DEEPSEEK_API_KEY)`)
    else if (Number.isFinite(ageDays)) pass(`freshness: audit is ${ageDays} days old (≤${STALE_DAYS})`)
  }

  // ── 6. badge.json must agree with the headline ──
  if (!badge.__err && h?.oneIn != null) {
    if (!String(badge.message || '').includes(`1 in ${h.oneIn}`)) fail('badge', `badge.json message "${badge.message}" does not contain "1 in ${h.oneIn}"`)
    else pass(`badge.json headline matches (1 in ${h.oneIn})`)
  }
} else warn('data', `site/data.json not found (${DATA.pathname}) — run build_site.mjs first; skipping site checks`)

// ── 7. gold coverage (warning only — gold can legitimately be a subset/superset) ──
if (!gold.__err && Array.isArray(gold)) {
  const auditKeys = new Set(allResults.map(r => ckey(r.source_url, r.claim)))
  const unmatched = gold.filter(g => !auditKeys.has(ckey(g.url, g.claim))).length
  if (unmatched) warn('gold', `${unmatched}/${gold.length} gold labels have no matching audit verdict (they won't count toward κ)`)
  else pass(`gold coverage: all ${gold.length} labels matched to an audit verdict`)
}

// ── report ────────────────────────────────────────────────────────────────────
console.log('doesitlie integrity check\n' + '─'.repeat(50))
for (const m of ok) console.log(m)
for (const m of warnings) console.log(m)
for (const m of errors) console.log(m)
console.log('─'.repeat(50))
console.log(`${ok.length} passed · ${warnings.length} warnings · ${errors.length} failures`)
process.exit(errors.length ? 1 : 0)
