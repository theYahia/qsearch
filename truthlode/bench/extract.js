// Truthlode Bench — deterministic (claim, url) extractor.
// Pulls every "factual claim (https://source)" pair out of a deep-research report.
// Deterministic = reproducible = no human cherry-picking. The claim is the last sentence
// immediately preceding each cited URL.
//
// Usage: node truthlode/bench/extract.js [out.json]   (builds from the manifest below)

import fs from 'node:fs/promises'

const urlRe = /\((https?:\/\/[^)\s]+?)\)/g

function clean (s) {
  return s.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/[*_`>#|]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Last sentence of a span, with legal-abbreviation protection so "Cal. Bus. & Prof." / "v." don't over-split.
function lastSentence (span) {
  const t = clean(span)
  if (!t) return ''
  const masked = t
    .replace(/\b([A-Z][A-Za-z]{0,3})\.(\s)/g, '$1<DOT>$2') // Cal. Bus. Prof. Inc. No. Servs. etc.
    .replace(/\bv\.(\s)/g, 'v<DOT>$1')                      // case "v."
    .replace(/\b([A-Z])\.(\s)/g, '$1<DOT>$2')               // single initial
  const parts = masked.split(/(?<=[.!?:])\s+(?=[A-Z0-9"“])/)
  return (parts[parts.length - 1] || t).replace(/<DOT>/g, '.').slice(-380).trim()
}

export async function extractPairs (reportPath) {
  const text = await fs.readFile(reportPath, 'utf-8')
  const pairs = []
  let lastEnd = 0
  for (const m of text.matchAll(urlRe)) {
    const url = m[1]
    const claim = lastSentence(text.slice(lastEnd, m.index))
    lastEnd = m.index + m[0].length
    if (claim.length >= 20) pairs.push({ claim, url })
  }
  return pairs
}

async function main () {
  const R = 'truthlode/bench/dataset/raw/'
  // 3 legal topics × 2 agents. Citations are grouped BY AGENT for a cross-topic leaderboard.
  const manifest = [
    [R + 'gemini_noncompete.md', 'Gemini 3.1 Pro Deep Research'],
    [R + 'gemini_qualified-immunity.md', 'Gemini 3.1 Pro Deep Research'],
    [R + 'gemini_fair-use.md', 'Gemini 3.1 Pro Deep Research'],
    [R + 'claude_noncompete.md', 'Claude Deep Research'],
    [R + 'claude_qualified-immunity.md', 'Claude Deep Research'],
    [R + 'claude_fair-use.md', 'Claude Deep Research']
  ]
  const byAgent = new Map()
  for (const [p, agent] of manifest) {
    const cites = await extractPairs(p)
    if (!byAgent.has(agent)) byAgent.set(agent, [])
    byAgent.get(agent).push(...cites)
    process.stderr.write(`[extract] ${agent} += ${cites.length} from ${p.split('/').pop()}\n`)
  }
  const out = [...byAgent].map(([agent, citations]) => ({ agent, citations }))
  for (const a of out) process.stderr.write(`[extract] TOTAL ${a.agent}: ${a.citations.length}\n`)
  const dest = process.argv[2] || 'truthlode/bench/dataset/all_submissions.json'
  await fs.writeFile(dest, JSON.stringify(out, null, 2))
  process.stderr.write(`[extract] wrote ${dest}\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
