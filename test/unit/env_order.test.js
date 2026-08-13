// .env.local must be applied BEFORE the module graph is evaluated.
//
// ES modules hoist every `import` and evaluate the whole graph before the importing file's
// own statements. server.js used to parse .env.local at line 10, under a comment reading
// "Imports (after env loading)" — which the language does not honour. Consequence, measured
// 2026-08-04: QSEARCH_TRUST_FORMULA=v2 in .env.local left the server on v1 (corpus top
// 476.64 = v1), while the same value in the process environment gave 42.65 = v2. The same
// applied to QSEARCH_RERANK_ENABLED, QSEARCH_QUALITY_GATE_ENABLED, SWEEP_CONCURRENCY and
// every other module-scope knob — most of what .env.example documents was unreachable from
// the file .env.example tells you to edit.
//
// This is a structural test on purpose: the defect is an ordering property of the source,
// invisible to any single-module unit test, and it reappears the moment someone tidies the
// imports.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENTRY_POINTS = ['src/server.js', 'src/mcp-http.js']

/** Import specifiers in source order. */
function importsOf (src) {
  return [...src.matchAll(/^\s*import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)].map(m => m[1])
}

describe('.env.local is applied before the module graph evaluates', () => {
  for (const entry of ENTRY_POINTS) {
    test(`${entry} imports ./env.js first`, () => {
      const src = readFileSync(join(root, entry), 'utf8')
      const imports = importsOf(src)
      assert.ok(imports.length > 0, `no imports found in ${entry}`)
      assert.equal(imports[0], './env.js',
        `${entry} must import './env.js' first, got '${imports[0]}'. Any import evaluated ` +
        'before it reads process.env without .env.local applied.')
    })

    test(`${entry} does not assign process.env itself`, () => {
      const src = readFileSync(join(root, entry), 'utf8')
      // The signature of an inline loader is writing INTO process.env — that is what runs
      // too late. Matching on the string ".env.local" would instead flag the error message
      // telling the operator which file to edit, which is not a defect.
      const assignment = /process\.env\s*\[/.exec(src)
      assert.equal(assignment, null,
        `${entry} writes into process.env at ${assignment?.index}; that runs after the import ` +
        'graph is already evaluated. Move it into ./env.js.')
    })
  }

  test('env.js pulls in nothing but node builtins', () => {
    // A heavy dependency here would be evaluated first and could itself read process.env
    // before the file has been applied, reintroducing the ordering bug one level down.
    const src = readFileSync(join(root, 'src/env.js'), 'utf8')
    for (const spec of importsOf(src)) {
      assert.ok(spec.startsWith('node:'), `env.js must only import node builtins, found '${spec}'`)
    }
  })

  test('env.js collects variable NAMES only, never values', () => {
    const src = readFileSync(join(root, 'src/env.js'), 'utf8')
    assert.ok(/loaded\.push\(m\[1\]\)/.test(src),
      'env.js must record m[1] (the name); recording m[2] would put secrets in memory for logging')
    assert.ok(!/loaded\.push\(m\[2\]\)/.test(src), 'env.js must never collect values')
  })
})
