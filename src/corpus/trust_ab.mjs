// Trust formula A/B — measures v1 (production) vs v2 (candidate) BEFORE any switch.
//
// The guardrail is "A/B, never a blind swap": this prints what changes if you flip
// QSEARCH_TRUST_FORMULA=v2 — rank correlation, top-N churn, the zero-collapse URLs v2 rescues,
// and the score distribution shift. Read it, then decide; the live ranking is untouched until you flip.
//
// Data source: the real Meilisearch corpus when reachable (MEILI_URL / MEILI_MASTER_KEY), else a
// deterministic synthetic feature set that deliberately includes zero-engine sources (to exercise the
// v1 collapse). The mode is printed so the numbers are never mistaken for something they aren't.
//
// Usage: node src/corpus/trust_ab.mjs [--n 2000] [--top 20]

import { computeTrustV1, computeTrustV2 } from './trust.js'
import { topicOf } from './trust.js'

const argN = (() => { const i = process.argv.indexOf('--n'); return i > 0 ? +process.argv[i + 1] : 2000 })()
const TOP = (() => { const i = process.argv.indexOf('--top'); return i > 0 ? +process.argv[i + 1] : 20 })()

// ── deterministic PRNG so the synthetic comparison is reproducible run-to-run ──
function mulberry32 (seed) {
  let s = seed >>> 0
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function syntheticFeatures (n) {
  const r = mulberry32(42)
  const pick = arr => arr[(r() * arr.length) | 0]
  const out = []
  for (let i = 0; i < n; i++) {
    const sweepCount = 1 + ((r() ** 2 * 12) | 0)              // skewed: mostly few sweeps, some many
    // ~8% of URLs have NO engine data (corpus/academic sources) → v1 collapses them to 0
    const engineDiversity = r() < 0.08 ? 0 : 1 + ((r() * 6) | 0)
    const topicDiversity = 1 + ((r() ** 1.5 * 4) | 0)
    out.push({ url: `https://example.com/doc/${i}`, sweepCount, engineDiversity, topicDiversity, daysSinceLastSeen: null })
  }
  return out
}

async function realFeatures (n) {
  const url = process.env.MEILISEARCH_URL || process.env.MEILI_URL || 'http://localhost:7700'
  const key = process.env.MEILISEARCH_KEY || process.env.MEILI_MASTER_KEY || process.env.MEILI_KEY || ''
  const { Meilisearch } = await import('meilisearch')
  const client = new Meilisearch({ host: url, apiKey: key })
  await client.health() // throws if unreachable → caller falls back to synthetic
  const idx = client.index('qsearch_corpus')
  const { hits } = await idx.search('', { limit: n, attributesToRetrieve: ['url', 'engines', 'sweep_label', 'appeared_in_sweeps', 'crawled_at'] })
  // dedup by URL, aggregate RAW features (no v1 floors — we want to SEE the collapse)
  const byUrl = new Map()
  for (const h of hits) {
    if (!h.url) continue
    if (!byUrl.has(h.url)) byUrl.set(h.url, { sweepLabels: new Set(), engines: new Set() })
    const a = byUrl.get(h.url)
    if (h.sweep_label) a.sweepLabels.add(h.sweep_label)
    for (const e of h.engines || []) a.engines.add(e)
    for (const s of h.appeared_in_sweeps || []) if (s.sweep_label) a.sweepLabels.add(s.sweep_label)
  }
  return [...byUrl.entries()].map(([u, a]) => {
    const topics = new Set(); for (const l of a.sweepLabels) { const t = topicOf(l); if (t) topics.add(t) }
    return { url: u, sweepCount: a.sweepLabels.size, engineDiversity: a.engines.size, topicDiversity: topics.size, daysSinceLastSeen: null }
  })
}

// ── stats helpers ──
function ranks (vals) { // average-rank (ties handled) of each value's position when sorted desc
  const idx = vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0])
  const rank = new Array(vals.length)
  let i = 0
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) rank[idx[k][1]] = avg
    i = j + 1
  }
  return rank
}
function spearman (a, b) {
  const ra = ranks(a); const rb = ranks(b); const n = a.length
  const ma = ra.reduce((x, y) => x + y, 0) / n; const mb = rb.reduce((x, y) => x + y, 0) / n
  let num = 0; let da = 0; let db = 0
  for (let i = 0; i < n; i++) { const x = ra[i] - ma; const y = rb[i] - mb; num += x * y; da += x * x; db += y * y }
  return num / (Math.sqrt(da * db) || 1)
}
const pctile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0

async function main () {
  let features; let mode
  try { features = await realFeatures(argN); mode = `REAL corpus (Meilisearch, ${features.length} urls)` }
  catch (e) { features = syntheticFeatures(argN); mode = `SYNTHETIC (${features.length} urls; Meilisearch unreachable: ${e.message.slice(0, 50)})` }

  const rows = features.map(f => ({ url: f.url, v1: computeTrustV1(f), v2: computeTrustV2(f), f }))
  const v1s = rows.map(r => r.v1); const v2s = rows.map(r => r.v2)

  // zero-collapse: URLs v1 scores 0 (engineDiversity 0) despite real sweep history → v2 rescues
  const v1Zero = rows.filter(r => r.v1 === 0 && r.f.sweepCount > 0)
  const rescued = v1Zero.filter(r => r.v2 > 0)

  // ranking churn
  const rho = spearman(v1s, v2s)
  const top1 = new Set([...rows].sort((a, b) => b.v1 - a.v1).slice(0, TOP).map(r => r.url))
  const top2 = new Set([...rows].sort((a, b) => b.v2 - a.v2).slice(0, TOP).map(r => r.url))
  const overlap = [...top1].filter(u => top2.has(u)).length

  const r1 = ranks(v1s); const r2 = ranks(v2s)
  const moves = rows.map((r, i) => ({ url: r.url, d: Math.abs(r1[i] - r2[i]), v1: r.v1, v2: r.v2, f: r.f })).sort((a, b) => b.d - a.d)
  const medMove = moves.length ? moves[Math.floor(moves.length / 2)].d : 0

  const s1 = [...v1s].sort((a, b) => a - b); const s2 = [...v2s].sort((a, b) => a - b)
  const fmt = x => x.toFixed(2)

  console.log(`\nTrust formula A/B — v1 (production) vs v2 (candidate)`)
  console.log('─'.repeat(64))
  console.log(`data source : ${mode}`)
  console.log(`\nRanking agreement`)
  console.log(`  Spearman ρ(v1, v2)      : ${rho.toFixed(4)}   (1.0 = identical order)`)
  console.log(`  top-${TOP} overlap          : ${overlap}/${TOP} URLs shared`)
  console.log(`  median |rank change|    : ${medMove.toFixed(0)} positions`)
  console.log(`\nZero-collapse (the v1 defect v2 targets)`)
  console.log(`  v1 scores 0 despite sweeps : ${v1Zero.length} URLs`)
  console.log(`  …of which v2 rescues (>0)   : ${rescued.length} URLs`)
  console.log(`\nScore distribution            v1            v2`)
  for (const [label, p] of [['p50', 0.5], ['p90', 0.9], ['p99', 0.99], ['max', 1]]) {
    console.log(`  ${label.padEnd(4)}                    ${fmt(pctile(s1, p === 1 ? 0.999 : p)).padStart(8)}     ${fmt(pctile(s2, p === 1 ? 0.999 : p)).padStart(8)}`)
  }
  console.log(`\nBiggest rank movers (top 5):`)
  for (const m of moves.slice(0, 5)) console.log(`  Δ${String(m.d.toFixed(0)).padStart(4)}  v1=${fmt(m.v1).padStart(7)} v2=${fmt(m.v2).padStart(7)}  (sweeps=${m.f.sweepCount} engines=${m.f.engineDiversity} topics=${m.f.topicDiversity})`)
  console.log('─'.repeat(64))
  console.log(`verdict inputs → decide manually. To roll out: QSEARCH_TRUST_FORMULA=v2 (reversible).`)
  console.log(`Recommendation hint: v2 is worth it iff it rescues real zero-collapse URLs AND ρ stays high`)
  console.log(`(i.e. it fixes the defect without scrambling the overall order). ρ=${rho.toFixed(3)}, rescued=${rescued.length}.\n`)
}
main().catch(e => { console.error(e); process.exit(1) })
