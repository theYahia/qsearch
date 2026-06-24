// qsearch verifier (canonical module) — pure-function unit tests.
// The judge call + fetch are network/LLM-bound (covered by doesitlie's gold-agreement number);
// here we lock the deterministic ranking + label logic the verdict pipeline depends on.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VERDICTS, rankParagraphs, judgeLabel } from '../../../src/verifier/index.js'

test('VERDICTS is the closed verdict set (including coverage states)', () => {
  assert.deepEqual(VERDICTS, ['Supported', 'Partial', 'Unsupported', 'Fabricated', 'Error'])
})

test('rankParagraphs surfaces term-overlapping paragraphs first', () => {
  const claim = 'Clearbrief charges $300 per user per month'
  const paras = [
    'An unrelated paragraph about the weather and gardening.',
    'Clearbrief pricing: the plan charges per user every month.',
    'Some other legal-tech vendor comparison text.'
  ]
  const ranked = rankParagraphs(claim, paras, 3)
  assert.equal(ranked[0], paras[1]) // the one mentioning clearbrief/pricing/user/month ranks first
})

test('rankParagraphs lets an exact anchor (dollar amount) dominate term overlap', () => {
  const claim = 'The fee is $300 per seat'
  const paras = [
    'fee per seat fee per seat fee per seat seat seat fee', // high term overlap, NO anchor
    'The published amount is $300 in the official table.'    // contains the $300 anchor
  ]
  const ranked = rankParagraphs(claim, paras, 2)
  assert.equal(ranked[0], paras[1]) // anchor (+6) beats raw term overlap
})

test('rankParagraphs falls back to the first k paragraphs when nothing matches', () => {
  const ranked = rankParagraphs('zzzqqq nonexistentterm', ['alpha', 'beta', 'gamma'], 2)
  assert.deepEqual(ranked, ['alpha', 'beta'])
})

test('judgeLabel reflects the configured provider', () => {
  const savedProv = process.env.DOESITLIE_JUDGE_PROVIDER
  const savedKey = process.env.DEEPSEEK_API_KEY
  try {
    process.env.DOESITLIE_JUDGE_PROVIDER = 'ollama'
    assert.match(judgeLabel(), /^ollama:/)
    process.env.DOESITLIE_JUDGE_PROVIDER = 'deepseek'
    assert.match(judgeLabel(), /^deepseek:/)
  } finally {
    if (savedProv === undefined) delete process.env.DOESITLIE_JUDGE_PROVIDER; else process.env.DOESITLIE_JUDGE_PROVIDER = savedProv
    if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = savedKey
  }
})
