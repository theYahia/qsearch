// rd239 ultra-broad tier — router branch + parser downgrade coverage.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createSweepRouter } from '../../../src/sweep/router.js'
import { parseQueriesText, VALID_PRIORITIES } from '../../../src/sweep/runner.js'

function recorder () {
  const calls = []
  const tag = (name) => async (...args) => { calls.push({ name, args }); return { _tag: name, args } }
  return { calls, tag }
}

function depsWith (overrides = {}) {
  const r = recorder()
  return {
    rec: r,
    deps: {
      searxng: null, academic: null, yandex: null, braveKey: null,
      braveFetch: r.tag('brave'),
      searxngAsBraveResponse: r.tag('searxng'),
      academicAsBraveResponse: r.tag('academic'),
      yandexAsBraveResponse: r.tag('yandex'),
      endpointName: '/sweep',
      ...overrides
    }
  }
}

describe('createSweepRouter — ultra-broad tier (rd239)', () => {
  test('sufficient corpus hit returns corpus response without touching SearXNG', async () => {
    const corpusLookup = async () => ({ sufficient: true, response: { _tag: 'corpus' } })
    const { rec, deps } = depsWith({ searxng: { name: 'sx' }, corpusLookup })
    const out = await createSweepRouter(deps)('ultra-broad', 'general')('web', 'q', {})
    assert.equal(out._tag, 'corpus')
    assert.equal(rec.calls.length, 0, 'SearXNG must not be called on a corpus hit')
  })

  test('insufficient corpus falls through to broad (SearXNG)', async () => {
    const corpusLookup = async () => ({ sufficient: false })
    const { rec, deps } = depsWith({ searxng: { name: 'sx' }, corpusLookup })
    await createSweepRouter(deps)('ultra-broad', 'general')('web', 'q', {})
    assert.equal(rec.calls.length, 1)
    assert.equal(rec.calls[0].name, 'searxng')
  })

  test('no corpusLookup dep → falls through to broad (never fails the query)', async () => {
    const { rec, deps } = depsWith({ searxng: { name: 'sx' } }) // corpusLookup undefined
    await createSweepRouter(deps)('ultra-broad', 'general')('web', 'q', {})
    assert.equal(rec.calls.length, 1)
    assert.equal(rec.calls[0].name, 'searxng')
  })

  test('ultra-broad with no searxng and no brave key throws (same as broad)', async () => {
    const corpusLookup = async () => ({ sufficient: false })
    const { deps } = depsWith({ corpusLookup })
    await assert.rejects(() => createSweepRouter(deps)('ultra-broad', 'general')('web', 'q', {}), /needs SEARXNG_URL or BRAVE_API_KEY/)
  })
})

describe('parseQueriesText — ultra-broad parsing + stale-label downgrade (rd239)', () => {
  test('ultra-broad is a valid priority', () => {
    assert.ok(VALID_PRIORITIES.has('ultra-broad'))
  })

  test('parses an ultra-broad line', () => {
    const [q] = parseQueriesText('qdrant_basics|qdrant production 2026|ultra-broad')
    assert.equal(q.priority, 'ultra-broad')
    assert.equal(q.domain, 'general')
  })

  test('downgrades ultra-broad → broad for time-sensitive labels', () => {
    for (const label of ['news_ai', 'market_size', 'regulatory_eu']) {
      const [q] = parseQueriesText(`${label}|some query|ultra-broad`)
      assert.equal(q.priority, 'broad', `${label} must downgrade`)
    }
  })

  test('keeps ultra-broad for non-time-sensitive labels', () => {
    const [q] = parseQueriesText('vendor_docs|qdrant docs|ultra-broad')
    assert.equal(q.priority, 'ultra-broad')
  })
})
