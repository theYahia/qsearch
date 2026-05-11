import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { applyQualityGate, compositeScore } from '../../../src/rerank/quality_gate.js'

describe('compositeScore', () => {
  test('high-authority peer-review + strong embedding → high score', () => {
    const r = {
      url: 'https://www.nature.com/articles/s41586-021-03819-2',
      source: 'pubmed',
      _rerank_score: 0.85,
      _rerank_score_llm: 5,
      trust_score: 1.5
    }
    const { composite } = compositeScore(r)
    assert.ok(composite > 0.7, `expected high composite for authoritative source, got ${composite}`)
  })

  test('unknown blog + weak embedding → low score', () => {
    const r = {
      url: 'https://random-blog.example.com/post-123',
      source: 'searxng',
      _rerank_score: 0.2,
      _rerank_score_llm: null,
      trust_score: 0
    }
    const { composite } = compositeScore(r)
    assert.ok(composite < 0.35, `expected low composite for unknown blog, got ${composite}`)
  })

  test('arxiv source gets max authority', () => {
    const r = { url: 'http://arxiv.org/abs/2207.07410', source: 'arxiv', _rerank_score: 0.5 }
    const { parts } = compositeScore(r)
    assert.equal(parts.authority, 1.0)
  })

  test('reddit source gets low authority', () => {
    const r = { url: 'https://reddit.com/r/MachineLearning', source: 'searxng', _rerank_score: 0.5 }
    const { parts } = compositeScore(r)
    assert.ok(parts.authority < 0.4)
  })
})

describe('applyQualityGate', () => {
  test('keeps items above threshold, rejects below', () => {
    const results = [
      { url: 'https://www.nature.com/x', source: 'pubmed', _rerank_score: 0.9, _rerank_score_llm: 5 },
      { url: 'https://random-blog.io/y', source: 'searxng', _rerank_score: 0.1, _rerank_score_llm: null },
      { url: 'https://arxiv.org/abs/z', source: 'arxiv', _rerank_score: 0.6 }
    ]
    const g = applyQualityGate(results, { threshold: 0.5 })
    assert.equal(g.kept.length, 2)
    assert.equal(g.rejected.length, 1)
    assert.equal(g.rejection_rate, 0.333)
    assert.ok(g.kept.every(r => r._quality_composite >= 0.5))
    assert.ok(g.rejected.every(r => r._quality_composite < 0.5))
  })

  test('empty input', () => {
    const g = applyQualityGate([])
    assert.equal(g.kept.length, 0)
    assert.equal(g.rejection_rate, 0)
  })

  test('annotates kept items with composite score', () => {
    const results = [{ url: 'https://arxiv.org/x', source: 'arxiv', _rerank_score: 0.5 }]
    const g = applyQualityGate(results, { threshold: 0.1 })
    assert.ok(g.kept[0]._quality_composite > 0)
    assert.ok(g.kept[0]._quality_parts.authority === 1.0)
  })
})
