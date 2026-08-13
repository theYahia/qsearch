#!/usr/bin/env node
/**
 * bench_pairs.mjs — locate the saved (web, llm/context) response pair for a query and
 * dump what each endpoint actually returned.
 *
 * Two uses:
 *   1. Authoring bench/ru/questions.jsonl — read the real passages, write a reference
 *      answer that is traceable to a real source rather than invented.
 *   2. Feeding the judge — `--emit-claims` prints the (claim, url) records the shipped
 *      verifier consumes, per endpoint, so extraction quality can be scored per side.
 *
 * Read-only.
 *
 * Usage:
 *   node scripts/bench_pairs.mjs --index                  # build/refresh the query index
 *   node scripts/bench_pairs.mjs --find "самозанятый лимит"
 *   node scripts/bench_pairs.mjs --show <path-to-web.json> [--max 6]
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'data.ms', '.next', 'dist'])
const INDEX_PATH = join(process.cwd(), '_bench_pairs_index.json')

function * walk (dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      yield * walk(join(dir, e.name))
    } else if (e.isFile() && e.name.endsWith('__context.json')) {
      yield join(dir, e.name)
    }
  }
}

function buildIndex (root) {
  const out = []
  for (const ctxPath of walk(root)) {
    const webPath = ctxPath.replace(/__context\.json$/, '.json')
    if (!existsSync(webPath)) continue
    let j
    try { j = JSON.parse(readFileSync(webPath, 'utf8')) } catch { continue }
    const q = j?.query?.original
    if (!q) continue
    out.push({ query: q, country: j?.query?.country || null, web: webPath, ctx: ctxPath })
  }
  writeFileSync(INDEX_PATH, JSON.stringify(out, null, 1))
  process.stderr.write(`indexed ${out.length} pairs → ${INDEX_PATH}\n`)
  return out
}

function loadIndex (root) {
  if (existsSync(INDEX_PATH)) {
    try { return JSON.parse(readFileSync(INDEX_PATH, 'utf8')) } catch { /* rebuild */ }
  }
  return buildIndex(root)
}

/** Passages the agent gets from /web/search: description + extra_snippets, per result. */
export function webClaims (j, max = Infinity) {
  const out = []
  for (const r of (j?.web?.results || [])) {
    if (!r?.url) continue
    const parts = []
    if (r.description) parts.push(String(r.description))
    for (const s of (r.extra_snippets || [])) if (s) parts.push(String(s))
    if (parts.length) out.push({ url: r.url, title: r.title || '', text: parts.join(' … ') })
    if (out.length >= max) break
  }
  return out
}

/** Passages the agent gets from /llm/context: grounded snippets, per source. */
export function ctxClaims (j, max = Infinity) {
  const out = []
  for (const g of (j?.grounding?.generic || [])) {
    if (!g?.url) continue
    const text = (g.snippets || []).filter(Boolean).map(String).join(' … ')
    if (text) out.push({ url: g.url, title: g.title || '', text })
    if (out.length >= max) break
  }
  return out
}

function arg (name, dflt) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

function truncate (s, n) { return s.length > n ? s.slice(0, n) + '…' : s }

function main () {
  const root = arg('--root', 'D:/Yahia')

  if (process.argv.includes('--index')) { buildIndex(root); return }

  const find = arg('--find', null)
  if (find) {
    const idx = loadIndex(root)
    const needle = find.toLowerCase()
    const hits = idx.filter(r => r.query.toLowerCase().includes(needle))
    console.log(`${hits.length} match(es) for ${JSON.stringify(find)}`)
    for (const h of hits.slice(0, 20)) {
      console.log(`\n  [${h.country}] ${h.query}`)
      console.log(`    web: ${h.web}`)
    }
    return
  }

  const show = arg('--show', null)
  if (show) {
    const max = Number(arg('--max', '6'))
    const webPath = show.endsWith('__context.json') ? show.replace(/__context\.json$/, '.json') : show
    const ctxPath = webPath.replace(/\.json$/, '__context.json')
    const jw = JSON.parse(readFileSync(webPath, 'utf8'))
    const jc = JSON.parse(readFileSync(ctxPath, 'utf8'))

    if (process.argv.includes('--emit-claims')) {
      console.log(JSON.stringify({
        query: jw?.query?.original, country: jw?.query?.country,
        web: webClaims(jw), context: ctxClaims(jc)
      }, null, 2))
      return
    }

    console.log(`QUERY   : ${jw?.query?.original}`)
    console.log(`COUNTRY : ${jw?.query?.country}`)
    console.log(`\n── /web/search — ${(jw?.web?.results || []).length} sources ──`)
    for (const c of webClaims(jw, max)) {
      console.log(`\n  ${c.url}`)
      console.log(`  ${truncate(c.text, 400)}`)
    }
    console.log(`\n── /llm/context — ${(jc?.grounding?.generic || []).length} sources ──`)
    for (const c of ctxClaims(jc, max)) {
      console.log(`\n  ${c.url}`)
      console.log(`  ${truncate(c.text, 900)}`)
    }
    return
  }

  console.log('usage: --index | --find <text> | --show <web.json> [--max N] [--emit-claims]')
}

main()
