// rd277: unit coverage for createSweepRouter — the DRY-extracted dispatcher
// shared by /sweep and /cached_sweep. Pure function, no IO. Stub every backend
// helper so we can assert which one was called for each priority/domain combo.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createSweepRouter } from '../../../src/sweep/router.js'

function recorder () {
  const calls = []
  const tag = (name) => async (...args) => { calls.push({ name, args }); return { _tag: name, args } }
  const tagThrow = (name, err) => async () => { calls.push({ name, threw: err.message }); throw err }
  return { calls, tag, tagThrow }
}

function depsWith (overrides = {}) {
  const r = recorder()
  return {
    rec: r,
    deps: {
      searxng: null,
      academic: null,
      yandex: null,
      braveKey: null,
      braveFetch: r.tag('brave'),
      searxngAsBraveResponse: r.tag('searxng'),
      academicAsBraveResponse: r.tag('academic'),
      yandexAsBraveResponse: r.tag('yandex'),
      endpointName: '/sweep',
      ...overrides
    }
  }
}

describe('createSweepRouter — endpoint contract', () => {
  test('rejects non-web endpoint with endpointName-prefixed error', async () => {
    const { deps } = depsWith({ braveKey: 'k' })
    const router = createSweepRouter(deps)('focused', 'general')
    await assert.rejects(() => router('news', 'q', {}), /\/sweep only supports web/)
  })

  test('endpointName propagates (cached_sweep variant)', async () => {
    const { deps } = depsWith({ braveKey: 'k', endpointName: '/cached_sweep' })
    const router = createSweepRouter(deps)('focused', 'general')
    await assert.rejects(() => router('news', 'q', {}), /\/cached_sweep only supports web/)
  })
})

describe('createSweepRouter — Phase A scholarly override', () => {
  test('domain=scholarly with academic enabled routes to academic (regardless of priority)', async () => {
    const { rec, deps } = depsWith({ academic: { name: 'academic' }, braveKey: 'k' })
    const router = createSweepRouter(deps)
    await router('critical', 'scholarly')('web', 'paper search', { count: 5 })
    assert.equal(rec.calls.length, 1)
    assert.equal(rec.calls[0].name, 'academic')
  })

  test('domain=scholarly without academic falls through to priority handling', async () => {
    const { rec, deps } = depsWith({ academic: null, braveKey: 'k' })
    const router = createSweepRouter(deps)
    await router('focused', 'scholarly')('web', 'paper search', {})
    assert.equal(rec.calls.length, 1)
    assert.equal(rec.calls[0].name, 'brave') // priority=focused with braveKey → brave
  })
})

describe('createSweepRouter — Phase C ru / Yandex', () => {
  test('domain=ru with yandex enabled routes to yandex', async () => {
    const { rec, deps } = depsWith({ yandex: { name: 'yandex' }, braveKey: 'k' })
    const router = createSweepRouter(deps)
    await router('focused', 'ru')('web', 'q', {})
    assert.equal(rec.calls.length, 1)
    assert.equal(rec.calls[0].name, 'yandex')
  })

  test('yandex throw falls back to searxng with ru-RU bias', async () => {
    const r = recorder()
    const deps = {
      searxng: { name: 'searxng' }, academic: null, yandex: { name: 'yandex' }, braveKey: 'k',
      braveFetch: r.tag('brave'),
      searxngAsBraveResponse: r.tag('searxng'),
      academicAsBraveResponse: r.tag('academic'),
      yandexAsBraveResponse: r.tagThrow('yandex', new Error('yandex 500')),
      endpointName: '/sweep'
    }
    const router = createSweepRouter(deps)
    // domain=ru + yandex throws → searxng with language=ru-RU
    // BUT current code only routes to searxng for broad priority. For focused/critical,
    // yandex-throw falls to brave (priority path). We assert the broad case explicitly:
    await router('broad', 'ru')('web', 'q', {})
    const sx = r.calls.find(c => c.name === 'searxng')
    assert.ok(sx, 'searxng was called after yandex failure')
    // Third arg is searxngOpts with language: 'ru-RU'
    assert.deepEqual(sx.args[2], { language: 'ru-RU' })
  })
})

describe('createSweepRouter — priority routing', () => {
  test('broad with searxng configured → searxng (free tier preferred)', async () => {
    const { rec, deps } = depsWith({ searxng: { name: 'sx' }, braveKey: 'k' })
    const router = createSweepRouter(deps)
    await router('broad', 'general')('web', 'q', {})
    assert.equal(rec.calls[0].name, 'searxng')
  })

  test('broad without searxng but with braveKey → braveFetch (no extra_snippets)', async () => {
    const { rec, deps } = depsWith({ braveKey: 'k' })
    const router = createSweepRouter(deps)
    await router('broad', 'general')('web', 'q', { count: 10 })
    assert.equal(rec.calls[0].name, 'brave')
    // params passed through as-is, NO extra_snippets injected
    assert.equal(rec.calls[0].args[2].extra_snippets, undefined)
  })

  test('broad without searxng without braveKey → throws', async () => {
    const { deps } = depsWith({})
    const router = createSweepRouter(deps)
    await assert.rejects(() => router('broad', 'general')('web', 'q', {}), /needs SEARXNG_URL or BRAVE_API_KEY/)
  })

  test('focused with braveKey → braveFetch with extra_snippets: true (1 call, no context)', async () => {
    const { rec, deps } = depsWith({ braveKey: 'k' })
    const router = createSweepRouter(deps)
    await router('focused', 'general')('web', 'q', { count: 10 })
    assert.equal(rec.calls.length, 1)
    assert.equal(rec.calls[0].name, 'brave')
    assert.equal(rec.calls[0].args[0], 'web')
    assert.equal(rec.calls[0].args[2].extra_snippets, true)
  })

  test('critical with braveKey → web + llm/context (2 calls, earns $0.01 tier)', async () => {
    const { rec, deps } = depsWith({ braveKey: 'k' })
    const router = createSweepRouter(deps)
    await router('critical', 'general')('web', 'q', { count: 20 })
    assert.equal(rec.calls.length, 2, 'critical must make web + context calls')
    assert.equal(rec.calls[0].args[0], 'web')
    assert.equal(rec.calls[0].args[2].extra_snippets, true)
    assert.equal(rec.calls[1].args[0], 'llm/context')
  })

  test('critical attaches context_grounding to web.data on success', async () => {
    const calls = []
    const braveFetch = async (...args) => {
      calls.push(args)
      if (args[0] === 'llm/context') return { data: { grounding: { generic: [{ url: 'g', title: 't', snippets: ['s'] }] } } }
      return { data: { web: { results: [{ url: 'u' }] } } }
    }
    const router = createSweepRouter({ ...depsWith({ braveKey: 'k' }).deps, braveFetch })
    const res = await router('critical', 'general')('web', 'q', {})
    assert.equal(calls.length, 2)
    assert.deepEqual(res.data.context_grounding, [{ url: 'g', title: 't', snippets: ['s'] }])
  })

  test('critical context soft-fail → web result still returned', async () => {
    const calls = []
    const braveFetch = async (...args) => {
      calls.push(args)
      if (args[0] === 'llm/context') throw new Error('context 500')
      return { data: { web: { results: [{ url: 'u' }] } } }
    }
    const router = createSweepRouter({ ...depsWith({ braveKey: 'k' }).deps, braveFetch })
    const res = await router('critical', 'general')('web', 'q', {})
    assert.equal(calls.length, 2) // web ok + context attempted
    assert.equal(res.data.web.results.length, 1) // web survived the context failure
    assert.equal(res.data.context_grounding, undefined) // nothing attached on failure
  })

  test('critical without braveKey but with searxng → searxng fallback', async () => {
    const { rec, deps } = depsWith({ searxng: { name: 'sx' } })
    const router = createSweepRouter(deps)
    await router('critical', 'general')('web', 'q', {})
    assert.equal(rec.calls[0].name, 'searxng')
  })

  test('critical without braveKey without searxng → throws', async () => {
    const { deps } = depsWith({})
    const router = createSweepRouter(deps)
    await assert.rejects(() => router('critical', 'general')('web', 'q', {}), /needs BRAVE_API_KEY/)
  })
})
