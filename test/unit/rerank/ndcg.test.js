import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dcg, idcg, ndcg, ndcgForRanking } from '../../../src/rerank/ndcg.js'

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
