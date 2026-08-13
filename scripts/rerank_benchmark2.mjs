#!/usr/bin/env node
/**
 * rerank_benchmark2.mjs — does the rerank pipeline actually improve ordering?
 *
 * Replaces scripts/rerank_benchmark.js, which could not answer that question. Four defects,
 * each verified against the source before this was written:
 *
 *  1. It POSTed to /search (rerank_benchmark.js:34), but rerankPipeline is invoked only from
 *     /sweep and /cached_sweep (server.js:987, :1341). handleSearch never calls it. Toggling
 *     QSEARCH_RERANK_ENABLED therefore changed nothing, and the measured "lift" was
 *     structurally zero plus backend noise.
 *  2. ndcgForRanking built its ideal from the RETRIEVED list, so the metric was blind to
 *     recall — one relevant document of three, at rank 1, scored a perfect 1.000. The
 *     pipeline truncates (topN 10 → topOut 5), so the old metric rewarded it for discarding.
 *  3. Two contradictory decision rules: "<5% lift" (relative, :12) vs "lift < 0.05"
 *     (absolute, :60). Neither was enforced — nothing was stored, subtracted or asserted.
 *  4. URLs were matched as exact strings while the golden set uses trailing slashes and the
 *     corpus canonicalises, guaranteeing false zeros; failed queries were dropped from the
 *     mean instead of scored 0, so a failure improved the result.
 *
 * How this version works instead. One candidate set per query, three arms scored on it:
 *   baseline — corpus order, trust-rerank off
 *   rerank   — rerankPipeline applied IN-PROCESS to those same candidates
 *   random   — seeded shuffle of those same candidates (the control ANALYSIS-2026-06-23.md:147
 *              asked for and the old script never implemented)
 * The random arm is what proves the metric discriminates at all. Without it, a small lift is
 * indistinguishable from noise.
 *
 * Decision rule, fixed here and stated before running:
 *   mean NDCG@k lift (rerank − baseline) < 0.05 absolute → the embedder is too weak for this
 *   corpus; evaluate BGE / E5 rather than shipping rerank. Absolute, not relative, because a
 *   baseline near zero makes a percentage meaningless.
 *
 * Usage:
 *   node scripts/rerank_benchmark2.mjs [--from pairs|corpus] [--golden <path>] [--k 5] [--json out.json]
 *   node scripts/rerank_benchmark2.mjs --selftest
 *
 * Both candidate sources are read-only and cost $0: `pairs` reads saved sweep files from disk,
 * `corpus` queries the local index with corpus_only so it can never fall through to paid Brave.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ndcgForRanking, normalizeUrlKey } from '../src/rerank/ndcg.js'

// pipeline.js reads QSEARCH_RERANK_ENABLED at MODULE SCOPE, so the flag has to be set before
// that module is evaluated — and a static `import` would not be, because ESM hoists every
// import above the file's own statements. Writing
//     process.env.QSEARCH_RERANK_ENABLED = 'true'
//     import { rerankPipeline } from '../src/rerank/pipeline.js'
// looks correct and silently runs the whole benchmark with the pipeline DISABLED, reporting
// a lift of exactly 0.0000. That happened here on the first run. It is the same defect that
// made .env.local unreachable in server.js (see src/env.js). Dynamic import is the fix:
// it evaluates at this line, after the assignment.
process.env.QSEARCH_RERANK_ENABLED = 'true'
const { rerankPipeline } = await import('../src/rerank/pipeline.js')

const __dirname = dirname(fileURLToPath(import.meta.url))

/** bench id → question record, for resolving pair_web paths in `pairs` mode. */
const benchIndex = new Map()
try {
  for (const line of readFileSync(join(__dirname, '..', 'bench', 'ru', 'questions.jsonl'), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    const q = JSON.parse(line)
    if (q.id) benchIndex.set(q.id, q)
  }
} catch { /* corpus mode does not need it; pairs mode reports the miss per query */ }

function arg (name, dflt) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const flag = n => process.argv.includes(n)

const BASE = process.env.QSEARCH_URL || 'http://localhost:8080'
const K = Number(arg('--k', '5'))
const CANDIDATES = Number(arg('--candidates', '20'))
const LIFT_THRESHOLD = 0.05
// R2b: one fixed seed (42) is one draw from the random arm's distribution, not the distribution
// itself. --seeds N reruns the random arm over N different seeds and reports mean/stddev, so a
// small lift can be read against how much the control itself moves between draws. 0 = off, and
// the default single-seed report below is completely unchanged when it's off.
const SEEDS = Number(arg('--seeds', '0'))

/**
 * Where the candidate list comes from. This is not a cosmetic switch — it decides what the
 * benchmark is capable of measuring at all.
 *
 *  pairs  (default) — the saved Brave sweep results for that query, in Brave's own order.
 *      This is what rerankPipeline actually receives in production: it is called from /sweep
 *      and /cached_sweep (server.js:987, :1341) over Brave output, never over corpus output.
 *      It is also where the golden grades came from, so the graded documents are present by
 *      construction and NDCG measures ORDERING, which is the question being asked.
 *
 *  corpus — 20 hits from POST /search. Measured first and kept for comparison, but it cannot
 *      answer the question: only 31.1% of graded URLs (80/257) appear in that pool and 6 of 26
 *      queries contain none at all, so every arm scores 0 on them. Reordering documents that
 *      are absent is impossible, which compressed the control spread to 0.045 and forced an
 *      INCONCLUSIVE verdict. It also measures corpus retrieval, not the reranker.
 */
const FROM = arg('--from', 'pairs')

/** Deterministic shuffle — a benchmark that cannot be repeated is not a measurement. */
export function seededShuffle (arr, seed = 42) {
  const a = [...arr]
  let s = seed >>> 0
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000 }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Neutral candidate set: corpus order with trust-rerank explicitly off, so the baseline arm
 * is not already reranked by something else. clean:false skips the local LLM pass.
 */
async function candidatesFromCorpus (query) {
  // corpus_only so a corpus miss cannot fall through to PAID Brave. handleSearch returns the
  // corpus list only when it holds >= n_results hits (server.js:266); below that it queries
  // Brave. Unguarded, a thin-corpus query would silently bill a live sweep mid-benchmark.
  const r = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, n_results: CANDIDATES, clean: false, rerank_by_trust: false, corpus_only: true })
  })
  if (!r.ok) throw new Error(`/search ${r.status}`)
  const body = await r.json()
  return (body.results || []).filter(x => x && x.url)
}

/** Brave's saved sweep output for one bench question, in Brave's original ranking. Costs $0. */
function candidatesFromPairs (benchId) {
  const q = benchIndex.get(benchId)
  if (!q) throw new Error(`no bench entry for ${benchId}`)
  const web = JSON.parse(readFileSync(q.pair_web, 'utf8'))
  const out = []
  const seen = new Set()
  for (const r of (web?.web?.results || [])) {
    if (!r?.url) continue
    const k = normalizeUrlKey(r.url)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ url: r.url, title: r.title || '', description: r.description || '' })
  }
  if (!out.length) throw new Error('pair file held no web results')
  return out.slice(0, CANDIDATES)
}

/** Apply the shipped pipeline to a candidate list, in process, and return the new order. */
async function applyRerank (query, results) {
  const merged = new Map([['q', {
    query, priority: 'critical', domain: 'general', results: results.map(r => ({ ...r })), ok: true
  }]])
  const stats = await rerankPipeline(merged)
  return { urls: (merged.get('q').results || []).map(r => r.url), stats }
}

const score = (urls, relevance) =>
  ndcgForRanking(urls, relevance, K, { idealFromGolden: true, normalizeUrls: true })

function selftest () {
  const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m) }
  const a = seededShuffle([1, 2, 3, 4, 5], 7)
  const b = seededShuffle([1, 2, 3, 4, 5], 7)
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed must give the same order')
  ok(JSON.stringify(seededShuffle([1, 2, 3, 4, 5], 8)) !== JSON.stringify(a), 'different seed, different order')
  ok(a.length === 5 && new Set(a).size === 5, 'shuffle must not lose or duplicate elements')

  const rel = { 'https://a.com/x': 3, 'https://b.com/y': 2 }
  ok(score(['https://a.com/x/', 'https://b.com/y'], rel) === 1, 'trailing slash must still match')
  ok(score([], rel) === 0, 'empty ranking scores 0, not NaN')
  ok(score(['https://a.com/x'], rel) < 1, 'missing a relevant doc must cost score')
  console.log('selftest: 6 assertions OK')
}

async function main () {
  if (flag('--selftest')) return selftest()

  const goldenPath = arg('--golden', join(__dirname, '..', 'test', 'integration', 'golden', 'rerank_golden.json'))
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
  const queries = (golden.queries || []).filter(q => q.query && q.relevance && Object.keys(q.relevance).length)
  if (!queries.length) {
    console.error(`Golden set at ${goldenPath} has no usable queries.`)
    process.exit(1)
  }
  if (queries.length < 20) {
    console.warn(`⚠ only ${queries.length} golden queries; the file's own guidance asks for 20+. Treat the number as indicative.`)
  }

  const arms = { baseline: [], rerank: [], random: [] }
  const rows = []
  // R2b: (baseUrls, relevance) per successfully-scored query, kept so the multi-seed sweep below
  // can reuse the exact same candidate pools instead of re-fetching (cheap for --from pairs, but
  // this stays correct for --from corpus too, where re-fetching would also re-roll a live query).
  const queryPools = []
  console.log(`NDCG@${K}, recall-aware, ${queries.length} queries, ${CANDIDATES} candidates each, from=${FROM}\n`)
  console.log('  base   rerank  random  pool  query')

  for (const q of queries) {
    let cands
    try {
      cands = FROM === 'pairs' ? candidatesFromPairs(q._bench_id) : await candidatesFromCorpus(q.query)
    } catch (e) {
      // Scored as 0, never dropped: silently shrinking n let a failure improve the mean.
      arms.baseline.push(0); arms.rerank.push(0); arms.random.push(0)
      rows.push({ query: q.query, error: e.message, baseline: 0, rerank: 0, random: 0 })
      console.log(`  ----   ----    ----     ${q.query.slice(0, 52)}  (${e.message})`)
      continue
    }

    const baseUrls = cands.map(r => r.url)
    const { urls: rerankUrls, stats } = await applyRerank(q.query, cands)
    const randUrls = seededShuffle(baseUrls)

    // How many graded documents the pool actually contains. Printed per query and aggregated,
    // because a pool that holds none of them makes every arm score 0 and silently flattens the
    // whole measurement — the failure that made the corpus-mode run uninterpretable.
    const inPool = new Set(baseUrls.map(normalizeUrlKey))
    const graded = Object.keys(q.relevance).map(normalizeUrlKey)
    const poolHits = graded.filter(u => inPool.has(u)).length

    const s = {
      baseline: score(baseUrls, q.relevance),
      rerank: score(rerankUrls, q.relevance),
      random: score(randUrls, q.relevance)
    }
    for (const k of Object.keys(arms)) arms[k].push(s[k])
    queryPools.push({ baseUrls, relevance: q.relevance })
    rows.push({ query: q.query, candidates: cands.length, kept: rerankUrls.length, graded: graded.length, pool_hits: poolHits, ...s, stats })
    console.log(`  ${s.baseline.toFixed(3)}  ${s.rerank.toFixed(3)}   ${s.random.toFixed(3)}  ${String(poolHits).padStart(2)}/${String(graded.length).padEnd(2)} ${q.query.slice(0, 46)}`)
  }

  // Refuse to report a lift the run could not have produced. A pipeline that never executed
  // yields a perfect 0.0000 difference, which reads like a clean negative result and is not
  // one — it is a broken harness. This guard exists because that is exactly what happened.
  const ranCount = rows.filter(r => r.stats?.ran).length
  const scored = rows.filter(r => !r.error).length
  if (scored === 0) {
    console.error('\n✖ ABORT: every query failed to produce candidates — nothing was measured.')
    console.error(`  first error: ${rows.find(r => r.error)?.error}`)
    process.exit(4)
  }
  if (scored && ranCount === 0) {
    console.error('\n✖ ABORT: rerankPipeline never executed on any query.')
    console.error(`  reason reported: ${JSON.stringify(rows.find(r => r.stats)?.stats)}`)
    console.error('  The measurement is void — a disabled pipeline always shows zero lift.')
    process.exit(3)
  }
  if (ranCount < scored) {
    console.warn(`\n⚠ pipeline ran on only ${ranCount}/${scored} scored queries — read the lift with that in mind.`)
  }

  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1)
  const stddev = a => { const mu = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / (a.length > 1 ? a.length - 1 : 1)) } // sample stddev (n-1)
  const m = { baseline: mean(arms.baseline), rerank: mean(arms.rerank), random: mean(arms.random) }
  const lift = m.rerank - m.baseline
  const spread = m.baseline - m.random

  const gradedTotal = rows.reduce((a, r) => a + (r.graded || 0), 0)
  const poolTotal = rows.reduce((a, r) => a + (r.pool_hits || 0), 0)
  const emptyPools = rows.filter(r => !r.error && r.pool_hits === 0).length
  const coverage = gradedTotal ? poolTotal / gradedTotal : 0

  console.log('\n' + '='.repeat(64))
  console.log(`mean NDCG@${K}   baseline ${m.baseline.toFixed(4)}   rerank ${m.rerank.toFixed(4)}   random ${m.random.toFixed(4)}`)
  console.log(`lift (rerank − baseline) : ${lift >= 0 ? '+' : ''}${lift.toFixed(4)}`)
  console.log(`spread (baseline − random): ${spread >= 0 ? '+' : ''}${spread.toFixed(4)}`)
  console.log(`graded docs inside the candidate pool: ${poolTotal}/${gradedTotal} (${(100 * coverage).toFixed(1)}%), ${emptyPools} queries with an empty pool`)
  console.log('')

  // Reordering a document the pool does not contain is impossible, so below a floor of pool
  // coverage the lift is bounded near zero by construction and says nothing about the reranker.
  if (coverage < 0.5) {
    console.log(`⚠ POOL TOO THIN — only ${(100 * coverage).toFixed(1)}% of graded documents are in the candidate list.`)
    console.log('  Most relevant documents are absent, so no ordering of what remains can move NDCG')
    console.log('  much. This measures retrieval, not reranking. Use --from pairs.')
  }

  // The control arm gates the whole reading: if ordering the corpus at random scores about
  // as well as the real ranking, the metric or the golden set is not measuring ranking, and
  // the lift number means nothing whatever its sign.
  if (spread < 0.05) {
    console.log('⚠ INCONCLUSIVE — random ordering scores about as well as the baseline.')
    console.log('  The golden set or the candidate pool is not discriminating. Fix that before')
    console.log('  reading the lift; do not flip QSEARCH_RERANK_ENABLED on this evidence.')
  } else if (lift < LIFT_THRESHOLD) {
    console.log(`VERDICT: lift ${lift.toFixed(4)} < ${LIFT_THRESHOLD} → embedder too weak for this corpus.`)
    console.log('  Do not enable rerank. Evaluate BGE / E5 instead (ANALYSIS-2026-06-23.md T4).')
  } else {
    console.log(`VERDICT: lift ${lift.toFixed(4)} ≥ ${LIFT_THRESHOLD} → rerank measurably improves ordering.`)
    console.log('  Enabling QSEARCH_RERANK_ENABLED is supported by this measurement.')
  }

  // R2b — multi-seed control: one seeded shuffle is one draw, not a distribution. Reruns the
  // random arm over SEEDS different permutations (42, 43, 43+SEEDS-1 — seed 42 is draw 0, so the
  // default single-seed number above is literally the first sample of this distribution) and
  // reports mean/stddev across draws. Off by default; the block above never sees this.
  let multiSeedRandom = null
  if (SEEDS > 0) {
    const seedList = Array.from({ length: SEEDS }, (_, i) => 42 + i)
    const perSeedMean = seedList.map(seed =>
      mean(queryPools.map(({ baseUrls, relevance }) => score(seededShuffle(baseUrls, seed), relevance))))
    multiSeedRandom = {
      seeds: SEEDS, seedList, perSeedMean, mean: mean(perSeedMean), stddev: stddev(perSeedMean),
      note: 'each entry in perSeedMean is the random arm\'s mean NDCG over all scored queries for one seed; mean/stddev are computed ACROSS those seeds (sample stddev, n-1)'
    }
    console.log(`\nmulti-seed random control (${SEEDS} seeds, same ${queryPools.length} query pools): ` +
      `mean NDCG@${K} = ${multiSeedRandom.mean.toFixed(4)}, stddev = ${multiSeedRandom.stddev.toFixed(4)}`)
    console.log(`  per-seed means: ${perSeedMean.map(v => v.toFixed(4)).join(', ')}`)
    console.log(`  (single-seed report above used seed 42, draw 0 of this same distribution: ${perSeedMean[0]?.toFixed(4)})`)
  }

  const out = arg('--json', null)
  if (out) {
    writeFileSync(out, JSON.stringify({
      generated: new Date().toISOString(), k: K, candidates: CANDIDATES, from: FROM,
      goldenPath, n: queries.length, means: m, lift, spread, threshold: LIFT_THRESHOLD,
      pool_coverage: coverage, empty_pools: emptyPools, rows,
      ...(multiSeedRandom ? { multi_seed_random_control: multiSeedRandom } : {})
    }, null, 2))
    console.log(`\nwrote ${out}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
