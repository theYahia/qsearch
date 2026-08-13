import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { MeilisearchCorpus } from '../../../src/corpus/meilisearch.js'

// These run without a live Meilisearch: the client is replaced with a stub and _ready is forced,
// so _ensureIndex is skipped. That is deliberate — the shipped freshness filter was broken for
// the entire life of the feature precisely because the only tests covering it were integration
// tests that skip when MEILISEARCH_URL is unset, which is the default.

function stubCorpus ({ hits = [], failFilteredSearch = false } = {}) {
  const calls = []
  const corpus = new MeilisearchCorpus('http://stub', 'stub')
  corpus._ready = true
  corpus._client = {
    index: () => ({
      search: async (query, opts) => {
        calls.push({ query, opts })
        if (failFilteredSearch && opts?.filter) {
          const e = new Error('Invalid syntax for the filter parameter: ` --> 1:19\n  |\n1 | crawled_at >= "2026-07-05T10:07:57.629Z"\n  |                   ^---\n  |\n  = invalid float literal`.')
          throw e
        }
        return { hits }
      },
      getDocument: async () => { const e = new Error('document_not_found'); e.httpStatus = 404; throw e },
      addDocuments: async (docs) => { calls.push({ addDocuments: docs }); return { taskUid: 1 } }
    })
  }
  return { corpus, calls }
}

const hit = (url, score) => ({ url, title: url, text: 'x', crawled_at: '2026-08-01T00:00:00.000Z', engines: ['brave'], _rankingScore: score })

describe('corpusLookup — freshness filter is numeric', () => {
  beforeEach(() => { MeilisearchCorpus._warnedFreshness = false })

  test('filters on crawled_at_ms with a bare number, never a quoted ISO string', async () => {
    const { corpus, calls } = stubCorpus({ hits: [hit('https://a', 0.9)] })
    await corpus.corpusLookup('q', { maxAgeDays: 30 })
    const filter = calls[0].opts.filter
    // The exact shape of the shipped bug: Meilisearch's >= is numeric, so a quoted ISO string
    // is rejected with "invalid float literal" on every single call.
    assert.match(filter, /^crawled_at_ms >= \d+$/, `filter must be numeric, got: ${filter}`)
    assert.ok(!filter.includes('"'), 'a quoted value means the string-comparison bug is back')
  })

  test('the cutoff matches the requested age window', async () => {
    const { corpus, calls } = stubCorpus({ hits: [hit('https://a', 0.9)] })
    const before = Date.now()
    await corpus.corpusLookup('q', { maxAgeDays: 7 })
    const cutoff = Number(calls[0].opts.filter.match(/(\d+)$/)[1])
    const expected = before - 7 * 86400000
    assert.ok(Math.abs(cutoff - expected) < 5000, `cutoff ${cutoff} not ~7 days back (expected ~${expected})`)
  })

  test('maxAgeDays 0 disables the filter entirely', async () => {
    const { corpus, calls } = stubCorpus({ hits: [hit('https://a', 0.9)] })
    await corpus.corpusLookup('q', { maxAgeDays: 0 })
    assert.equal(calls[0].opts.filter, undefined)
  })

  test('reports freshness_filtered so callers can tell whether the gate applied', async () => {
    const { corpus } = stubCorpus({ hits: [hit('https://a', 0.9)] })
    assert.equal((await corpus.corpusLookup('q', { maxAgeDays: 30 })).freshness_filtered, true)
    assert.equal((await corpus.corpusLookup('q', { maxAgeDays: 0 })).freshness_filtered, false)
  })
})

describe('corpusLookup — degrading when the filter is unavailable', () => {
  beforeEach(() => { MeilisearchCorpus._warnedFreshness = false })

  test('falls back to an unfiltered search rather than throwing', async () => {
    const { corpus, calls } = stubCorpus({ hits: [hit('https://a', 0.9)], failFilteredSearch: true })
    const r = await corpus.corpusLookup('q', { maxAgeDays: 30 })
    assert.equal(calls.length, 2, 'expected a filtered attempt then an unfiltered retry')
    assert.equal(calls[1].opts.filter, undefined)
    assert.equal(r.count, 1)
  })

  test('says so — the silent fallback is what hid the broken filter for the life of the feature', async () => {
    const { corpus } = stubCorpus({ hits: [hit('https://a', 0.9)], failFilteredSearch: true })
    const seen = []
    const orig = console.warn
    console.warn = (m) => seen.push(m)
    try { await corpus.corpusLookup('q', { maxAgeDays: 30 }) } finally { console.warn = orig }
    assert.equal(seen.length, 1, 'the degraded path must warn')
    assert.match(seen[0], /UNFILTERED/)
  })

  test('warns once per process, not once per lookup', async () => {
    const { corpus } = stubCorpus({ hits: [hit('https://a', 0.9)], failFilteredSearch: true })
    const seen = []
    const orig = console.warn
    console.warn = (m) => seen.push(m)
    try {
      for (let i = 0; i < 5; i++) await corpus.corpusLookup('q', { maxAgeDays: 30 })
    } finally { console.warn = orig }
    assert.equal(seen.length, 1, `expected 1 warning across 5 lookups, got ${seen.length}`)
  })

  test('freshness_filtered is false when the filter could not be applied', async () => {
    const { corpus } = stubCorpus({ hits: [hit('https://a', 0.9)], failFilteredSearch: true })
    assert.equal((await corpus.corpusLookup('q', { maxAgeDays: 30 })).freshness_filtered, false)
  })
})

describe('corpusLookup — per-hit scores are surfaced', () => {
  beforeEach(() => { MeilisearchCorpus._warnedFreshness = false })

  test('scores array and per-hit ranking_score both appear, in hit order', async () => {
    const { corpus } = stubCorpus({ hits: [hit('https://a', 0.9), hit('https://b', 0.5), hit('https://c', 0.3)] })
    const r = await corpus.corpusLookup('q', { maxAgeDays: 0 })
    assert.deepEqual(r.scores, [0.9, 0.5, 0.3])
    assert.deepEqual(r.hits.map(h => h.ranking_score), [0.9, 0.5, 0.3])
  })

  test('a missing _rankingScore counts as 0 rather than undefined', async () => {
    const { corpus } = stubCorpus({ hits: [{ url: 'https://a', title: 'a', text: 'x' }] })
    const r = await corpus.corpusLookup('q', { maxAgeDays: 0 })
    assert.deepEqual(r.scores, [0])
  })

  // Documents the behaviour the C4 sweep was built to question. Not an endorsement: the gate
  // averages, so one strong hit carries two weak ones past the floor. Measured on the live
  // index, "цена на бананы в Эквадоре сегодня" clears 0.55 at mean 0.603.
  test('sufficient gates on the MEAN, so 0.9/0.5/0.3 passes a 0.55 floor', async () => {
    const { corpus } = stubCorpus({ hits: [hit('https://a', 0.9), hit('https://b', 0.5), hit('https://c', 0.3)] })
    const r = await corpus.corpusLookup('q', { maxAgeDays: 0, minScore: 0.55, minHits: 3 })
    assert.ok(Math.abs(r.avgScore - 0.5667) < 0.001)
    assert.equal(r.sufficient, true)
    assert.equal(r.scores.filter(s => s >= 0.55).length, 1, 'only one hit actually clears the floor')
  })
})

describe('index() — crawled_at_ms companion', () => {
  test('derives crawled_at_ms from crawled_at', async () => {
    const { corpus, calls } = stubCorpus()
    await corpus.index({ url: 'https://a', title: 'a', text: 'x', crawled_at: '2026-08-01T00:00:00.000Z' })
    const written = calls.find(c => c.addDocuments)?.addDocuments[0]
    assert.equal(written.crawled_at_ms, Date.parse('2026-08-01T00:00:00.000Z'))
  })

  test('omits the field rather than writing NaN when crawled_at is missing or junk', async () => {
    for (const crawled of [undefined, 'not-a-date']) {
      const { corpus, calls } = stubCorpus()
      await corpus.index({ url: 'https://a', title: 'a', text: 'x', crawled_at: crawled })
      const written = calls.find(c => c.addDocuments)?.addDocuments[0]
      assert.ok(!('crawled_at_ms' in written), `crawled_at=${crawled} must not produce a crawled_at_ms`)
    }
  })
})
