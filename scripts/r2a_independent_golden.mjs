#!/usr/bin/env node
/**
 * r2a_independent_golden.mjs — build an independent rerank golden set.
 *
 * test/integration/golden/rerank_golden_ru.json grades 82.5% of its URLs as "2", which by its
 * own definition means only "Brave returned this in BOTH /web/search and /llm/context" — that
 * is retrieval overlap, not a relevance judgment. Since the candidate pool the benchmark scores
 * IS Brave's web output, the measurement is substantially circular.
 *
 * This grades the SAME candidate pool rerank_benchmark2.mjs actually uses in --from pairs mode
 * (the deduped, first-20 web results from each query's pair_web file — the same construction as
 * candidatesFromPairs() in rerank_benchmark2.mjs, duplicated here rather than imported so this
 * script has no side effects from that module's top-level dynamic pipeline import), 0-3 for
 * relevance, blind to web/context membership (the pool here is web-only, so that membership is
 * never even seen by the judge).
 *
 * Quality control: a random 20% of graded (query, url) pairs are re-graded in a second, fully
 * independent pass, and the exact-match agreement rate is reported. Below 70% the judge is too
 * noisy to base a conclusion on, and this script says so loudly rather than burying it.
 *
 * Reads only, $0: local Ollama. Sequential calls only — one GPU.
 *
 * Usage: node scripts/r2a_independent_golden.mjs
 *   writes test/integration/golden/rerank_golden_ru_independent.json (golden-shaped)
 *   writes bench/ru/r2a_grading_raw.json (full per-item pass1/pass2 detail)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalizeUrlKey } from '../src/rerank/ndcg.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const JUDGE_MODEL = 'qwen2.5:14b-instruct'
const TEMPERATURE = 0.1 // same as R3 — a strict judge with a little stochasticity, so the QC re-grade pass can actually surface noise
const CANDIDATES = 20   // matches rerank_benchmark2.mjs's --candidates default, since this must grade the SAME pool it uses
const QC_FRACTION = 0.2

function makeRng (seed) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000 }
}

/** Same construction as candidatesFromPairs() in rerank_benchmark2.mjs — duplicated, not imported. */
function candidatesFromPairs (pairWebPath) {
  const web = JSON.parse(readFileSync(pairWebPath, 'utf8'))
  const out = []
  const seen = new Set()
  for (const r of (web?.web?.results || [])) {
    if (!r?.url) continue
    const k = normalizeUrlKey(r.url)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ url: r.url, title: r.title || '', description: r.description || '' })
  }
  return out.slice(0, CANDIDATES)
}

const JUDGE_SYSTEM = `You are a strict relevance judge for a Russian-language legal/business search engine. You are given a QUERY and a CANDIDATE search result (title + description). Grade how relevant the candidate is to the query on a 0-3 scale:
3 = directly answers the query
2 = substantially relevant — same topic, useful context, but does not itself directly answer it
1 = tangential — mentions the topic but would not help answer the query
0 = irrelevant
Answer with exactly one digit: 0, 1, 2, or 3. No punctuation, no explanation, nothing else.`

function parseGrade (raw) {
  const m = String(raw || '').match(/[0-3]/)
  return m ? Number(m[0]) : null
}

async function gradeOne (query, title, description) {
  const prompt = `QUERY: ${query}\n\nCANDIDATE TITLE: ${title}\n\nCANDIDATE DESCRIPTION:\n${description}\n\nGrade 0-3. Answer with one digit only.`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60000)
  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: JUDGE_MODEL, system: JUDGE_SYSTEM, prompt, stream: false,
        options: { temperature: TEMPERATURE, num_ctx: 2048 }
      }),
      signal: ctrl.signal
    })
    if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
    const d = await r.json()
    const raw = String(d.response || '').trim()
    return { grade: parseGrade(raw), raw }
  } finally {
    clearTimeout(timer)
  }
}

async function main () {
  const golden = JSON.parse(readFileSync(join(ROOT, 'test', 'integration', 'golden', 'rerank_golden_ru.json'), 'utf8'))
  const questions = readFileSync(join(ROOT, 'bench', 'ru', 'questions.jsonl'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))
  const byId = new Map(questions.map(q => [q.id, q]))

  // ── pass 1: grade every candidate in every query's pool ──────────────────────
  const items = [] // flat list, one entry per (query, url) graded pair — full record, so QC can reuse it unchanged
  const perQuery = []

  for (const g of golden.queries) {
    const rec = byId.get(g._bench_id)
    if (!rec) { console.log(`SKIP ${g._bench_id}: no bench entry`); perQuery.push({ query: g.query, _bench_id: g._bench_id, error: 'no bench entry', candidates: [] }); continue }
    let cands
    try {
      cands = candidatesFromPairs(rec.pair_web)
    } catch (e) {
      console.log(`SKIP ${g._bench_id}: ${e.message}`)
      perQuery.push({ query: g.query, _bench_id: g._bench_id, error: e.message, candidates: [] })
      continue
    }
    console.log(`\n== ${g._bench_id} (${cands.length} candidates) — ${g.query.slice(0, 60)}`)
    const graded = []
    for (const c of cands) {
      const res = await gradeOne(g.query, c.title, c.description)
      const row = { query: g.query, _bench_id: g._bench_id, url: c.url, title: c.title, description: c.description, pass1_grade: res.grade, pass1_raw: res.raw }
      items.push(row)
      graded.push(row)
      console.log(`  ${res.grade === null ? '?' : res.grade}  ${c.url.slice(0, 70)}`)
    }
    perQuery.push({ query: g.query, _bench_id: g._bench_id, candidates: graded })
  }

  // ── QC pass: re-grade a random 20% of graded items, blind (independent fresh call) ──
  const rng = makeRng(20260804)
  const gradeable = items.filter(it => it.pass1_grade !== null)
  const idx = gradeable.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[idx[i], idx[j]] = [idx[j], idx[i]] }
  const qcCount = Math.round(gradeable.length * QC_FRACTION)
  const qcIdx = idx.slice(0, qcCount)

  console.log(`\n== QC pass: re-grading ${qcCount}/${gradeable.length} items (${(QC_FRACTION * 100).toFixed(0)}%), blind, independent second call ==`)
  let matches = 0
  let withinOne = 0
  const qcRows = []
  let n = 0
  for (const i of qcIdx) {
    const it = gradeable[i]
    const res = await gradeOne(it.query, it.title, it.description)
    n++
    const match = res.grade === it.pass1_grade
    const close = res.grade !== null && Math.abs(res.grade - it.pass1_grade) <= 1
    if (match) matches++
    if (close) withinOne++
    qcRows.push({ _bench_id: it._bench_id, url: it.url, pass1_grade: it.pass1_grade, pass2_grade: res.grade, pass2_raw: res.raw, match })
    console.log(`  [${n}/${qcCount}] pass1=${it.pass1_grade} pass2=${res.grade} match=${match}  ${it.url.slice(0, 55)}`)
  }

  const agreementRate = qcCount ? matches / qcCount : null
  const withinOneRate = qcCount ? withinOne / qcCount : null

  console.log('\n' + '='.repeat(60))
  console.log(`QC exact-match agreement: ${matches}/${qcCount} = ${agreementRate === null ? 'n/a' : (agreementRate * 100).toFixed(1) + '%'}`)
  console.log(`QC within-1 agreement:    ${withinOne}/${qcCount} = ${withinOneRate === null ? 'n/a' : (withinOneRate * 100).toFixed(1) + '%'}`)
  if (agreementRate !== null && agreementRate < 0.70) {
    console.log('\n*** WARNING: exact-match agreement below 70%. The judge is too noisy to base a conclusion on. ***')
  }

  // ── build golden-shaped output: only grades >= 1, same shape as the existing file ──
  const gradeDist = { 0: 0, 1: 0, 2: 0, 3: 0, null: 0 }
  const outQueries = perQuery.map(pq => {
    const relevance = {}
    for (const c of (pq.candidates || [])) {
      gradeDist[c.pass1_grade === null ? 'null' : c.pass1_grade]++
      if (c.pass1_grade !== null && c.pass1_grade >= 1) relevance[c.url] = c.pass1_grade
    }
    return { query: pq.query, relevance, _bench_id: pq._bench_id }
  })

  const goldenOut = {
    _comment: 'Independent grading (R2a): candidate pool = the SAME pairs pool rerank_benchmark2.mjs --from pairs uses (deduped, first 20 web results per query). Judge = qwen2.5:14b-instruct, temperature 0.1, graded 0-3 BLIND to web/context membership (pool is web-only). Built to test whether the original rerank_golden_ru.json (82.5% grade-2 = "returned in both web and context", i.e. retrieval overlap) was circular. Only grades >=1 kept.',
    generated: new Date().toISOString(),
    judge_model: JUDGE_MODEL,
    temperature: TEMPERATURE,
    candidates_per_query: CANDIDATES,
    qc: { fraction: QC_FRACTION, n: qcCount, exact_match_agreement: agreementRate, within_one_agreement: withinOneRate },
    grade_distribution: gradeDist,
    queries: outQueries
  }

  const goldenPath = join(ROOT, 'test', 'integration', 'golden', 'rerank_golden_ru_independent.json')
  writeFileSync(goldenPath, JSON.stringify(goldenOut, null, 2))
  console.log(`\nwrote ${goldenPath}`)

  const rawPath = join(ROOT, 'bench', 'ru', 'r2a_grading_raw.json')
  writeFileSync(rawPath, JSON.stringify({
    generated: new Date().toISOString(),
    judge_model: JUDGE_MODEL,
    temperature: TEMPERATURE,
    candidates_per_query: CANDIDATES,
    grade_distribution: gradeDist,
    qc: { fraction: QC_FRACTION, n: qcCount, exact_match_agreement: agreementRate, within_one_agreement: withinOneRate, rows: qcRows },
    per_query: perQuery
  }, null, 2))
  console.log(`wrote ${rawPath}`)
}

main().catch(e => { console.error(e); process.exit(1) })
