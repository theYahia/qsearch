#!/usr/bin/env node
// qsearch RaaS — CLI entrypoint (the MVP deliverable surface).
//
// Usage:  node src/raas/cli.js <brief.json> [outDir]
// Output: <outDir>/report.md  +  <outDir>/audit.json
//
// brief.json shape: see examples/brief.example.json. The operator hand-authors the claim list;
// this command produces the verified evidence layer + receipt. No web UI, no payment — by design
// (build-spec §c). Charge happens out-of-band.

import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { runBrief } from './pipeline.js'
import { writeReport } from './report.js'
import { confidenceSummary } from './triangulate.js'

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {Promise<number>} exit code
 */
export async function main (argv) {
  const [briefPath, outDir = 'out'] = argv
  if (!briefPath) {
    process.stderr.write('usage: node src/raas/cli.js <brief.json> [outDir]\n')
    return 1
  }
  const brief = JSON.parse(await readFile(briefPath, 'utf-8'))
  // Resolve a relative candidatesFixture against the brief file's directory (not cwd) so the
  // offline path works regardless of where the command is invoked from.
  if (brief.candidatesFixture && !path.isAbsolute(brief.candidatesFixture)) {
    brief.candidatesFixture = path.resolve(path.dirname(briefPath), brief.candidatesFixture)
  }
  const reportInput = await runBrief(brief)
  const { reportPath, auditPath } = await writeReport(reportInput, outDir)
  const s = confidenceSummary(reportInput.claims.map(c => c.verdict))
  process.stderr.write(`[raas] wrote ${reportPath} + ${auditPath}\n`)
  process.stderr.write(`[raas] ${s.triangulated}/${s.total} claims triangulated (${Math.round((s.triangulatedShare || 0) * 100)}%)\n`)
  if (s.total > 0 && s.triangulatedShare < 0.5) {
    process.stderr.write('[raas] WARNING: <50% of claims triangulated — NOT ship-ready. Gather more sources or revise the claims.\n')
  }
  return 0
}

// Only auto-run when invoked directly (so tests can import main without executing).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => process.exit(code)).catch(e => {
    console.error(e)
    process.exit(1)
  })
}
