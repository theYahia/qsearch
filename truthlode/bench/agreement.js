// Truthlode Bench — judge-vs-human agreement. The credibility anchor: how often the
// neutral judge matches an independent human label on the same citations.
//
// Reports raw agreement AND Cohen's kappa (κ corrects for chance — raw % alone is inflated by
// class imbalance). Also reports the figure EXCLUDING mechanical-Fabricated items (those test the
// fetch layer, not the judge's support decision, and are trivially agreed). Optional 2nd annotator
// file → inter-annotator κ (the honest ceiling any single judge can be expected to hit).
//
// Usage: node truthlode/bench/agreement.js [gold/labels.json] [out/all/audit.json] [gold/labels_2.json]

import fs from 'node:fs/promises'

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const key = (url, claim) => norm(url) + '||' + norm(claim).slice(0, 80)
const bin = v => (v === 'Supported' ? 'Supported' : 'not')

// Cohen's kappa over a list of [labelA, labelB] pairs.
function cohenKappa (pairs) {
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

const agr = pairs => pairs.filter(([a, b]) => a === b).length
const pctOf = pairs => (pairs.length ? (agr(pairs) / pairs.length * 100).toFixed(1) : '0.0')
const fmtK = x => (x == null ? 'n/a' : x.toFixed(3))

async function main () {
  const goldPath = process.argv[2] || 'truthlode/bench/gold/labels.json'
  const auditPath = process.argv[3] || 'truthlode/bench/out/all/audit.json'
  const gold2Path = process.argv[4] || null // optional 2nd human annotator → inter-annotator κ
  const gold = JSON.parse(await fs.readFile(goldPath, 'utf-8'))
  const audit = JSON.parse(await fs.readFile(auditPath, 'utf-8'))

  const judgeBy = new Map()
  for (const ag of audit) for (const r of ag.results) judgeBy.set(key(r.source_url, r.claim), r.verdict)

  const p4 = []; const pBin = []; const p4nf = []; const pBinNf = []
  const conflicts = []; let missing = 0
  for (const g of gold) {
    const jv = judgeBy.get(key(g.url, g.claim))
    if (!jv) { missing++; continue }
    p4.push([jv, g.gold]); pBin.push([bin(jv), bin(g.gold)])
    if (g.gold !== 'Fabricated') { p4nf.push([jv, g.gold]); pBinNf.push([bin(jv), bin(g.gold)]) } // judge-skill only
    if (jv !== g.gold) conflicts.push(`  gold=${g.gold} judge=${jv} | ${g.claim.slice(0, 70)}`)
  }
  const n = p4.length

  console.log(`Gold set: ${n} human-labeled citations matched to judge verdicts${missing ? ` (${missing} unmatched, skipped)` : ''}`)
  console.log('\n— Judge vs human (ALL items) —')
  console.log(`  Exact (4-way):    ${agr(p4)}/${n} = ${pctOf(p4)}%   κ=${fmtK(cohenKappa(p4))}`)
  console.log(`  Binary (Sup/not): ${agr(pBin)}/${n} = ${pctOf(pBin)}%   κ=${fmtK(cohenKappa(pBin))}`)
  console.log(`\n— Excluding mechanical Fabricated (n=${p4nf.length}; isolates the LLM-judge's support decision) —`)
  console.log(`  Exact (3-way):    ${agr(p4nf)}/${p4nf.length} = ${pctOf(p4nf)}%   κ=${fmtK(cohenKappa(p4nf))}`)
  console.log(`  Binary (Sup/not): ${agr(pBinNf)}/${pBinNf.length} = ${pctOf(pBinNf)}%   κ=${fmtK(cohenKappa(pBinNf))}`)
  console.log("\nκ (Cohen's kappa) corrects for chance agreement: >0.6 substantial, >0.8 near-perfect. Report κ, not raw % — raw % is inflated by class imbalance.")

  if (gold2Path) {
    const gold2 = JSON.parse(await fs.readFile(gold2Path, 'utf-8'))
    const g2 = new Map(gold2.map(g => [key(g.url, g.claim), g.gold]))
    const ia4 = []; const iaBin = []
    for (const g of gold) { const o = g2.get(key(g.url, g.claim)); if (!o) continue; ia4.push([g.gold, o]); iaBin.push([bin(g.gold), bin(o)]) }
    if (ia4.length) {
      console.log(`\n— Inter-annotator (human1 vs human2, n=${ia4.length}; the human ceiling) —`)
      console.log(`  Exact (4-way):    ${pctOf(ia4)}%   κ=${fmtK(cohenKappa(ia4))}`)
      console.log(`  Binary (Sup/not): ${pctOf(iaBin)}%   κ=${fmtK(cohenKappa(iaBin))}`)
    }
  } else {
    console.log('\n(no 2nd-annotator file given → inter-annotator κ not computed. Pass gold/labels_2.json as arg 3 once a 2nd human labels the SAME items against the LIVE source.)')
  }

  if (conflicts.length) { console.log('\nConflicts (judge ≠ human):'); conflicts.forEach(c => console.log(c)) }
}
main().catch(e => { console.error(e); process.exit(1) })
