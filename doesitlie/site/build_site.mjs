// Build site/data.json (+ inject crawler-visible numbers into index.html) from the bench output.
// Decouples the static site from bench internals. Reads ../bench/out/all/audit.json +
// ../bench/gold/labels.json, recomputes judge↔human agreement + Cohen's kappa HERE (so the
// site's numbers are derived from data, not hardcoded), and emits:
//   data.json      { meta:{…, totals, headline, error_domains}, board:[…], pending:[…], receipts:[…] }
//   doesitlie.csv  flat per-agent metrics (the "download the data" artifact)
//   badge.json     shields.io endpoint schema (embeddable badge)
//   index.html     values between <!-- auto:* --> markers + <meta> contents refreshed in place
//
// The headline ("1 in N") is ALWAYS computed here — never hardcode it anywhere else.
// Usage: node doesitlie/site/build_site.mjs   (run from anywhere; paths are relative to this file)
import fs from 'node:fs'

const SITE_URL = 'https://doesitlie.org'
const REPO_URL = 'https://github.com/theYahia/doesitlie'

const auditUrl = new URL('../bench/out/all/audit.json', import.meta.url)
const goldUrl = new URL('../bench/gold/labels.json', import.meta.url)
const indexUrl = new URL('./index.html', import.meta.url)
const audit = JSON.parse(fs.readFileSync(auditUrl, 'utf-8'))
const gold = JSON.parse(fs.readFileSync(goldUrl, 'utf-8'))

// ── agreement + Cohen's kappa (same logic as bench/agreement.js — recomputed so nothing is hardcoded) ──
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const key = (u, c) => norm(u) + '||' + norm(c).slice(0, 80)
const binv = v => (v === 'Supported' ? 'Supported' : 'not')
function kappa (pairs) {
  const n = pairs.length; if (!n) return null
  const cats = [...new Set(pairs.flat())]
  let po = 0; for (const [a, b] of pairs) if (a === b) po++; po /= n
  const ca = {}; const cb = {}; for (const c of cats) { ca[c] = 0; cb[c] = 0 }
  for (const [a, b] of pairs) { ca[a]++; cb[b]++ }
  let pe = 0; for (const c of cats) pe += (ca[c] / n) * (cb[c] / n)
  return pe >= 1 ? 1 : (po - pe) / (1 - pe)
}
const agr = ps => ps.filter(([a, b]) => a === b).length
const pct1 = x => +(x * 100).toFixed(1)

const judgeBy = new Map()
for (const ag of audit) for (const r of ag.results) judgeBy.set(key(r.source_url, r.claim), r.verdict)
const p4 = []; const pBin = []; const conflicts = []
for (const g of gold) {
  const jv = judgeBy.get(key(g.url, g.claim)); if (!jv) continue
  p4.push([jv, g.gold]); pBin.push([binv(jv), binv(g.gold)])
  if (jv !== g.gold) conflicts.push({ gold: g.gold, judge: jv, claim: g.claim.slice(0, 130) })
}

// ── board (+ slug for permalinks, provider moved here from app.js) ──
const PROVIDER = {
  'Claude Deep Research': 'Anthropic',
  'Gemini 3.1 Pro Deep Research': 'Google',
  'ChatGPT Deep Research': 'OpenAI',
  'Perplexity Deep Research': 'Perplexity',
  'Exa Research': 'Exa',
  'Parallel Search API': 'Parallel'
}
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const board = audit
  .map(a => ({ agent: a.agent, slug: slugify(a.agent), provider: PROVIDER[a.agent] || '', ...a.score }))
  .sort((x, y) => x.fabricatedRate - y.fabricatedRate || x.unsupportedRate - y.unsupportedRate || y.supportedOfTotal - x.supportedOfTotal)

// ── docket: agents announced but not yet run. No data is invented; rows render as empty tracks.
// Auto-drops an entry the moment a real run for that agent lands in audit.json.
const pending = [
  { agent: 'ChatGPT Deep Research', provider: 'OpenAI', status: 'docketed — awaiting run' },
  { agent: 'Perplexity Deep Research', provider: 'Perplexity', status: 'docketed — awaiting run' },
  { agent: 'Exa Research', provider: 'Exa', status: 'docketed' },
  { agent: 'Parallel Search API', provider: 'Parallel', status: 'docketed' }
].filter(p => !audit.some(a => a.agent === p.agent))

// ── combined totals + the headline number ("1 in N checkable citations doesn't fully hold up") ──
const VKEYS = ['Supported', 'Partial', 'Unsupported', 'Fabricated', 'Error']
const totals = { total: 0, scorable: 0, Supported: 0, Partial: 0, Unsupported: 0, Fabricated: 0, Error: 0 }
for (const b of board) {
  totals.total += b.total; totals.scorable += b.scorable
  for (const k of VKEYS) totals[k] += b.counts[k] || 0
}
const notFully = totals.Partial + totals.Unsupported + totals.Fabricated // "not fully supported"
const strictN = totals.Unsupported + totals.Fabricated                  // strict fallback phrasing
const headline = {
  notFully,
  scorable: totals.scorable,
  oneIn: notFully ? Math.round(totals.scorable / notFully) : null,
  pct: totals.scorable ? pct1(notFully / totals.scorable) : null,
  strict: { n: strictN, oneIn: strictN ? Math.round(totals.scorable / strictN) : null, pct: totals.scorable ? pct1(strictN / totals.scorable) : null }
}

// ── coverage gaps by domain (pre-empts "your fetcher is broken": the blocked list, in the open) ──
const errMap = {}
for (const ag of audit) {
  for (const r of ag.results) {
    if (r.verdict !== 'Error') continue
    let host = '(unparseable url)'
    try { host = new URL(r.source_url).hostname.replace(/^www\./, '') } catch {}
    errMap[host] = errMap[host] || { n: 0, note: '' }
    errMap[host].n++
    if (!errMap[host].note && r.error) errMap[host].note = String(r.error).slice(0, 90)
  }
}
const error_domains = Object.entries(errMap)
  .map(([domain, v]) => ({ domain, n: v.n, note: v.note }))
  .sort((a, b) => b.n - a.n)
  .slice(0, 10)
const error_domains_more = Object.keys(errMap).length - error_domains.length

const meta = {
  generated: new Date().toISOString().slice(0, 10),
  site: SITE_URL,
  repo: REPO_URL,
  topics: 3,
  topic_names: ['non-compete', 'qualified immunity', 'fair use'],
  gold_n: gold.length,
  judge: 'neutral third party — DeepSeek (off the board) / local qwen2.5:14b',
  agreement: {
    n: p4.length,
    binary_pct: pct1(agr(pBin) / pBin.length),
    binary_kappa: +kappa(pBin).toFixed(3),
    exact_pct: pct1(agr(p4) / p4.length),
    exact_kappa: +kappa(p4).toFixed(3)
  },
  conflicts,
  totals,
  headline,
  error_domains,
  error_domains_more
}

const receipts = audit.map(a => ({
  agent: a.agent,
  cites: a.results.map(r => ({
    claim: r.claim,
    url: r.source_url,
    verdict: r.verdict,
    evidence: r.evidence || '',
    excerpt: (r.excerpt || '').slice(0, 700),
    confidence: r.confidence,
    error: r.error || ''
  }))
}))

fs.writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify({ meta, board, pending, receipts }, null, 2))

// ── doesitlie.csv — flat per-agent metrics ──
const csvCols = ['agent', 'provider', 'total', 'scorable', 'coverage', 'Supported', 'Partial', 'Unsupported', 'Fabricated', 'Error', 'fabricatedRate', 'unsupportedRate', 'supportedOfTotal', 'supportRate']
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const csv = [csvCols.join(',')].concat(board.map(b =>
  csvCols.map(c => csvCell(c in b ? b[c] : b.counts[c])).join(',')
)).join('\n') + '\n'
fs.writeFileSync(new URL('./doesitlie.csv', import.meta.url), csv)

// ── badge.json — shields.io endpoint (https://img.shields.io/endpoint?url=<SITE_URL>/badge.json) ──
fs.writeFileSync(new URL('./badge.json', import.meta.url), JSON.stringify({
  schemaVersion: 1,
  label: 'doesitlie',
  message: `1 in ${headline.oneIn} citations not fully supported · ${meta.generated}`,
  color: 'firebrick'
}, null, 2))

// ── og.html — 1200×630 share-card artboard. After each rebuild, screenshot it to og.png:
//    browse: viewport 1200x630 → goto http://localhost:8899/og.html → screenshot --viewport og.png
const ogPhrase = headline.oneIn ? `1 in ${headline.oneIn}` : `${headline.pct}%`
const ogBar = ['Supported', 'Partial', 'Unsupported', 'Fabricated']
  .map(k => totals[k] ? `<span class="b ${k.toLowerCase()}" style="width:${(totals[k] / totals.total * 100).toFixed(2)}%"></span>` : '')
  .join('')
fs.writeFileSync(new URL('./og.html', import.meta.url), `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: "Caslon Display"; src: url(fonts/caslon-display-400.woff2) format("woff2"); }
@font-face { font-family: "Caslon Text"; src: url(fonts/caslon-text-400.woff2) format("woff2"); }
@font-face { font-family: "Plex Mono"; src: url(fonts/plexmono-500.woff2) format("woff2"); font-weight: 500; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; background: oklch(0.185 0.010 60); color: oklch(0.93 0.012 85);
  font-family: "Plex Mono", monospace; position: relative; overflow: hidden; padding: 60px 64px; }
body::before { content: ""; position: absolute; inset: 0; opacity: 0.18; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E"); }
.kicker { font-size: 20px; font-weight: 500; letter-spacing: 0.02em; color: oklch(0.62 0.012 72); }
.kicker .kb { text-transform: uppercase; letter-spacing: 0.16em; }
.big { font-family: "Caslon Display", serif; font-size: 225px; line-height: 0.98; letter-spacing: -0.01em; margin-top: 26px; }
.line { font-family: "Caslon Text", serif; font-size: 35px; line-height: 1.32; color: oklch(0.75 0.014 78); max-width: 740px; margin-top: 16px; }
.stats { position: absolute; left: 64px; bottom: 52px; font-size: 20px; font-weight: 500; color: oklch(0.62 0.012 72); }
.stamp { position: absolute; right: 72px; bottom: 96px; width: 175px; height: 175px; border-radius: 50%;
  border: 3px solid oklch(0.66 0.16 33); color: oklch(0.66 0.16 33); display: grid; place-content: center;
  text-align: center; transform: rotate(-8deg); font-weight: 500;
  box-shadow: inset 0 0 0 7px oklch(0.185 0.010 60), inset 0 0 0 10px oklch(0.66 0.16 33); }
.stamp .a { font-size: 22px; letter-spacing: 0.13em; }
.stamp .c { font-size: 13px; letter-spacing: 0.17em; margin-top: 7px; opacity: 0.85; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 14px; display: flex; background: oklch(0.235 0.012 60); }
.bar .b { height: 100%; }
.b.supported { background: oklch(0.74 0.14 153); } .b.partial { background: oklch(0.76 0.10 100); }
.b.unsupported { background: oklch(0.76 0.14 72); } .b.fabricated { background: oklch(0.66 0.19 28); }
</style></head><body>
<div class="kicker"><span class="kb">doesitlie</span> · the citation-honesty record</div>
<div class="big">${ogPhrase}</div>
<div class="line">checkable citations from frontier AI research agents doesn't fully hold up against the source it cites.</div>
<div class="stats">${totals.total} citations · ${meta.topics} legal briefs · every verdict opens its source</div>
<div class="stamp"><span class="a">NEUTRAL</span><span class="c">NO VENDOR $</span></div>
<div class="bar">${ogBar}</div>
</body></html>
`)

// ── inject crawler-visible values into index.html (crawlers don't run JS; OG cards must be truthful) ──
const phrase = headline.oneIn ? `1 in ${headline.oneIn}` : `${headline.pct}%`
const heroN = `${notFully} of ${totals.scorable} checkable · ${totals.total} filed · ${board.length} agents · ${meta.topics} legal briefs`
const titleText = `doesitlie — ${phrase} checkable AI citations doesn't fully hold up`
const ogTitle = `${phrase} checkable AI citations doesn't fully hold up — doesitlie`
const desc = `A neutral, auditable record of citation honesty in AI deep-research agents. ${totals.total} citations checked against their own sources; every verdict opens its receipt. No vendor money.`
const errShare = `${pct1(totals.Error / totals.total)}%`

const jsonld = {
  '@context': 'https://schema.org',
  '@type': 'Dataset',
  name: 'doesitlie — citation-honesty audit of AI deep-research agents',
  description: desc,
  url: SITE_URL,
  sameAs: REPO_URL,
  license: 'https://creativecommons.org/licenses/by/4.0/',
  isAccessibleForFree: true,
  dateModified: meta.generated,
  distribution: [
    { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE_URL}/data.json` },
    { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE_URL}/doesitlie.csv` }
  ]
}

let html = fs.readFileSync(indexUrl, 'utf-8')
const before = html
// Function replacers throughout: a string replacement would interpret $1/$&/$' in the
// injected value, silently corrupting the written HTML if a value ever contains "$".
const span = (name, val) => {
  html = html.replace(new RegExp(`(<!-- auto:${name} -->)[\\s\\S]*?(<!-- /auto:${name} -->)`), (_, open, close) => open + val + close)
}
const metaTag = (attr, name, val) => {
  html = html.replace(new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`), (_, open, close) => open + val.replace(/"/g, '&quot;') + close)
}
html = html.replace(/(<title>)[^<]*(<\/title>)/, (_, open, close) => open + titleText + close)
metaTag('name', 'description', desc)
metaTag('name', 'twitter:title', ogTitle)
metaTag('property', 'og:title', ogTitle)
metaTag('property', 'og:description', desc)
span('big', phrase)
span('n', heroN)
span('errshare', errShare)
span('jsonld', `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`)
if (html !== before) fs.writeFileSync(indexUrl, html)

console.log(`data.json: ${board.length} agents (+${pending.length} docketed) · headline ${phrase} (${headline.pct}% of ${totals.scorable} checkable; strict ${headline.strict.pct}%) · gold ${meta.gold_n} · binary ${meta.agreement.binary_pct}% κ=${meta.agreement.binary_kappa} · exact ${meta.agreement.exact_pct}% κ=${meta.agreement.exact_kappa} · ${conflicts.length} conflicts · ${error_domains.length}+${error_domains_more} error domains`)
