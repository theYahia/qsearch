// .env.local loader — MUST be the first import of any entry point.
//
// Why a module instead of a few lines in server.js: ES modules hoist every `import`
// statement and evaluate the whole graph BEFORE the importing file's own statements run.
// server.js used to parse .env.local at line 10, below a comment reading
// "Imports (after env loading)" — an intent the language does not honour. Every module that
// reads process.env at module scope had therefore already been evaluated with the ambient
// environment only.
//
// Measured 2026-08-04: QSEARCH_TRUST_FORMULA=v2 in .env.local left the server on v1
// (corpus top scored 476.64 = v1), while the same value in the process environment produced
// 42.65 = v2. Same for every other module-scope knob — QSEARCH_RERANK_ENABLED,
// QSEARCH_QUALITY_GATE_ENABLED, SWEEP_CONCURRENCY, QSEARCH_SWEEP_* — i.e. most of what
// .env.example documents could not be switched on from the file .env.example points at.
//
// Importing this module first fixes the ordering: ESM evaluates imports depth-first in
// source order, and this file imports nothing but node builtins, so it finishes before the
// heavier modules below it are evaluated.
//
// Precedence is unchanged from the original loader: .env.local WINS over the ambient
// environment (assignment is unconditional). That is deliberate — a stale exported var
// should not quietly outrank the file the operator edits.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = join(here, '..', '.env.local')

export const loadedFrom = existsSync(envPath) ? envPath : null
export const loaded = []

if (loadedFrom) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    loaded.push(m[1]) // names only — values are never collected or logged
  }
}
