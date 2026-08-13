#!/usr/bin/env node
/**
 * install_sweep_shim.mjs — stop brave_sweep.py from drifting into N incompatible copies.
 *
 * The problem, measured 2026-08-04: 140 copies under D:/Yahia in 16 distinct versions.
 * Only the canonical file carries current code; 34 stale copies sit inside active/ where
 * real sprints run, up to 874 lines behind. `research/` is gitignored, so nothing keeps
 * them in sync. A fix to the canonical script (per-query RU locale, ledger reporting)
 * reaches none of them.
 *
 * The shim replaces a copy with a few lines that execute the canonical file instead.
 * Nothing else changes:
 *   · CLI is identical — argv passes straight through
 *   · .env.local still resolves per project: load_env_key() walks up from the OUTPUT dir
 *     (brave_sweep.py:2145 `load_env_key(out_dir)`), never from the script's location
 *   · sub-engine recursion improves — _run_sub_engine_subprocess resolves __file__, which
 *     runpy sets to the canonical path, so nested sweeps stop running stale code too
 *
 * Every replaced file is preserved next to itself as brave_sweep.py.bak-<md5-8>.
 * Nothing is deleted, ever.
 *
 * Usage:
 *   node scripts/install_sweep_shim.mjs                    # census + what WOULD change
 *   node scripts/install_sweep_shim.mjs --verify           # prove the shim works, touch nothing
 *   node scripts/install_sweep_shim.mjs --install <path>   # one file
 *   node scripts/install_sweep_shim.mjs --install-active   # all stale copies under active/
 *   node scripts/install_sweep_shim.mjs --revert <path>    # restore from its .bak
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const CANONICAL = 'D:/Yahia/active/qsearch/research/scripts/brave_sweep.py'
const ROOT = 'D:/Yahia'
const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'data.ms'])

const SHIM = (canonical) => `#!/usr/bin/env python3
"""Thin shim → canonical brave_sweep.py.

This project used to carry its own copy of a 2500-line script. 140 copies existed across
D:/Yahia in 16 versions, most of them stale, so fixes never propagated. This forwards to
the single canonical file instead.

Nothing about the interface changes: same CLI, same flags, same outputs. .env.local is
still resolved per project, because load_env_key() walks up from the OUTPUT directory
rather than from this file.

The previous copy is preserved beside this one as brave_sweep.py.bak-<hash>.
Canonical: ${canonical}
"""
import runpy
import sys
from pathlib import Path

CANONICAL = Path(r"${canonical}")

if not CANONICAL.exists():
    raise SystemExit(
        f"ERROR: canonical brave_sweep.py not found at {CANONICAL}\\n"
        "Restore it, or replace this shim with the .bak file sitting next to it."
    )

# run_name="__main__" so the canonical script's entry point fires; runpy also sets its
# __file__ to the canonical path, which is what sub-engine recursion resolves.
runpy.run_path(str(CANONICAL), run_name="__main__")
`

function * walk (dir, depth = 0) {
  if (depth > 8) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield * walk(join(dir, e.name), depth + 1) }
    else if (e.isFile() && e.name === 'brave_sweep.py') yield join(dir, e.name)
  }
}

const md5 = buf => createHash('md5').update(buf).digest('hex')
const isShim = txt => txt.includes('Thin shim → canonical brave_sweep.py')

function census () {
  const canonHash = md5(readFileSync(CANONICAL))
  const rows = []
  for (const f of walk(ROOT)) {
    const buf = readFileSync(f)
    const txt = buf.toString('utf8')
    rows.push({
      file: f,
      hash: md5(buf),
      lines: txt.split('\n').length,
      shim: isShim(txt),
      canonical: f.replace(/\\/g, '/') === CANONICAL,
      active: f.replace(/\\/g, '/').includes('/Yahia/active/')
    })
  }
  return { rows, canonHash, canonLines: readFileSync(CANONICAL, 'utf8').split('\n').length }
}

/**
 * Is this copy a historical sprint snapshot rather than a live entry point?
 *
 * `MamaSupport/research/saddle-uterus-2026-04-28/research/scripts/brave_sweep.py` records
 * which code produced that sprint's data. Rewriting it to forward at today's canonical
 * would quietly break that provenance, and nothing new is ever swept from it.
 *
 * The marker is a FULL date (YYYY-MM-DD) in a path segment BELOW the project directory.
 * The project segment itself is skipped on purpose — `job-pipeline-2026-06` is a project
 * name carrying a month, not a dated sprint, and it is a live entry point.
 */
function isSprintSnapshot (file) {
  const p = file.replace(/\\/g, '/')
  const i = p.indexOf('/active/')
  if (i === -1) return false
  const segments = p.slice(i + '/active/'.length).split('/')
  return segments.slice(1, -1).some(s => /\d{4}-\d{2}-\d{2}/.test(s))
}

/** Copies worth converting: inside active/, not the canonical, not already a shim, stale. */
function staleActive (rows, canonHash, { includeSnapshots = false } = {}) {
  return rows.filter(r =>
    r.active && !r.canonical && !r.shim && r.hash !== canonHash &&
    (includeSnapshots || !isSprintSnapshot(r.file)))
}

function install (file, canonLines) {
  const buf = readFileSync(file)
  const txt = buf.toString('utf8')
  if (isShim(txt)) return { file, skipped: 'already a shim' }
  if (file.replace(/\\/g, '/') === CANONICAL) return { file, skipped: 'is the canonical file' }

  const bak = `${file}.bak-${md5(buf).slice(0, 8)}`
  if (!existsSync(bak)) writeFileSync(bak, buf) // never clobber an existing backup
  writeFileSync(file, SHIM(CANONICAL))
  return { file, bak, wasLines: txt.split('\n').length, nowLines: canonLines }
}

function verifyShim (file) {
  // The canonical script's own offline selftest, invoked THROUGH the shim. If forwarding
  // is broken this fails loudly instead of at the next real sweep.
  const out = execFileSync('python', [file, '--selftest'], { encoding: 'utf8', timeout: 120000 })
  if (!/selftest: \d+ assertions OK/.test(out)) throw new Error(`unexpected selftest output: ${out.trim()}`)
  return out.trim()
}

const argv = process.argv.slice(2)
const flag = n => argv.includes(n)
const val = n => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null }

const { rows, canonHash, canonLines } = census()
// --include-snapshots also rewrites dated per-sprint copies; off by default so their
// provenance survives.
const stale = staleActive(rows, canonHash, { includeSnapshots: flag('--include-snapshots') })
const snapshots = staleActive(rows, canonHash, { includeSnapshots: true })
  .filter(r => isSprintSnapshot(r.file))

if (flag('--revert')) {
  const file = val('--revert')
  const baks = readdirSync(dirname(file)).filter(f => f.startsWith('brave_sweep.py.bak-'))
  if (!baks.length) { console.error(`no backup beside ${file}`); process.exit(1) }
  const newest = baks.map(b => join(dirname(file), b)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  writeFileSync(file, readFileSync(newest))
  console.log(`reverted ${file} ← ${newest}`)
  process.exit(0)
}

if (flag('--verify')) {
  console.log('verifying the canonical script answers its own selftest …')
  console.log('  ' + verifyShim(CANONICAL))
  console.log('\nshim mechanism is only installed by --install / --install-active.')
  process.exit(0)
}

const one = val('--install')
if (one) {
  const r = install(one, canonLines)
  console.log(r.skipped ? `skipped ${r.file}: ${r.skipped}` : `installed shim: ${r.file} (${r.wasLines} → shim), backup ${r.bak}`)
  if (!r.skipped) console.log('  ' + verifyShim(one))
  process.exit(0)
}

if (flag('--install-active')) {
  console.log(`installing shims into ${stale.length} stale copies under active/ …\n`)
  let done = 0
  for (const r of stale) {
    try {
      const res = install(r.file, canonLines)
      if (res.skipped) { console.log(`  skip ${r.file}: ${res.skipped}`); continue }
      verifyShim(r.file)
      console.log(`  ok   ${r.file}  (${res.wasLines} lines → shim, backup kept)`)
      done++
    } catch (e) {
      console.error(`  FAIL ${r.file}: ${e.message}`)
    }
  }
  console.log(`\n${done}/${stale.length} converted. Revert any one with --revert <path>.`)
  process.exit(0)
}

// Default: report only.
const byHash = new Map()
for (const r of rows) byHash.set(r.hash, (byHash.get(r.hash) || 0) + 1)
console.log(`brave_sweep.py copies : ${rows.length}`)
console.log(`distinct versions     : ${byHash.size}`)
console.log(`already shims         : ${rows.filter(r => r.shim).length}`)
console.log(`matching canonical    : ${rows.filter(r => r.hash === canonHash).length}`)
console.log(`\nlive entry points --install-active would convert: ${stale.length}`)
for (const r of stale) console.log(`  ${String(r.lines).padStart(5)} lines  ${r.file}`)
console.log(`\nhistorical sprint snapshots left alone (${snapshots.length}) — they record which`)
console.log('code produced that sprint\'s data. Add --include-snapshots to convert them too.')
for (const r of snapshots) console.log(`  ${String(r.lines).padStart(5)} lines  ${r.file}`)
console.log('\nNothing was modified. Use --verify, then --install <path>, then --install-active.')
