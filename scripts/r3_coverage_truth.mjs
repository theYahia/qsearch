#!/usr/bin/env node
/**
 * r3_coverage_truth.mjs — are the "uncovered" queries in bench/corpus_coverage/queries.json
 * actually uncovered, or was that group picked wrong by eye?
 *
 * For each of the 25 queries (covered / plausible_uncovered / alien), fetches the top-10 corpus
 * hits directly from Meilisearch and asks the local judge a strict per-hit YES/NO: does this
 * document answer the query? A query is ANSWERED if >=2 of its 10 hits are YES.
 *
 * `covered` is the control: if the judge does not separate covered from plausible_uncovered,
 * the instrument is invalid, not the query set.
 *
 * Reads only, $0: raw Meilisearch search + local Ollama. Ollama calls are strictly sequential
 * (one GPU, no queueing on the Ollama side — concurrent calls error out).
 *
 * Usage: node scripts/r3_coverage_truth.mjs [--json bench/corpus_coverage/r3_coverage_truth.json]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d }

const MEILI_URL = process.env.MEILISEARCH_URL || 'http://127.0.0.1:7700'
const MEILI_KEY = process.env.MEILISEARCH_KEY || 'masterKey'
const INDEX = 'qsearch_corpus'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const JUDGE_MODEL = 'qwen2.5:14b-instruct'
const TEMPERATURE = 0.1
const HIT_LIMIT = 10
const ANSWERED_THRESHOLD = 2
const TEXT_CHARS = 1500

async function searchCorpus (query) {
  const r = await fetch(`${MEILI_URL}/indexes/${INDEX}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MEILI_KEY}` },
    body: JSON.stringify({ q: query, limit: HIT_LIMIT, attributesToRetrieve: ['url', 'title', 'text'] })
  })
  if (!r.ok) throw new Error(`meilisearch ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  const d = await r.json()
  return d.hits || []
}

const JUDGE_SYSTEM = 'You are a strict relevance judge. You are given a QUERY and a DOCUMENT (title + excerpt from a search corpus). ' +
  'Decide whether the document contains information that answers the query. ' +
  'Answer with exactly one word: YES or NO. No punctuation, no explanation, nothing else.'

function parseYesNo (raw) {
  const s = String(raw || '').trim().toUpperCase()
  const m = s.match(/\b(YES|NO)\b/)
  return m ? m[1] : 'UNPARSEABLE'
}

async function judgeHit (query, hit) {
  const title = String(hit.title || '')
  const text = String(hit.text || '').slice(0, TEXT_CHARS)
  const prompt = `QUERY: ${query}\n\nDOCUMENT TITLE: ${title}\n\nDOCUMENT TEXT:\n${text}\n\nDoes this document contain information that answers the query? Answer YES or NO only.`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60000)
  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: JUDGE_MODEL, system: JUDGE_SYSTEM, prompt, stream: false,
        options: { temperature: TEMPERATURE, num_ctx: 4096 }
      }),
      signal: ctrl.signal
    })
    if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
    const d = await r.json()
    const raw = String(d.response || '').trim()
    return { verdict: parseYesNo(raw), raw }
  } finally {
    clearTimeout(timer)
  }
}

async function main () {
  const setPath = join(__dirname, '..', 'bench', 'corpus_coverage', 'queries.json')
  const set = JSON.parse(readFileSync(setPath, 'utf8'))
  const groups = set.groups

  const out = {
    generated: new Date().toISOString(),
    judge_model: JUDGE_MODEL,
    temperature: TEMPERATURE,
    meilisearch: { url: MEILI_URL, index: INDEX },
    hit_limit: HIT_LIMIT,
    answered_threshold: ANSWERED_THRESHOLD,
    text_chars: TEXT_CHARS,
    groups: {}
  }

  let totalCalls = 0
  for (const [group, items] of Object.entries(groups)) {
    out.groups[group] = []
    console.log(`\n== group: ${group} (${items.length}) ==`)
    for (const item of items) {
      const query = item.q
      let hits
      try {
        hits = await searchCorpus(query)
      } catch (e) {
        console.log(`  [ERROR searching] ${query} :: ${e.message}`)
        out.groups[group].push({ q: query, error: e.message, hit_count: 0, yes_count: 0, no_count: 0, unparseable_count: 0, answered: false, hits: [] })
        continue
      }

      const hitRows = []
      let yes = 0; let no = 0; let unparseable = 0
      for (const h of hits) {
        const j = await judgeHit(query, h)
        totalCalls++
        if (j.verdict === 'YES') yes++
        else if (j.verdict === 'NO') no++
        else unparseable++
        hitRows.push({ url: h.url, title: h.title, verdict: j.verdict, raw: j.raw })
      }
      const answered = yes >= ANSWERED_THRESHOLD
      out.groups[group].push({
        q: query, hit_count: hits.length, yes_count: yes, no_count: no, unparseable_count: unparseable,
        answered, hits: hitRows
      })
      console.log(`  ${answered ? 'ANSWERED' : '.       '}  ${yes}/${hits.length} YES  ${query}`)
    }
  }

  const tally = {}
  for (const [group, items] of Object.entries(out.groups)) {
    tally[group] = {
      total: items.length,
      answered: items.filter(i => i.answered).length,
      not_answered: items.filter(i => !i.answered).length,
      errors: items.filter(i => i.error).length
    }
  }
  out.tally = tally
  out.total_judge_calls = totalCalls

  console.log('\n' + '='.repeat(60))
  console.log('TALLY (ANSWERED = >=2/10 hits judged YES)')
  for (const [group, t] of Object.entries(tally)) {
    console.log(`  ${group.padEnd(20)} ${t.answered}/${t.total} ANSWERED`)
  }
  console.log(`\ntotal judge calls: ${totalCalls}`)

  const outPath = arg('--json', join(__dirname, '..', 'bench', 'corpus_coverage', 'r3_coverage_truth.json'))
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${outPath}`)
}

main().catch(e => { console.error(e); process.exit(1) })
