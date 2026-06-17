// Re-render leaderboard.md + refresh per-agent score objects FROM the existing audit.json,
// WITHOUT re-judging. Uses the exact stored verdicts (reproducible — no model drift), and applies
// the current scoreAgent/renderMarkdown (coverage-adjusted, gaming-resistant metrics).
//
// Usage: node doesitlie/bench/rescore.mjs [out/all/audit.json] [out/all]
import fs from 'node:fs/promises'
import { scoreAgent, renderMarkdown, cmpRank } from './harness.js'

const auditPath = process.argv[2] || 'doesitlie/bench/out/all/audit.json'
const outDir = process.argv[3] || 'doesitlie/bench/out/all'
const audit = JSON.parse(await fs.readFile(auditPath, 'utf-8'))

const board = audit.map(a => ({ agent: a.agent, score: scoreAgent(a.results) }))
board.sort(cmpRank)
const newAudit = audit.map(a => ({ agent: a.agent, score: scoreAgent(a.results), results: a.results }))

await fs.writeFile(`${outDir}/leaderboard.md`, renderMarkdown(board))
await fs.writeFile(`${outDir}/audit.json`, JSON.stringify(newAudit, null, 2))
console.log(renderMarkdown(board))
