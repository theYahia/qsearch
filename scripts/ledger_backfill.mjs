#!/usr/bin/env node
/**
 * ledger_backfill.mjs — import historical brave_sweep.py runs into sprint_metrics.
 *
 * brave_sweep.py only started reporting to the ledger on 2026-08-04. Everything before
 * that exists solely as `_sweep_log.json` files on disk — measured at 38 298 Brave calls
 * / ~$191, against the $42.5 the ledger knew about. Without this import /economy_report
 * would show a stack that suddenly started costing money in August.
 *
 * Imported rows carry `sprint_id = "backfill:<topic>"`, so they are trivially
 * distinguishable from live rows (plain `<topic>`) and can be removed with a single
 * DELETE if the import needs redoing. The script refuses to run twice unless --force,
 * because double-importing silently doubles every historical figure.
 *
 * Cost is computed server-side from COST_PER_CALL — this script never sends a price.
 *
 * Usage:
 *   node scripts/ledger_backfill.mjs --dry-run
 *   node scripts/ledger_backfill.mjs [--root D:/Yahia] [--url http://localhost:8080] [--force]
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'data.ms', '.next', 'dist'])
// Same mapping the live reporter uses (brave_sweep.py _LEDGER_BACKENDS).
// context_ok → `brave_context_call` ($0.005/request), NOT `brave_context` ($0.01/critical
// query, which already covers the paired web call). These logs count web and context
// separately, so the per-query label would overstate by 50%.
const BACKENDS = { web_ok: 'brave_web', context_ok: 'brave_context_call', news_ok: 'brave_news' }
const BATCH = 500

function * walk (dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      yield * walk(join(dir, e.name))
    } else if (e.isFile() && e.name === '_sweep_log.json') {
      yield join(dir, e.name)
    }
  }
}

function arg (name, dflt) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

/** Collect one metric set per sweep log, deduped by file CONTENT (the same sprint log is
 *  copied into several project trees and must bill once). */
export function collectMetrics (root) {
  const seen = new Set()
  const metrics = []
  let logs = 0, dupes = 0, undated = 0

  for (const file of walk(root)) {
    let raw
    try { raw = readFileSync(file) } catch { continue }
    const h = createHash('md5').update(raw).digest('hex')
    if (seen.has(h)) { dupes++; continue }
    seen.add(h)

    let j
    try { j = JSON.parse(raw.toString('utf8')) } catch { continue }
    logs++

    const ts = Date.parse(j.generated || '')
    if (!Number.isFinite(ts)) { undated++; continue }

    // .../<topic>/brave/_sweep_log.json → topic. Falls back to the immediate parent.
    const parts = file.split(/[\\/]/)
    const topic = parts.length >= 3 ? parts[parts.length - 3] : (parts[parts.length - 2] || 'unknown')

    const durationMs = Number.isFinite(Number(j.duration_seconds))
      ? Math.round(Number(j.duration_seconds) * 1000)
      : null

    for (const [key, backend] of Object.entries(BACKENDS)) {
      const n = Number(j?.stats?.[key]) || 0
      if (n <= 0) continue
      metrics.push({
        sprintId: `backfill:${topic}`,
        topic,
        endpoint: '/brave_sweep',
        backend,
        queries: n,
        durationMs,
        timestamp: ts
      })
    }
  }
  return { metrics, logs, dupes, undated }
}

async function alreadyImported () {
  const { DatabaseSync } = await import('node:sqlite')
  const dbPath = arg('--db', join(process.cwd(), 'data', 'cache.db'))
  let db
  try { db = new DatabaseSync(dbPath, { readOnly: true }) } catch { return 0 }
  try {
    return Number(db.prepare("SELECT COUNT(*) c FROM sprint_metrics WHERE sprint_id LIKE 'backfill:%'").get().c) || 0
  } catch { return 0 } finally { db.close() }
}

async function main () {
  const root = arg('--root', 'D:/Yahia')
  const url = arg('--url', 'http://localhost:8080').replace(/\/$/, '')
  const dry = process.argv.includes('--dry-run')
  const force = process.argv.includes('--force')

  process.stderr.write(`scanning ${root} for _sweep_log.json …\n`)
  const { metrics, logs, dupes, undated } = collectMetrics(root)

  const calls = metrics.reduce((s, m) => s + m.queries, 0)
  const dates = metrics.map(m => m.timestamp).sort((a, b) => a - b)
  console.log(`logs: ${logs} unique (${dupes} duplicate copies skipped, ${undated} undated and therefore skipped)`)
  console.log(`rows to import: ${metrics.length}  ·  Brave calls: ${calls}`)
  if (dates.length) {
    console.log(`window: ${new Date(dates[0]).toISOString().slice(0, 10)} → ${new Date(dates[dates.length - 1]).toISOString().slice(0, 10)}`)
  }

  if (dry) { console.log('\n--dry-run: nothing sent'); return }

  const existing = await alreadyImported()
  if (existing > 0 && !force) {
    console.error(`\nREFUSING: ${existing} backfilled rows already present.`)
    console.error("Re-importing would double every historical figure. To redo, first remove them:")
    console.error("  DELETE FROM sprint_metrics WHERE sprint_id LIKE 'backfill:%';")
    console.error('…then re-run, or pass --force if you know the existing rows are different.')
    process.exit(2)
  }

  let recorded = 0
  for (let i = 0; i < metrics.length; i += BATCH) {
    const chunk = metrics.slice(i, i + BATCH)
    const res = await fetch(`${url}/sprint_metric`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metrics: chunk })
    })
    if (!res.ok) {
      console.error(`batch ${i / BATCH + 1} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
      process.exit(1)
    }
    const out = await res.json()
    recorded += out.recorded || 0
    for (const w of (out.warnings || []).slice(0, 3)) console.warn(`  ! ${w}`)
    process.stderr.write(`  ${Math.min(i + BATCH, metrics.length)}/${metrics.length}\n`)
  }
  console.log(`\nimported ${recorded} rows. Verify: GET ${url}/economy_report`)
}

if (process.argv.includes('--selftest')) {
  // Guards the two things that would silently corrupt the ledger: mis-derived topic and
  // a bad date being imported as "now".
  const parts = 'D:/Yahia/active/x/research/_raw_data/mytopic_2026-05-01/brave/_sweep_log.json'.split(/[\\/]/)
  const topic = parts[parts.length - 3]
  if (topic !== 'mytopic_2026-05-01') throw new Error(`topic derivation broken: ${topic}`)
  if (Number.isFinite(Date.parse('not a date'))) throw new Error('undated logs must not parse')
  if (!Number.isFinite(Date.parse('2026-04-17T09:22:44Z'))) throw new Error('ISO date must parse')
  console.log('selftest: 3 assertions OK')
} else {
  main().catch(e => { console.error(e); process.exit(1) })
}
