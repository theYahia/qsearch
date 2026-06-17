// doesitlie Bench — harness. Runs a set of agent "submissions" through the verifier
// and produces a leaderboard + per-citation audit trail.
//
// Submission format (JSON): one object or an array of:
//   { "agent": "Perplexity Deep Research", "citations": [ { "claim": "...", "url": "..." }, ... ] }
//
// Usage: node doesitlie/bench/harness.js <submissions.json> [outdir]
// Output: <outdir>/leaderboard.md  +  <outdir>/audit.json  (every verdict auditable)

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyCitation, VERDICTS, judgeLabel } from './verifier.js'

// Load .env.local (DEEPSEEK_API_KEY etc.) so the judge can reach its provider.
for (const p of ['.env.local', '../.env.local', '../../.env.local']) {
  try {
    for (const line of fsSync.readFileSync(p, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    break
  } catch { /* next path */ }
}

const CONCURRENCY = parseInt(process.env.DOESITLIE_CONCURRENCY || '4', 10)

async function mapLimit (items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx) }
  }))
  return out
}

export function scoreAgent (results) {
  const counts = Object.fromEntries(VERDICTS.map(v => [v, 0]))
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1
  const total = results.length
  const scorable = total - counts.Error                    // Error = couldn't fetch/judge (403/paywall/PDF/timeout)
  const overTotal = n => (total ? n / total : 0)           // primary: over ALL cites — can't be gamed by citing blocked sources
  const overScorable = n => (scorable ? n / scorable : 0)  // secondary: over fetched cites — depends on coverage
  return {
    total,
    scorable,
    counts,
    coverage: overTotal(scorable),                         // % of cites we could actually fetch + judge (Error shown, not hidden)
    // ── PRIMARY (gaming-resistant): over ALL cites ──
    fabricatedRate: overTotal(counts.Fabricated),          // mechanical (dead/404/fake URL) — unchallengeable, can't dodge via Error
    unsupportedRate: overTotal(counts.Unsupported),        // judge: source doesn't back the claim
    supportedOfTotal: overTotal(counts.Supported),         // coverage-adjusted: rewards honesty AND fetchability
    // ── SECONDARY: over fetched cites (legacy headline, coverage-dependent) ──
    supportRate: overScorable(counts.Supported)
  }
}

// Ranking is gaming-resistant: lowest Fabricated (mechanical) first, then lowest Unsupported,
// then highest coverage-adjusted Supported. NOT sorted on the coverage-dependent Support%.
function honestyRank (s) { return [s.fabricatedRate, s.unsupportedRate, -s.supportedOfTotal] }
export function cmpRank (a, b) {
  const ra = honestyRank(a.score), rb = honestyRank(b.score)
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]
  return 0
}

export function renderMarkdown (board) {
  const pct = x => (x * 100).toFixed(1) + '%'
  const L = [
    '# doesitlie Bench — leaderboard',
    '',
    '| Agent | Cites | Coverage | ✓ Supported | ✗ Unsupported | ☠ Fabricated | Support %¹ |',
    '|---|--:|--:|--:|--:|--:|--:|'
  ]
  for (const a of board) {
    const s = a.score
    L.push(`| ${a.agent} | ${s.total} | ${pct(s.coverage)} | ${pct(s.supportedOfTotal)} | ${pct(s.unsupportedRate)} | ${pct(s.fabricatedRate)} | ${pct(s.supportRate)} |`)
  }
  L.push(
    '',
    '_**Primary metrics are over ALL cited URLs** (not Error-excluded): **☠ Fabricated** (mechanical — dead/404/non-existent URL) and **✗ Unsupported** (judge — source does not back the claim); lower is better. Reporting over the full denominator means an agent **cannot inflate its score by citing bot-blocked / paywalled primary sources** (those would otherwise vanish into Error). **Coverage** = share of cited URLs we could fetch + judge; the rest are **Error** (403 / paywall / PDF-parse-fail / timeout) and are shown, not silently dropped. **✓ Supported** is Supported/all-cites (coverage-adjusted floor). **Support %¹** = Supported/fetched — the legacy headline, kept for continuity but **secondary** because it depends on coverage. **Ranked by Fabricated, then Unsupported, then coverage-adjusted Supported.** Every verdict + source excerpt is in audit.json — anyone can re-check by hand._'
  )
  return L.join('\n')
}

async function main () {
  const [,, submissionsPath, outDir = 'doesitlie/bench/out'] = process.argv
  if (!submissionsPath) { console.error('usage: node doesitlie/bench/harness.js <submissions.json> [outdir]'); process.exit(1) }
  const raw = JSON.parse(await fs.readFile(submissionsPath, 'utf-8'))
  const agents = Array.isArray(raw) ? raw : [raw]
  await fs.mkdir(outDir, { recursive: true })
  process.stderr.write(`[doesitlie] judge: ${judgeLabel()}\n`)

  const board = []; const audit = []
  for (const agent of agents) {
    const name = agent.agent || 'unknown'
    process.stderr.write(`[doesitlie] ${name}: ${agent.citations.length} citations...\n`)
    const results = await mapLimit(agent.citations, CONCURRENCY, c => verifyCitation(c))
    const score = scoreAgent(results)
    board.push({ agent: name, score })
    audit.push({ agent: name, score, results })
    process.stderr.write(`[doesitlie] ${name}: support ${(score.supportRate * 100).toFixed(1)}% | fabricated ${(score.fabricatedRate * 100).toFixed(1)}% | ${score.scorable}/${score.total} scorable\n`)
  }
  board.sort(cmpRank)
  await fs.writeFile(path.join(outDir, 'leaderboard.md'), renderMarkdown(board))
  await fs.writeFile(path.join(outDir, 'audit.json'), JSON.stringify(audit, null, 2))
  process.stderr.write(`[doesitlie] wrote ${outDir}/leaderboard.md + audit.json\n`)
  console.log('\n' + renderMarkdown(board))
}

// Only auto-run when invoked directly (so rescore.mjs can import scoreAgent/renderMarkdown without re-judging).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1) })
}
