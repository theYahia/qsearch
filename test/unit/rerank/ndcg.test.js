import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dcg, idcg, ndcg, ndcgForRanking, normalizeUrlKey } from '../../../src/rerank/ndcg.js'

describe('ndcg — pure ranking metric', () => {
  test('perfect ordering → 1.0', () => {
    assert.equal(ndcg([3, 2, 1, 0]), 1)
  })

  test('reversed ordering scores below ideal', () => {
    const worst = ndcg([0, 1, 2, 3])
    assert.ok(worst < 1)
    assert.ok(worst > 0)
  })

  test('all-zero relevance → 0 (no division blowup)', () => {
    assert.equal(ndcg([0, 0, 0]), 0)
  })

  test('idcg equals dcg of the sorted-desc gains', () => {
    const gains = [1, 3, 0, 2]
    assert.ok(Math.abs(idcg(gains) - dcg([3, 2, 1, 0])) < 1e-9)
  })

  test('NDCG@k respects the cutoff', () => {
    // top-2 are the two relevant ones → NDCG@2 = 1 even though tail is unranked
    assert.ok(Math.abs(ndcg([3, 2, 0, 0], 2) - 1) < 1e-9)
  })

  test('a single swap at the top hurts more than at the tail', () => {
    const topSwap = ndcg([2, 3, 1, 0])   // best two swapped
    const tailSwap = ndcg([3, 2, 0, 1])  // worst two swapped
    assert.ok(tailSwap > topSwap)
  })

  test('ndcgForRanking maps urls through a relevance table', () => {
    const rel = { a: 3, b: 2, c: 1 }
    assert.equal(ndcgForRanking(['a', 'b', 'c', 'd'], rel), 1)
    assert.ok(ndcgForRanking(['d', 'c', 'b', 'a'], rel) < 1)
  })
})

// The legacy metric builds its ideal from WHAT WAS RETURNED, so it cannot see missing
// documents. That matters here specifically: rerank truncates (pipeline topN 10 →
// llm_rerank topOut 5), so under the legacy metric a reranker can win by discarding.
// These lock the recall-aware variant that makes the comparison honest.
describe('ndcgForRanking — idealFromGolden (recall-aware)', () => {
  const rel = { a: 3, b: 3, c: 3 }

  test('legacy scores a perfect 1.000 at one-third recall', () => {
    assert.equal(ndcgForRanking(['a'], rel, 5), 1)
  })

  test('recall-aware refuses to call one-of-three perfect', () => {
    const partial = ndcgForRanking(['a'], rel, 5, { idealFromGolden: true })
    assert.ok(partial > 0 && partial < 0.55, `expected a partial score, got ${partial}`)
  })

  test('recall-aware still gives 1.000 when everything relevant is returned in order', () => {
    assert.equal(ndcgForRanking(['a', 'b', 'c'], rel, 5, { idealFromGolden: true }), 1)
  })

  test('truncating a full result set can no longer improve the score', () => {
    const full = ndcgForRanking(['a', 'b', 'c'], rel, 5, { idealFromGolden: true })
    const cut = ndcgForRanking(['a'], rel, 5, { idealFromGolden: true })
    assert.ok(cut < full, 'dropping relevant results must lower the score')
  })

  test('an empty golden set scores 0 rather than dividing by zero', () => {
    assert.equal(ndcgForRanking(['a'], {}, 5, { idealFromGolden: true }), 0)
  })
})

describe('normalizeUrlKey — the silent false-miss fixer', () => {
  test('trailing slash, www, scheme and fragment all collapse', () => {
    const canonical = normalizeUrlKey('https://qdrant.tech/benchmarks')
    for (const variant of [
      'https://qdrant.tech/benchmarks/',
      'http://qdrant.tech/benchmarks',
      'https://www.qdrant.tech/benchmarks',
      'https://qdrant.tech/benchmarks#section-2'
    ]) assert.equal(normalizeUrlKey(variant), canonical, `variant not normalised: ${variant}`)
  })

  test('root slash is preserved', () => {
    assert.equal(normalizeUrlKey('https://a.com/'), 'https://a.com/')
  })

  test('a non-URL degrades to trimmed lowercase instead of throwing', () => {
    assert.equal(normalizeUrlKey('  NotAUrl '), 'notaurl')
  })

  test('normalizeUrls option rescues a grade the exact match would miss', () => {
    // Golden written with a trailing slash; the engine returned the canonical form.
    const golden = { 'https://qdrant.tech/benchmarks/': 3 }
    const returned = ['https://qdrant.tech/benchmarks']
    assert.equal(ndcgForRanking(returned, golden, 5), 0, 'exact match should miss')
    assert.equal(ndcgForRanking(returned, golden, 5, { normalizeUrls: true }), 1)
  })
})
