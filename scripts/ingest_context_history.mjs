#!/usr/bin/env node
/**
 * ingest_context_history.mjs — fold the historical Brave LLM Context payloads into the corpus.
 *
 * Until 2026-08-04 `src/ingest/brave.js` skipped every `<label>__context.json` outright, so
 * the deepest text in the stack — 8601 paid context calls, ~$43, averaging 1077 chars per
 * passage against 261 for a web snippet — lived on disk and never reached the index that
 * ultra-broad, /pre_sweep_check and trust ranking read. Measured before this run: 359 092
 * corpus documents, exactly 0 of them carrying `backend_source = brave_context`.
 *
 * Safety, in order of how much they matter:
 *   · Resumable. Completed directories are recorded, so a full run can be stopped and
 *     restarted without re-indexing what already landed.
 *   · Idempotent anyway. corpus.index() merges by URL hash, so a repeated directory
 *     converges rather than duplicating — the state file saves time, not correctness.
 *   · Snapshotted. Corpus size is captured before and after; the run aborts if the document
 *     count grows past --max-growth (default 10%), because context URLs are supposed to be
 *     the SAME urls as the web results for that query — depth should grow, count shouldn't.
 *   · No rollback exists. Meilisearch does not version, hence the pilot-first workflow.
 *
 * Usage:
 *   node scripts/ingest_context_history.mjs --list
 *   node scripts/ingest_context_history.mjs --limit 20        # pilot
 *   node scripts/ingest_context_history.mjs                   # the rest, resumable
 *   node scripts/ingest_context_history.mjs --reset-state
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = arg('--root', 'D:/Yahia')
const QSEARCH = arg('--url', 'http://localhost:8080').replace(/\/$/, '')
const MEILI = arg('--meili', 'http://127.0.0.1:7700').replace(/\/$/, '')
const MEILI_KEY = process.env.MEILISEARCH_KEY || 'masterKey'
const STATE = join(process.cwd(), '_context_ingest_state.json')
const MAX_GROWTH = Number(arg('--max-growth', '10')) / 100

const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'data.ms'])

function arg (name, dflt) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const flag = n => process.argv.includes(n)

function * walk (dir, depth = 0) {
  if (depth > 20) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield * walk(join(dir, e.name), depth + 1) } else if (e.isFile() && e.name.endsWith('__context.json')) yield join(dir, e.name)
  }
}

/** Directories holding context payloads AND at least one web .json to hang them on. */
function ingestableDirs () {
  const dirs = new Set()
  for (const f of walk(ROOT)) dirs.add(dirname(f))
  const out = []
  for (const d of dirs) {
    let files
    try { files = readdirSync(d) } catch { continue }
    // ingestBraveDir enumerates web files and reads the __context sibling; a directory with
    // only context payloads has nothing to attach them to.
    const web = files.filter(f => f.endsWith('.json') && !f.includes('__') && !f.startsWith('_'))
    const ctx = files.filter(f => f.endsWith('__context.json'))
    if (web.length && ctx.length) out.push({ dir: d, web: web.length, ctx: ctx.length })
  }
  // Smallest first: a pilot should fail fast and cheap if something is wrong.
  return out.sort((a, b) => a.ctx - b.ctx)
}

async function corpusDocs () {
  try {
    const r = await fetch(`${MEILI}/indexes/qsearch_corpus/stats`, { headers: { Authorization: `Bearer ${MEILI_KEY}` } })
    const j = await r.json()
    return { docs: j.numberOfDocuments, indexing: j.isIndexing }
  } catch (e) { return { docs: null, error: e.message } }
}

async function contextDocCount () {
  try {
    const r = await fetch(`${MEILI}/indexes/qsearch_corpus/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MEILI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: '', filter: 'backend_source = "brave_context"', hitsPerPage: 1 })
    })
    const j = await r.json()
    return j.totalHits ?? j.estimatedTotalHits ?? null
  } catch { return null }
}

function loadState () {
  if (flag('--reset-state')) return { done: [] }
  try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return { done: [] } }
}
const saveState = s => writeFileSync(STATE, JSON.stringify(s, null, 1))

async function main () {
  const all = ingestableDirs()
  const state = loadState()
  const done = new Set(state.done || [])
  const pending = all.filter(d => !done.has(d.dir))

  console.log(`ingestable directories : ${all.length}  (done ${done.size}, pending ${pending.length})`)
  console.log(`context payloads       : ${all.reduce((s, d) => s + d.ctx, 0)}`)

  if (flag('--list')) {
    for (const d of pending.slice(0, 40)) console.log(`  web ${String(d.web).padStart(3)}  ctx ${String(d.ctx).padStart(3)}  ${d.dir}`)
    if (pending.length > 40) console.log(`  … ${pending.length - 40} more`)
    return
  }

  const limit = Number(arg('--limit', '0')) || pending.length
  // A pilot takes a SPREAD across the size distribution, not the head. `pending` is sorted
  // smallest-first, so slicing the first N would exercise only single-payload directories —
  // it would prove the mechanism works and prove nothing about volume or merge behaviour at
  // scale, which is the actual risk being piloted.
  const batch = limit >= pending.length
    ? pending
    : Array.from({ length: limit }, (_, i) => pending[Math.floor(i * pending.length / limit)])
  if (!batch.length) { console.log('\nnothing pending.'); return }
  if (limit < pending.length) {
    const c = batch.map(d => d.ctx)
    console.log(`pilot spread           : ${Math.min(...c)}–${Math.max(...c)} context payloads per directory, ${c.reduce((a, b) => a + b, 0)} total`)
  }

  const before = await corpusDocs()
  const ctxBefore = await contextDocCount()
  console.log(`\ncorpus before : ${before.docs} docs, ${ctxBefore} with backend_source=brave_context`)
  console.log(`ingesting     : ${batch.length} directories\n`)

  let indexed = 0
  let failed = 0
  for (const [i, d] of batch.entries()) {
    const topic = d.dir.replace(/\\/g, '/').split('/').slice(-2)[0] || 'ctx_backfill'
    try {
      const r = await fetch(`${QSEARCH}/ingest/brave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brave_dir: d.dir.replace(/\\/g, '/'), topic })
      })
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`)
      const j = await r.json()
      indexed += j.indexed || 0
      done.add(d.dir)
      state.done = [...done]
      saveState(state) // after every dir: a crash must not lose the whole run
      console.log(`  [${i + 1}/${batch.length}] +${String(j.indexed || 0).padStart(4)}  ${d.dir}`)
    } catch (e) {
      failed++
      console.error(`  [${i + 1}/${batch.length}] FAIL  ${d.dir}: ${e.message}`)
    }
  }

  // Meilisearch indexes asynchronously; wait for the queue to drain before comparing.
  process.stderr.write('\nwaiting for indexing to settle')
  for (let i = 0; i < 60; i++) {
    const s = await corpusDocs()
    if (!s.indexing) break
    process.stderr.write('.')
    await new Promise(r => setTimeout(r, 2000))
  }
  process.stderr.write('\n')

  const after = await corpusDocs()
  const ctxAfter = await contextDocCount()
  const growth = before.docs ? (after.docs - before.docs) / before.docs : 0

  console.log(`\ndirectories ok / failed : ${batch.length - failed} / ${failed}`)
  console.log(`documents indexed       : ${indexed}`)
  console.log(`corpus ${before.docs} → ${after.docs}  (${growth >= 0 ? '+' : ''}${(growth * 100).toFixed(2)}%)`)
  console.log(`backend_source=brave_context: ${ctxBefore} → ${ctxAfter}`)

  if (growth > MAX_GROWTH) {
    console.error(`\n⚠ document count grew ${(growth * 100).toFixed(1)}%, past the ${(MAX_GROWTH * 100).toFixed(0)}% guard.`)
    console.error('Context URLs should mostly be the SAME urls as the web results for that query,')
    console.error('so depth should grow and count should not. Investigate before continuing.')
    process.exit(2)
  }
  console.log(`\nresume with: node scripts/ingest_context_history.mjs   (${all.length - done.size} directories left)`)
}

main().catch(e => { console.error(e); process.exit(1) })
