// qsearch verifier (canonical module) — pure-function unit tests.
// The judge call + fetch are network/LLM-bound (covered by doesitlie's gold-agreement number);
// here we lock the deterministic ranking + label logic the verdict pipeline depends on.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VERDICTS, rankParagraphs, judgeLabel, estimateTokens, fitToWindow, parseVerdict, normalizeClaim, stripBibliography } from '../../../src/verifier/index.js'

test('VERDICTS is the closed verdict set (including coverage states)', () => {
  assert.deepEqual(VERDICTS, ['Supported', 'Partial', 'Unsupported', 'Contradicted', 'Fabricated', 'Error'])
})

test('parseVerdict accepts the four judge verdicts and rejects anything else', () => {
  for (const v of ['Supported', 'Partial', 'Unsupported', 'Contradicted']) {
    assert.equal(parseVerdict(`{"verdict":"${v}","evidence":"x","confidence":0.9}`)?.verdict, v)
  }
  // the judge is free to shout, and reasoning models wrap the JSON in prose or fences
  assert.equal(parseVerdict('```json\n{"verdict":"CONTRADICTED","evidence":""}\n```')?.verdict, 'Contradicted')
  assert.equal(parseVerdict('<think>hmm</think>{"verdict":"supported","evidence":""}')?.verdict, 'Supported')
  // Fabricated/Error are OUR states, decided by the fetch layer — a judge claiming them is malformed,
  // and so is anything unparseable. Both return null, which the caller scores as Unsupported.
  assert.equal(parseVerdict('{"verdict":"Fabricated","evidence":""}'), null)
  assert.equal(parseVerdict('I could not decide.'), null)
})

test('claim normalisation drops the citing report\'s own bibliography noise', () => {
  const n = normalizeClaim('Diversion lowers recidivism (Smith et al., 2019; Lee & Park, 2020) by 12% [4].')
  assert.ok(!/Smith|2019|\[4\]/.test(n), n)
  assert.ok(n.includes('12%'))
  // a parenthetical that is not a citation must survive
  assert.ok(normalizeClaim('The rule (as amended) took effect.').includes('as amended'))
  // a reference-list paragraph loses to prose, but an all-references page still reaches the judge
  const refs = 'Smith, J. R. (2019). Title. doi:10.1/x. Lee, K. (2020). Other. doi:10.2/y.'
  assert.deepEqual(stripBibliography([refs, 'The court vacated the rule.']), ['The court vacated the rule.'])
  assert.deepEqual(stripBibliography([refs]), [refs])
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

// Regression: the excerpt cap is in characters, the model window is in tokens, and the
// conversion is script-dependent. A flat ratio let Cyrillic excerpts overrun the window
// (judge returned truncated/unparseable JSON) while identical-length Latin text fit fine.
test('estimateTokens charges Cyrillic more tokens per character than Latin', () => {
  const n = 1000
  const latin = 'a'.repeat(n)
  const cyrillic = 'я'.repeat(n)
  assert.ok(estimateTokens(cyrillic) > estimateTokens(latin) * 1.5,
    `cyrillic ${estimateTokens(cyrillic)} should far exceed latin ${estimateTokens(latin)}`)
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(null), 0)
})

test('fitToWindow trims Cyrillic that would overflow, leaves fitting text untouched', () => {
  const small = 'короткий текст'
  assert.equal(fitToWindow(small, 8192), small) // fits → byte-identical

  // 22 000 Cyrillic chars is what selectExcerpt could emit; at ~2.2 chars/token that is
  // ~10k tokens and does NOT fit an 8192 window.
  const big = 'я'.repeat(22000)
  const trimmed = fitToWindow(big, 8192)
  assert.ok(trimmed.length < big.length, 'oversized Cyrillic must be trimmed')
  assert.ok(estimateTokens(trimmed) <= 8192, 'trimmed text must fit the window')

  // The same character count in Latin fits 8192 and must not be touched — this is the
  // property that keeps the published English benchmark byte-reproducible.
  const bigLatin = 'a'.repeat(22000)
  assert.equal(fitToWindow(bigLatin, 16384), bigLatin)
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
