#!/usr/bin/env node
/**
 * signal_separation_probe.mjs — can the relevance signals say "irrelevant" at all?
 *
 * Tier C concluded that the stack's relevance signals are saturated: cosine never drops below
 * 0.731, the stage-2 LLM's median score sits at the ceiling, trust is structurally 0. From that
 * came the recommendation to replace the embedder rather than tune thresholds.
 *
 * But every one of those numbers was measured on Brave's own top-20 for well-formed queries.
 * Two very different states produce identical readings there:
 *
 *   A. the signals cannot discriminate  → replace the embedder
 *   B. Brave's top-20 is uniformly relevant, so there is nothing to discriminate
 *      → the signals are fine and the quality gate is simply unnecessary
 *
 * This separates them. Into each question's own top-10 it injects 10 REAL documents pulled from
 * unrelated corpus topics — cooking, trekking, metallurgy, obstetrics, Soviet history. Real pages
 * with real titles and text, just about something else; not gibberish, which would make the test
 * trivially easy and prove nothing about production behaviour.
 *
 * Decision rule, fixed before the run:
 *   injected median cosine at least 0.05 BELOW own median, AND the LLM scoring most injected <= 2
 *     → the signals DO discriminate; the "saturated" conclusion is RETRACTED and replaced by
 *       "Brave's top-20 is uniformly relevant, so the gate has nothing to cut".
 *   no separation on either signal
 *     → "saturated" confirmed, and strengthened: the signals cannot even reject a cooking blog.
 *   separation on the LLM only
 *     → the conclusion splits: the embedder is weak, stage 2 works.
 *
 * Reads only, no paid backend. Usage:
 *   node scripts/signal_separation_probe.mjs [--per-side 10] [--json out.json]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import '../src/env.js'
import { rerankByEmbedding } from '../src/rerank/embedding_rerank.js'
import { rerankByLLM } from '../src/rerank/llm_rerank.js'
import { compositeScore } from '../src/rerank/quality_gate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d }
const PER_SIDE = Number(arg('--per-side', '10'))
const MEILI = process.env.MEILISEARCH_URL || 'http://127.0.0.1:7700'
const KEY = process.env.MEILISEARCH_KEY || 'masterKey'

// Deliberately far from RU legal/fintech, and all present in this corpus.
const FOREIGN_TOPICS = [
  'рецепт теста выпечка духовка ингредиенты',
  'треккинг маршрут горы поход снаряжение',
  'металлургия дефекты поверхности прокат сталь',
  'беременность триместр анализы наблюдение',
  'игровой движок разработка Unity сцена'
]

async function foreignPool () {
  const out = []
  const seen = new Set()
  for (const topic of FOREIGN_TOPICS) {
    const r = await fetch(`${MEILI}/indexes/qsearch_corpus/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: topic, limit: 12, attributesToRetrieve: ['url', 'title', 'text'] })
    }).then(x => x.json())
    for (const h of (r.hits || [])) {
      if (!h.url || seen.has(h.url) || !h.title) continue
      seen.add(h.url)
      out.push({ url: h.url, title: h.title, description: (h.text || '').slice(0, 300), _foreign: true, _topic: topic })
    }
  }
  return out
}

const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN

const questions = readFileSync(join(__dirname, '..', 'bench', 'ru', 'questions.jsonl'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))

const pool = await foreignPool()
if (pool.length < PER_SIDE) {
  console.error(`foreign pool too small (${pool.length}) — the corpus may not hold these topics.`)
  process.exit(1)
}
console.log(`signal separation probe — ${questions.length} questions, ${PER_SIDE} own + ${PER_SIDE} injected each`)
console.log(`foreign pool: ${pool.length} real documents from ${FOREIGN_TOPICS.length} unrelated topics\n`)

const own = { emb: [], llm: [], comp: [] }
const foreign = { emb: [], llm: [], comp: [] }
const rows = []

console.log('   own emb  inj emb   Δ      own llm  inj llm   query')
for (let qi = 0; qi < questions.length; qi++) {
  const q = questions[qi]
  let web
  try { web = JSON.parse(readFileSync(q.pair_web, 'utf8')) } catch { continue }
  const query = web?.query?.original || q.question
  const mine = (web?.web?.results || []).filter(r => r?.url).slice(0, PER_SIDE)
    .map(r => ({ url: r.url, title: r.title || '', description: r.description || '', _foreign: false }))
  if (mine.length < 3) continue

  // Deterministic, different slice per question so one unlucky document cannot drive the result.
  const inj = Array.from({ length: PER_SIDE }, (_, k) => pool[(qi * 7 + k * 3) % pool.length])
  const cands = [...mine, ...inj]

  const { reranked, skipped } = await rerankByEmbedding(query, cands)
  if (skipped) { console.log(`   (stage 1 skipped: ${q.id})`); continue }
  // topOut = full length so every scored item comes back, not just the surviving five.
  const r2 = await rerankByLLM(query, reranked, { topIn: cands.length, topOut: cands.length })

  const byOwn = { emb: [], llm: [], comp: [] }
  const byInj = { emb: [], llm: [], comp: [] }
  for (const r of r2.reranked) {
    const bucket = r._foreign ? byInj : byOwn
    bucket.emb.push(r._rerank_score ?? 0)
    bucket.llm.push(r._rerank_score_llm ?? null)
    bucket.comp.push(compositeScore(r).composite)
  }
  const llmOwn = byOwn.llm.filter(x => x != null)
  const llmInj = byInj.llm.filter(x => x != null)

  own.emb.push(...byOwn.emb); own.llm.push(...llmOwn); own.comp.push(...byOwn.comp)
  foreign.emb.push(...byInj.emb); foreign.llm.push(...llmInj); foreign.comp.push(...byInj.comp)

  const d = median(byOwn.emb) - median(byInj.emb)
  rows.push({
    id: q.id, query,
    own_emb_median: median(byOwn.emb), inj_emb_median: median(byInj.emb), emb_delta: d,
    own_llm_median: median(llmOwn), inj_llm_median: median(llmInj),
    own_comp_median: median(byOwn.comp), inj_comp_median: median(byInj.comp)
  })
  console.log(`   ${median(byOwn.emb).toFixed(3)}    ${median(byInj.emb).toFixed(3)}   ${d >= 0 ? '+' : ''}${d.toFixed(3)}    ${median(llmOwn).toFixed(1)}      ${median(llmInj).toFixed(1)}     ${query.slice(0, 34)}`)
}

const embDelta = median(own.emb) - median(foreign.emb)
const injLowLlm = foreign.llm.filter(s => s <= 2).length / (foreign.llm.length || 1)
const ownLowLlm = own.llm.filter(s => s <= 2).length / (own.llm.length || 1)

console.log('\n' + '='.repeat(74))
console.log(`                     own (${own.emb.length})        injected (${foreign.emb.length})`)
console.log(`cosine   median      ${median(own.emb).toFixed(4)}            ${median(foreign.emb).toFixed(4)}      Δ ${embDelta >= 0 ? '+' : ''}${embDelta.toFixed(4)}`)
console.log(`cosine   min         ${Math.min(...own.emb).toFixed(4)}            ${Math.min(...foreign.emb).toFixed(4)}`)
console.log(`cosine   mean        ${mean(own.emb).toFixed(4)}            ${mean(foreign.emb).toFixed(4)}`)
console.log(`llm 1-5  median      ${median(own.llm).toFixed(2)}              ${median(foreign.llm).toFixed(2)}`)
console.log(`llm <= 2 share       ${(100 * ownLowLlm).toFixed(1)}%             ${(100 * injLowLlm).toFixed(1)}%`)
console.log(`composite median     ${median(own.comp).toFixed(4)}            ${median(foreign.comp).toFixed(4)}`)

// What the shipped gate (threshold 0.4) would actually do to each side.
const gateCut = xs => xs.filter(c => c < 0.4).length / (xs.length || 1)
console.log(`\nshipped gate @0.4 would reject:  own ${(100 * gateCut(own.comp)).toFixed(1)}%   injected ${(100 * gateCut(foreign.comp)).toFixed(1)}%`)

console.log('\n' + '='.repeat(74))
const embSeparates = embDelta >= 0.05
const llmSeparates = injLowLlm > 0.5
if (embSeparates && llmSeparates) {
  console.log('VERDICT: both signals discriminate. The "signals are saturated" conclusion is RETRACTED.')
  console.log('  Correct reading: Brave\'s top-20 is uniformly relevant, so there is nothing for the')
  console.log('  gate to cut and little for rerank to reorder. Replacing the embedder would not help;')
  console.log('  the gate is unnecessary rather than broken.')
} else if (!embSeparates && !llmSeparates) {
  console.log('VERDICT: neither signal separates real documents about an unrelated subject.')
  console.log('  "Saturated" is confirmed and stronger than stated — they cannot reject a cooking blog.')
} else if (llmSeparates && !embSeparates) {
  console.log('VERDICT: the LLM separates, the embedder does not. The conclusion SPLITS:')
  console.log('  stage 2 carries real signal; stage 1 (nomic-embed-text cosine) does not.')
  console.log('  Replacing the embedder is justified; writing off the whole stack is not.')
} else {
  console.log('VERDICT: the embedder separates but the LLM does not — the reverse of the assumption.')
  console.log('  Stage 2 scoring, not the embedder, is the component to question.')
}

const out = arg('--json', null)
if (out) {
  writeFileSync(out, JSON.stringify({
    generated: new Date().toISOString(), per_side: PER_SIDE, foreign_topics: FOREIGN_TOPICS,
    foreign_pool_size: pool.length,
    summary: {
      own_emb_median: median(own.emb), inj_emb_median: median(foreign.emb), emb_delta: embDelta,
      own_llm_median: median(own.llm), inj_llm_median: median(foreign.llm),
      inj_llm_le2_share: injLowLlm, own_llm_le2_share: ownLowLlm,
      own_comp_median: median(own.comp), inj_comp_median: median(foreign.comp),
      gate_reject_own: gateCut(own.comp), gate_reject_injected: gateCut(foreign.comp)
    },
    rows
  }, null, 2))
  console.log(`\nwrote ${out}`)
}
