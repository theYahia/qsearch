// Tests for bench/harness.js scoring + ranking + rendering (previously untested).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreAgent, cmpRank, renderMarkdown } from '../harness.js'

const mk = verdicts => verdicts.map(v => ({ verdict: v }))

test('scoreAgent — counts, coverage, and the two rate denominators', () => {
  // 6 Supported, 1 Partial, 1 Unsupported, 1 Fabricated, 1 Error → total 10, scorable 9
  const s = scoreAgent(mk(['Supported', 'Supported', 'Supported', 'Supported', 'Supported', 'Supported', 'Partial', 'Unsupported', 'Fabricated', 'Error']))
  assert.equal(s.total, 10)
  assert.equal(s.scorable, 9)
  assert.equal(s.counts.Supported, 6)
  assert.equal(s.counts.Error, 1)
  assert.ok(Math.abs(s.coverage - 0.9) < 1e-9)            // 9/10 fetched
  assert.ok(Math.abs(s.fabricatedRate - 0.1) < 1e-9)      // 1/10 over ALL
  assert.ok(Math.abs(s.unsupportedRate - 0.1) < 1e-9)     // 1/10 over ALL
  assert.ok(Math.abs(s.supportedOfTotal - 0.6) < 1e-9)    // 6/10 over ALL
  assert.ok(Math.abs(s.supportRate - 6 / 9) < 1e-9)       // 6/9 over fetched (legacy)
})

test('scoreAgent — empty results are safe (no divide-by-zero)', () => {
  const s = scoreAgent([])
  assert.equal(s.total, 0)
  assert.equal(s.fabricatedRate, 0)
  assert.equal(s.supportRate, 0)
})

test('cmpRank — fabricated dominates, then unsupported, then supported', () => {
  const a = { score: scoreAgent(mk(['Supported', 'Supported', 'Fabricated'])) }      // fab 1/3
  const b = { score: scoreAgent(mk(['Supported', 'Unsupported', 'Unsupported'])) }   // fab 0
  assert.ok(cmpRank(b, a) < 0, 'agent with 0 fabricated ranks ahead of one with fabrications')

  // tie on fabricated (both 0) → lower unsupported wins
  const c = { score: scoreAgent(mk(['Supported', 'Supported', 'Unsupported'])) }     // unsup 1/3
  const d = { score: scoreAgent(mk(['Supported', 'Supported', 'Supported'])) }       // unsup 0
  assert.ok(cmpRank(d, c) < 0)

  // ranking is NOT decided by the coverage-dependent supportRate
  const highCovGaming = { score: scoreAgent(mk(['Supported', 'Fabricated'])) }       // fab 0.5
  const honest = { score: scoreAgent(mk(['Unsupported', 'Unsupported'])) }           // fab 0
  assert.ok(cmpRank(honest, highCovGaming) < 0, 'citing one good + one fake must not beat an honest-but-weak agent')
})

test('renderMarkdown — emits a header and one row per agent', () => {
  const board = [
    { agent: 'Agent A', score: scoreAgent(mk(['Supported', 'Supported'])) },
    { agent: 'Agent B', score: scoreAgent(mk(['Fabricated', 'Unsupported'])) }
  ]
  const md = renderMarkdown(board)
  assert.ok(md.includes('| Agent A |'))
  assert.ok(md.includes('| Agent B |'))
  assert.ok(/Cites|Coverage|Supported/.test(md))
  // count data rows only (the header "| Agent | Cites |…" also starts with "| Agent")
  assert.equal(md.split('\n').filter(l => /^\| Agent [AB] \|/.test(l)).length, 2)
})
