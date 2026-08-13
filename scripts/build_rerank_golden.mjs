#!/usr/bin/env node
/**
 * build_rerank_golden.mjs — derive a RU golden relevance set for the rerank benchmark.
 *
 * The shipped golden set holds 2 English queries and 5 graded URLs, against its own stated
 * requirement of "20+ queries with 3+ graded URLs each". Two English queries also mis-target
 * the corpus: sampled across the full 359k index, it is 55.8% Russian by content and 38.9%
 * by host. Grading by hand would take hours and would not be reproducible.
 *
 * This derives grades from bench/ru/questions.jsonl, where the judgements already exist:
 *
 *   grade 3 — cited in the reference answer (`sources[]`). These URLs were read and used to
 *             write the answer, so relevance is established, not guessed.
 *   grade 2 — returned by BOTH /web/search and /llm/context for that query. Two independent
 *             retrieval paths surfacing the same source is real, if weaker, evidence.
 *   grade 1 — returned by /llm/context only. Context is selective (11.7 sources per query
 *             against web's 18.4), so inclusion carries some signal.
 *   grade 0 — everything else, by omission.
 *
 * A query is only emitted if enough of its graded URLs are ACTUALLY IN THE CORPUS. Grading a
 * document the index does not contain measures ingestion, not ranking: every arm scores zero
 * on it and the query only adds noise to the mean.
 *
 * Usage:
 *   node scripts/build_rerank_golden.mjs [--min-in-corpus 3] [--out <path>] [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalizeUrlKey } from '../src/rerank/ndcg.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MEILI = process.env.MEILISEARCH_URL || 'http://127.0.0.1:7700'
const MEILI_KEY = process.env.MEILISEARCH_KEY || 'masterKey'

function arg (name, dflt) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

const MIN_IN_CORPUS = Number(arg('--min-in-corpus', '3'))
const OUT = arg('--out', join(__dirname, '..', 'test', 'integration', 'golden', 'rerank_golden_ru.json'))

async function inCorpus (url) {
  try {
    const r = await fetch(`${MEILI}/indexes/qsearch_corpus/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MEILI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: '', filter: `url = "${url.replace(/"/g, '\\"')}"`, limit: 1 })
    })
    const j = await r.json()
    return (j.hits || []).length > 0
  } catch { return false }
}

/** Grades for one bench question, before the corpus filter. */
export function gradesFor (question, webJson, ctxJson) {
  const webUrls = new Set((webJson?.web?.results || []).map(r => r.url).filter(Boolean).map(normalizeUrlKey))
  const ctxUrls = new Set((ctxJson?.grounding?.generic || []).map(g => g.url).filter(Boolean).map(normalizeUrlKey))

  const grades = {}
  for (const u of ctxUrls) grades[u] = webUrls.has(u) ? 2 : 1
  // Cited sources win over the retrieval-derived grades — an explicit judgement outranks
  // an inferred one, whichever way the sets overlap.
  for (const s of (question.sources || [])) grades[normalizeUrlKey(s)] = 3
  return grades
}

async function main () {
  const dry = process.argv.includes('--dry-run')
  const questions = readFileSync(join(__dirname, '..', 'bench', 'ru', 'questions.jsonl'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))

  const out = []
  let skipped = 0
  console.log(`min graded URLs present in corpus: ${MIN_IN_CORPUS}\n`)
  console.log('  graded  in-corpus  query')

  for (const q of questions) {
    let webJson, ctxJson
    try {
      webJson = JSON.parse(readFileSync(q.pair_web, 'utf8'))
      ctxJson = JSON.parse(readFileSync(q.pair_web.replace(/\.json$/, '__context.json'), 'utf8'))
    } catch { skipped++; continue }

    const grades = gradesFor(q, webJson, ctxJson)
    // The ORIGINAL sweep query, not the hand-written bench question: that is the string the
    // corpus would really be searched with, and the one that produced these results.
    const query = webJson?.query?.original || q.question

    let present = 0
    const kept = {}
    for (const [u, g] of Object.entries(grades)) {
      if (await inCorpus(u)) { present++; kept[u] = g }
    }

    const mark = present >= MIN_IN_CORPUS ? '✓' : ' '
    console.log(`  ${String(Object.keys(grades).length).padStart(6)}  ${String(present).padStart(9)}  ${mark} ${query.slice(0, 56)}`)

    if (present >= MIN_IN_CORPUS) out.push({ query, relevance: kept, _bench_id: q.id })
    else skipped++
  }

  console.log(`\nqueries emitted: ${out.length}   skipped (too few graded URLs in corpus): ${skipped}`)
  if (out.length < 20) {
    console.warn(`⚠ ${out.length} queries is below the 20+ the benchmark asks for. Either the`)
    console.warn('  context backfill has not finished, or these sprints were never ingested.')
  }

  const doc = {
    _comment: 'Auto-derived from bench/ru/questions.jsonl by scripts/build_rerank_golden.mjs. ' +
      'grade 3 = cited in the reference answer; 2 = returned by both /web/search and /llm/context; ' +
      '1 = returned by /llm/context only; unlisted = 0. Only URLs actually present in the corpus ' +
      'are kept — grading a document the index lacks measures ingestion, not ranking.',
    generated: new Date().toISOString(),
    min_in_corpus: MIN_IN_CORPUS,
    queries: out
  }
  if (dry) { console.log('\n--dry-run: nothing written'); return }
  writeFileSync(OUT, JSON.stringify(doc, null, 2))
  console.log(`wrote ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
