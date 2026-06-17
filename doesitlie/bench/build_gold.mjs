// Build gold/labels.json (v7, 55 citations). Re-run the same stratified pick as the manual-review dump,
// attach human labels graded STRICTLY by "does the shown source content support the claim" (the same
// evidence the judge saw). Writes {url, claim, gold} so agreement.js matches by key.
import fs from 'node:fs'
const audit = JSON.parse(fs.readFileSync('doesitlie/bench/out/all/audit.json', 'utf-8'))
const labels = [
  'Supported', 'Supported', 'Supported', 'Supported', 'Supported', 'Supported', 'Supported', 'Supported',
  'Supported', 'Supported', 'Supported', 'Supported', 'Partial', 'Supported', 'Partial', 'Partial',
  'Unsupported', 'Supported', 'Partial', 'Supported', 'Unsupported', 'Unsupported', 'Unsupported', 'Unsupported',
  'Unsupported', 'Unsupported', 'Unsupported', 'Unsupported', 'Unsupported', 'Supported', 'Unsupported', 'Supported',
  'Supported', 'Supported', 'Supported', 'Supported', 'Supported', 'Supported', 'Supported', 'Supported',
  'Supported', 'Supported', 'Unsupported', 'Unsupported', 'Fabricated', 'Supported', 'Supported', 'Partial',
  'Supported', 'Unsupported', 'Supported', 'Unsupported', 'Unsupported', 'Fabricated', 'Unsupported'
]
const cap = { Supported: 12, Partial: 9, Unsupported: 12, Fabricated: 9 }
const out = []; let i = 0
for (const ag of audit) {
  const seen = { Supported: 0, Partial: 0, Unsupported: 0, Fabricated: 0 }
  for (const r of ag.results) {
    if (seen[r.verdict] == null || seen[r.verdict] >= cap[r.verdict]) continue
    seen[r.verdict]++
    out.push({ url: r.source_url, claim: r.claim, gold: labels[i] }); i++
  }
}
fs.mkdirSync('doesitlie/bench/gold', { recursive: true })
fs.writeFileSync('doesitlie/bench/gold/labels.json', JSON.stringify(out, null, 2))
console.log('wrote', out.length, 'gold labels; consumed', i, 'human labels')
