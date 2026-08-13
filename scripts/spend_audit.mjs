#!/usr/bin/env node
/**
 * spend_audit.mjs — reconcile real Brave spend across BOTH execution paths and
 * measure the *cache-eligible* repeat rate.
 *
 * Why this exists
 * ---------------
 * The stack bills Brave from two independent places:
 *   1. Node  src/server.js  /sweep      → writes sprint_metrics rows to data/cache.db
 *   2. Python brave_sweep.py            → calls Brave directly, writes NOTHING to the ledger
 *
 * So `GET /economy_report` reports only path 1. This script sums both and shows the gap.
 * Python's per-sprint receipt is `_sweep_log.json` (`stats.web_ok/context_ok/news_ok`);
 * Node writes `_sweep_summary.json` instead, so the two never double-count.
 *
 * It also answers the question the memcache ship-gate has been waiting on since May
 * (MEMCACHE_PHASE_1_LOG.md: ship >=20% / park 10-20% / kill <10%): what share of query
 * executions could a cache actually have served? A raw duplicate count overstates it —
 * the real key includes `engines`, and entries expire. Both filters are applied here.
 *
 * Read-only. Never prints an API key.
 *
 * Usage:
 *   node scripts/spend_audit.mjs [--root D:/Yahia] [--db <path>] [--json out.json]
 *   node scripts/spend_audit.mjs --selftest
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createHash } from 'node:crypto'

// Brave Search plan: $5 per 1000 requests (2026 pricing). Every request bills the same,
// so a `critical` line costs 2x — it is two requests (web + llm/context), not one dearer one.
const PRICE_PER_REQUEST = Number(process.env.BRAVE_PRICE_PER_REQUEST) || 0.005

// Mirrors src/cache.js DEFAULT_TTL — days an entry stays servable.
const TTL_DAYS = { web: 7, news: 1, context: 30, scholarly: 30 }

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'data.ms', '.next', 'dist'])
const QUERY_FILE_RE = /quer(y|ies).*\.txt$/i

// ── mirrors of shipped logic (keep in sync) ─────────────────────────────────

/** Mirror of QueryCache.hashKey normalization — src/cache.js:178. */
function normalizeKey (q) {
  return String(q || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/** Mirror of cacheEnginesFor — src/server.js:1178-1186.
 *  yandex is intentionally absent: the backend has never executed (0 rows in
 *  sprint_metrics, 0 in query_cache.engines), so `ru` resolves to searxng_ru. */
function enginesFor (priority, domain) {
  if (domain === 'scholarly') return ['academic']
  if (domain === 'ru') return ['searxng_ru']
  if (priority === 'broad') return ['searxng']
  if (priority === 'critical') return ['brave_critical']
  if (priority === 'focused') return ['brave_focused']
  return ['searxng']
}

/** Mirror of inferEndpoint — src/cache.js:34-42 (substring match, else web). */
function inferEndpoint (engines) {
  const j = engines.join(',')
  if (j.includes('context')) return 'context'
  if (j.includes('news')) return 'news'
  if (j.includes('academic')) return 'scholarly'
  return 'web'
}

function isBillable (engines) {
  return engines.some(e => e.startsWith('brave'))
}

const PRIORITIES = new Set(['broad', 'focused', 'critical', 'ultra-broad', 'ultra_broad'])
const DOMAINS = new Set(['ru', 'general', 'scholarly', 'en'])

/**
 * queries.txt lines come in four shapes. Getting this wrong is the difference between
 * a 15.1% and a 14.6% repeat rate — a naive `split('|')[1]` counts the literal strings
 * "broad" and "focused" as the most-repeated queries in the corpus.
 *   label|query|priority|domain   (4)
 *   label|query|priority          (3)
 *   query|priority                (2)
 *   query                         (1)
 */
export function parseQueryLine (raw) {
  const t = String(raw).trim()
  if (!t || t.startsWith('#')) return null
  if (!t.includes('|')) return { query: t, priority: 'broad', domain: null }

  const p = t.split('|').map(s => s.trim())
  if (p.length === 2) {
    const tail = p[1].toLowerCase()
    // "query|priority" — the 2nd field is a keyword, not a query.
    if (PRIORITIES.has(tail)) return { query: p[0], priority: tail, domain: null }
    if (DOMAINS.has(tail)) return { query: p[0], priority: 'broad', domain: tail }
    return { query: p[1], priority: 'broad', domain: null } // "label|query"
  }
  const priority = PRIORITIES.has((p[2] || '').toLowerCase()) ? p[2].toLowerCase() : 'broad'
  const domain = DOMAINS.has((p[3] || '').toLowerCase()) ? p[3].toLowerCase() : null
  return { query: p[1], priority, domain }
}

// ── filesystem walk ─────────────────────────────────────────────────────────

function * walk (dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      yield * walk(join(dir, e.name))
    } else if (e.isFile()) {
      yield join(dir, e.name)
    }
  }
}

function monthOf (iso) {
  const s = String(iso || '')
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : 'unknown'
}

// ── path 1: Python (_sweep_log.json) ────────────────────────────────────────

function collectPython (files) {
  const seen = new Set()
  const byMonth = new Map()
  let logs = 0, dupes = 0, web = 0, ctx = 0, news = 0, queries = 0
  let first = null, last = null

  for (const f of files) {
    if (!f.endsWith('_sweep_log.json')) continue
    let raw
    try { raw = readFileSync(f) } catch { continue }
    // Same sprint log copied into several project trees must bill once.
    const h = createHash('md5').update(raw).digest('hex')
    if (seen.has(h)) { dupes++; continue }
    seen.add(h)

    let j
    try { j = JSON.parse(raw.toString('utf8')) } catch { continue }
    const s = j.stats || {}
    const w = Number(s.web_ok) || 0
    const c = Number(s.context_ok) || 0
    const n = Number(s.news_ok) || 0
    logs++; web += w; ctx += c; news += n; queries += Number(j.total_queries) || 0

    const m = monthOf(j.generated)
    const acc = byMonth.get(m) || { requests: 0, usd: 0 }
    acc.requests += w + c + n
    acc.usd += (w + c + n) * PRICE_PER_REQUEST
    byMonth.set(m, acc)

    if (j.generated) {
      if (!first || j.generated < first) first = j.generated
      if (!last || j.generated > last) last = j.generated
    }
  }

  const requests = web + ctx + news
  return { logs, dupes, queries, web, ctx, news, requests, usd: requests * PRICE_PER_REQUEST, byMonth, first, last }
}

// ── path 2: Node (sprint_metrics in cache.db) ───────────────────────────────

async function collectNode (dbPath) {
  let DatabaseSync
  try { ({ DatabaseSync } = await import('node:sqlite')) } catch {
    return { error: 'node:sqlite unavailable (needs Node >=22.5)' }
  }
  let db
  try { db = new DatabaseSync(dbPath, { readOnly: true }) } catch (e) {
    return { error: `cannot open ${dbPath}: ${e.message}` }
  }
  try {
    const rows = db.prepare(
      `SELECT backend, COUNT(*) rows_n, SUM(queries) queries, SUM(cost_usd) ledger_usd,
              SUM(cache_hits) hits, MIN(timestamp) t0, MAX(timestamp) t1
         FROM sprint_metrics GROUP BY backend`
    ).all()
    const byMonth = db.prepare(
      `SELECT strftime('%Y-%m', timestamp/1000, 'unixepoch') m,
              SUM(queries) queries, SUM(cost_usd) ledger_usd
         FROM sprint_metrics GROUP BY m ORDER BY m`
    ).all()
    let braveRequests = 0, ledgerUsd = 0, t0 = null, t1 = null
    for (const r of rows) {
      ledgerUsd += Number(r.ledger_usd) || 0
      if (String(r.backend).startsWith('brave')) braveRequests += Number(r.queries) || 0
      if (r.t0 && (!t0 || r.t0 < t0)) t0 = r.t0
      if (r.t1 && (!t1 || r.t1 > t1)) t1 = r.t1
    }
    return {
      rows, byMonth, braveRequests, ledgerUsd,
      usd: braveRequests * PRICE_PER_REQUEST,
      first: t0 ? new Date(t0).toISOString() : null,
      last: t1 ? new Date(t1).toISOString() : null
    }
  } finally { db.close() }
}

// ── repeat analysis ─────────────────────────────────────────────────────────

function collectRepeats (files) {
  // key = normalized query + '|' + sorted engines  (exactly the real cache key input)
  const occurrences = new Map()
  let lines = 0, filesRead = 0

  for (const f of files) {
    if (extname(f).toLowerCase() !== '.txt' || !QUERY_FILE_RE.test(f)) continue
    let text, mtime
    try { text = readFileSync(f, 'utf8'); mtime = statSync(f).mtimeMs } catch { continue }
    filesRead++
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseQueryLine(line)
      if (!parsed) continue
      const q = normalizeKey(parsed.query)
      if (!q || PRIORITIES.has(q)) continue
      lines++
      const engines = enginesFor(parsed.priority, parsed.domain)
      const key = q + '|' + [...engines].sort().join(',')
      let arr = occurrences.get(key)
      if (!arr) { arr = { engines, times: [] }; occurrences.set(key, arr) }
      arr.times.push(mtime)
    }
  }

  // Naive: any execution beyond the first of an identical key.
  // Eligible: also within that endpoint's TTL of the previous execution — the only
  // repeats a real cache could have served.
  let distinct = 0, redundant = 0, eligible = 0
  let billableLines = 0, billableRedundant = 0, billableEligible = 0
  for (const { engines, times } of occurrences.values()) {
    distinct++
    redundant += times.length - 1
    const ttlMs = TTL_DAYS[inferEndpoint(engines)] * 86400000
    times.sort((a, b) => a - b)
    let hits = 0
    for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] <= ttlMs) hits++
    eligible += hits
    if (isBillable(engines)) {
      billableLines += times.length
      billableRedundant += times.length - 1
      billableEligible += hits
    }
  }

  const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : 0)
  return {
    filesRead, lines, distinct, redundant, eligible,
    repeatRatePct: pct(redundant, lines),
    eligibleRatePct: pct(eligible, lines),
    billable: {
      lines: billableLines,
      redundant: billableRedundant,
      eligible: billableEligible,
      repeatRatePct: pct(billableRedundant, billableLines),
      eligibleRatePct: pct(billableEligible, billableLines),
      savedUsd: +(billableEligible * PRICE_PER_REQUEST).toFixed(2)
    }
  }
}

function gateVerdict (pct) {
  if (pct >= 20) return 'SHIP  (>=20%)'
  if (pct >= 10) return 'PARK  (10-20%)'
  return 'KILL  (<10%)'
}

// ── selftest ────────────────────────────────────────────────────────────────

function selftest () {
  const eq = (got, want, msg) => {
    const g = JSON.stringify(got); const w = JSON.stringify(want)
    if (g !== w) throw new Error(`${msg}\n  got  ${g}\n  want ${w}`)
  }
  // The bug this guards: 2-field lines must not yield "broad" as the query.
  eq(parseQueryLine('какую коляску выбрать|focused'), { query: 'какую коляску выбрать', priority: 'focused', domain: null }, '2-field query|priority')
  eq(parseQueryLine('tipy|коляска 2в1|focused|ru'), { query: 'коляска 2в1', priority: 'focused', domain: 'ru' }, '4-field')
  eq(parseQueryLine('tipy|коляска 2в1|critical'), { query: 'коляска 2в1', priority: 'critical', domain: null }, '3-field')
  eq(parseQueryLine('просто запрос'), { query: 'просто запрос', priority: 'broad', domain: null }, 'bare')
  eq(parseQueryLine('# comment'), null, 'comment')
  eq(parseQueryLine('   '), null, 'blank')
  eq(normalizeKey('  Коляска   2В1 '), 'коляска 2в1', 'normalizeKey matches cache.js')
  eq(enginesFor('broad', 'ru'), ['searxng_ru'], 'domain beats priority')
  eq(enginesFor('critical', null), ['brave_critical'], 'critical tier')
  eq(inferEndpoint(['brave_critical']), 'web', 'critical infers web TTL')
  eq(isBillable(['searxng']), false, 'searxng is free')
  eq(isBillable(['brave_focused']), true, 'brave is billable')
  console.log('selftest: 12 assertions OK')
}

// ── main ────────────────────────────────────────────────────────────────────

function arg (name, dflt) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

async function main () {
  if (process.argv.includes('--selftest')) return selftest()

  const root = arg('--root', 'D:/Yahia')
  const dbPath = arg('--db', join(process.cwd(), 'data', 'cache.db'))
  const jsonOut = arg('--json', null)

  process.stderr.write(`scanning ${root} …\n`)
  const files = [...walk(root)]
  process.stderr.write(`${files.length} files seen\n`)

  const py = collectPython(files)
  const node = await collectNode(dbPath)
  const rep = collectRepeats(files)

  const totalRequests = py.requests + (node.braveRequests || 0)
  const totalUsd = py.usd + (node.usd || 0)
  const visiblePct = totalUsd ? (100 * (node.ledgerUsd || 0) / totalUsd).toFixed(1) : '0'

  const L = []
  L.push('')
  L.push('BRAVE SPEND — BOTH PATHS'.padEnd(64, ' '))
  L.push('='.repeat(64))
  L.push(`Python  brave_sweep.py   ${String(py.requests).padStart(7)} req   $${py.usd.toFixed(2).padStart(8)}   (${py.logs} logs, ${py.dupes} dup copies skipped)`)
  L.push(`          web ${py.web} · context ${py.ctx} · news ${py.news}`)
  if (node.error) {
    L.push(`Node    sprint_metrics   ERROR: ${node.error}`)
  } else {
    L.push(`Node    sprint_metrics   ${String(node.braveRequests).padStart(7)} req   $${node.usd.toFixed(2).padStart(8)}   (ledger reports $${node.ledgerUsd.toFixed(2)})`)
  }
  L.push('-'.repeat(64))
  L.push(`TOTAL                    ${String(totalRequests).padStart(7)} req   $${totalUsd.toFixed(2).padStart(8)}`)
  L.push(`Ledger visibility        ${visiblePct}% of real spend`)
  L.push(`Window                   ${py.first || '?'} → ${py.last || '?'}`)
  L.push('')
  L.push('Python spend by month')
  for (const m of [...py.byMonth.keys()].sort()) {
    const a = py.byMonth.get(m)
    L.push(`  ${m}   ${String(a.requests).padStart(6)} req   $${a.usd.toFixed(2).padStart(8)}`)
  }
  L.push('')
  L.push('REPEAT RATE — could a cache have served it?'.padEnd(64, ' '))
  L.push('='.repeat(64))
  L.push(`query files              ${rep.filesRead}`)
  L.push(`query executions         ${rep.lines}`)
  L.push(`distinct (query+engines) ${rep.distinct}`)
  L.push(`redundant, ignoring TTL  ${rep.redundant}  → ${rep.repeatRatePct}%`)
  L.push(`redundant, within TTL    ${rep.eligible}  → ${rep.eligibleRatePct}%   <-- the honest number`)
  L.push('')
  L.push('Billable subset only (brave_* tiers — the money that is actually at stake)')
  L.push(`  executions             ${rep.billable.lines}`)
  L.push(`  within TTL             ${rep.billable.eligible}  → ${rep.billable.eligibleRatePct}%`)
  L.push(`  recoverable            $${rep.billable.savedUsd}`)
  L.push('')
  L.push(`MEMCACHE SHIP-GATE       ${gateVerdict(rep.billable.eligibleRatePct)}`)
  L.push('  (MEMCACHE_PHASE_1_LOG.md: ship >=20% / park 10-20% / kill <10%)')
  L.push('')
  console.log(L.join('\n'))

  if (jsonOut) {
    const payload = {
      generated: new Date().toISOString(),
      price_per_request: PRICE_PER_REQUEST,
      python: { ...py, byMonth: Object.fromEntries(py.byMonth) },
      node,
      repeats: rep,
      total: { requests: totalRequests, usd: +totalUsd.toFixed(2), ledger_visibility_pct: +visiblePct }
    }
    writeFileSync(jsonOut, JSON.stringify(payload, null, 2))
    process.stderr.write(`wrote ${jsonOut}\n`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
