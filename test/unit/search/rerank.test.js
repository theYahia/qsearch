import { test, describe, mock, before } from 'node:test'
import assert from 'node:assert/strict'

// ─────────────────────────────────────────────────────────────────────────────
// rerankByTrust (src/search/rerank.js) re-ranks corpus results by a trust score.
//
//   trust = log(sweepLabels + 1) × engineDiversity × topicDiversity
//   rerank = (1 / position) × log(trust + 1)
//
// The module hardcodes `new Meilisearch({ host: MEILISEARCH_URL || ... })` and
// queries the `qsearch_corpus` index — there is no client injection point. To
// keep this test hermetic (never touch the real live index, fully deterministic)
// we use two strategies:
//
//   A. CLOSED-PORT (always runs, no flags): before importing the module we set
//      MEILISEARCH_URL to a port nothing listens on. Every idx.search() rejects,
//      so the per-result catch branch runs and results pass through unchanged
//      (no trust_score added). This deterministically exercises: the empty/null
//      guards, the missing-`url` passthrough, the catch passthrough, and the
//      final rerank_score sort with mixed/undefined scores.
//
//   B. MODULE-MOCK (math happy path): stub the `meilisearch` package so search()
//      returns controlled hits, pinning exact trust_score/rerank_score values
//      and the trust-descending sort. node:test module mocking needs the
//      --experimental-test-module-mocks flag; under plain `node --test` it is
//      unavailable, so those tests SKIP (never silently hit the real index).
// ─────────────────────────────────────────────────────────────────────────────

// Point at a closed port BEFORE the module is imported (the URL is read at the
// top of the module and again per call inside rerankByTrust → both see this).
process.env.MEILISEARCH_URL = 'http://127.0.0.1:1' // port 1 — nothing listens

const { rerankByTrust } = await import('../../../src/search/rerank.js')

// Helper: round like the module does (4 dp for rerank_score, 2 dp for trust).
const r4 = (n) => Number(n.toFixed(4))
const r2 = (n) => Number(n.toFixed(2))

describe('rerankByTrust — guard clauses (no network)', () => {
  test('empty array is returned as-is (same reference, short-circuit)', async () => {
    const input = []
    const out = await rerankByTrust(input)
    assert.equal(out, input) // identity — the `if (!results.length) return results` path
    assert.deepEqual(out, [])
  })

  test('non-empty falsy-length is impossible; null/undefined throw (documents real behavior)', async () => {
    // The guard is `if (!results.length)` which dereferences `.length`.
    // null/undefined have no `.length` → TypeError. This pins current behavior;
    // see limitations (the module does not defensively handle null input).
    await assert.rejects(() => rerankByTrust(null), TypeError)
    await assert.rejects(() => rerankByTrust(undefined), TypeError)
  })
})

describe('rerankByTrust — results without a url (passthrough, no network)', () => {
  test('a single url-less result is pushed unchanged (no trust_score / rerank_score)', async () => {
    const input = [{ title: 'no url here', id: 7 }]
    const out = await rerankByTrust(input)
    assert.equal(out.length, 1)
    assert.deepEqual(out[0], { title: 'no url here', id: 7 })
    assert.ok(!('trust_score' in out[0]), 'url-less result must not gain trust_score')
    assert.ok(!('rerank_score' in out[0]), 'url-less result must not gain rerank_score')
  })

  test('does not mutate the original objects (pushes the same refs through)', async () => {
    const a = { url: undefined, tag: 'a' }
    const b = { tag: 'b' } // no url key at all
    const out = await rerankByTrust([a, b])
    // Both lack a usable url → both pass straight through untouched.
    assert.ok(out.includes(a))
    assert.ok(out.includes(b))
    assert.deepEqual(a, { url: undefined, tag: 'a' })
    assert.deepEqual(b, { tag: 'b' })
  })

  test('empty-string url is falsy → treated as url-less (passthrough)', async () => {
    const input = [{ url: '', name: 'empty-url' }]
    const out = await rerankByTrust(input)
    assert.deepEqual(out, [{ url: '', name: 'empty-url' }])
    assert.ok(!('trust_score' in out[0]))
  })
})

describe('rerankByTrust — Meilisearch unreachable (catch branch, deterministic)', () => {
  test('a result WITH a url survives a failed trust query, unchanged', async () => {
    const input = [{ url: 'https://example.com/a', score: 0.9 }]
    const out = await rerankByTrust(input)
    assert.equal(out.length, 1)
    // search() rejects (closed port) → catch pushes the original result back.
    assert.deepEqual(out[0], { url: 'https://example.com/a', score: 0.9 })
    assert.ok(!('trust_score' in out[0]), 'failed query must NOT attach a trust_score')
    assert.ok(!('rerank_score' in out[0]), 'failed query must NOT attach a rerank_score')
  })

  test('all results returned even when every trust query fails (count preserved)', async () => {
    const input = [
      { url: 'https://example.com/1' },
      { url: 'https://example.com/2' },
      { url: 'https://example.com/3' }
    ]
    const out = await rerankByTrust(input)
    assert.equal(out.length, 3)
    const urls = out.map((r) => r.url).sort()
    assert.deepEqual(urls, [
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3'
    ])
  })

  test('mixed url / url-less inputs: all preserved, none scored when queries fail', async () => {
    const input = [
      { url: 'https://example.com/x', k: 1 },
      { note: 'no url', k: 2 },
      { url: 'https://example.com/y', k: 3 }
    ]
    const out = await rerankByTrust(input)
    assert.equal(out.length, 3)
    for (const r of out) {
      assert.ok(!('rerank_score' in r), 'no result should be scored when Meili is down')
    }
    // Order without scores: sort key is (b.rerank_score||0)-(a.rerank_score||0)
    // = 0 for all → comparator returns 0 → Array.sort is stable (V8) → input order.
    assert.deepEqual(out.map((r) => r.k), [1, 2, 3])
  })

  test('sort is stable when all rerank_scores are absent (treated as 0)', async () => {
    // Build an order that would change if the comparator were unstable.
    const input = Array.from({ length: 8 }, (_, i) => ({ url: `https://e.com/${i}`, seq: i }))
    const out = await rerankByTrust(input)
    assert.deepEqual(out.map((r) => r.seq), [0, 1, 2, 3, 4, 5, 6, 7])
  })
})

describe('rerankByTrust — final sort with pre-set rerank_score (no network needed)', () => {
  // Even though these inputs carry urls, the trust query fails (closed port) so
  // the catch path returns each object UNCHANGED — including any rerank_score
  // the caller already put on it. That lets us assert the final sort in
  // isolation: it orders by (b.rerank_score||0) - (a.rerank_score||0) desc and
  // treats a missing rerank_score as 0.
  test('orders by descending rerank_score, missing score sinks to 0', async () => {
    const input = [
      { url: 'https://e.com/low', rerank_score: 0.10 },
      { url: 'https://e.com/none' }, // missing → 0
      { url: 'https://e.com/high', rerank_score: 0.90 },
      { url: 'https://e.com/mid', rerank_score: 0.50 }
    ]
    const out = await rerankByTrust(input)
    assert.deepEqual(
      out.map((r) => r.url),
      ['https://e.com/high', 'https://e.com/mid', 'https://e.com/low', 'https://e.com/none']
    )
  })
})

// ─── B. Module-mock happy path: pins the trust math + scoring + sort. ──────────
// Requires `node --test --experimental-test-module-mocks`. Without the flag,
// mock.module throws → we skip rather than silently hit the real index.
let mockModuleUsable = false
try {
  // Probe support without registering a real mock against `meilisearch` yet.
  mockModuleUsable = typeof mock.module === 'function'
} catch {
  mockModuleUsable = false
}

describe('rerankByTrust — trust math + sort (module mock)', { skip: !mockModuleUsable ? 'run with --experimental-test-module-mocks to enable' : false }, () => {
  // Per-url canned hit sets. Keyed by the url the module filters on.
  const HITS = new Map()
  let searchCalls = 0

  before(() => {
    // Replace the `meilisearch` package with a fake whose Meilisearch class
    // returns an index whose search() reads from HITS by the url in the filter.
    class FakeIndex {
      async search (_q, opts) {
        searchCalls++
        // filter looks like:  url = 'https://...'
        const m = /url = '(.*)'$/.exec(opts.filter || '')
        const url = m ? m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : null
        return { hits: HITS.get(url) || [] }
      }
    }
    class FakeMeili {
      index () { return new FakeIndex() }
    }
    mock.module('meilisearch', { namedExports: { Meilisearch: FakeMeili } })
  })

  test('computes trust_score and rerank_score with exact rounding (position 1)', async () => {
    HITS.clear()
    searchCalls = 0
    // 2 distinct sweep_labels, 2 distinct topics (russia / china), 3 distinct engines.
    HITS.set('https://t.io/a', [
      { sweep_label: 'russia_q1', engines: ['brave', 'google'] },
      { sweep_label: 'china_q1', engines: ['google', 'bing'] }
    ])
    // Re-import a fresh copy so it binds the mocked `meilisearch`.
    const mod = await import('../../../src/search/rerank.js?mockA=' + Date.now())
    const out = await mod.rerankByTrust([{ url: 'https://t.io/a' }])

    const sweeps = 2, engines = 3, topics = 2
    const trust = Math.log(sweeps + 1) * engines * topics // log(3)*3*2
    const rerank = (1 / 1) * Math.log(trust + 1)
    assert.equal(out.length, 1)
    assert.equal(out[0].trust_score, r2(trust))
    assert.equal(out[0].rerank_score, r4(rerank))
    assert.ok(searchCalls >= 1, 'the mocked index search must have been called')
  })

  test('no hits → trust 0, rerank 0 (log(0+1)=0), still attaches both fields', async () => {
    HITS.clear()
    HITS.set('https://t.io/empty', []) // url known to corpus filter but zero docs
    const mod = await import('../../../src/search/rerank.js?mockB=' + Date.now())
    const out = await mod.rerankByTrust([{ url: 'https://t.io/empty' }])
    assert.equal(out[0].trust_score, 0)
    assert.equal(out[0].rerank_score, 0)
  })

  test('duplicate sweep_labels / engines are de-duplicated via Sets', async () => {
    HITS.clear()
    HITS.set('https://t.io/dup', [
      { sweep_label: 'russia_q1', engines: ['brave', 'brave'] },
      { sweep_label: 'russia_q1', engines: ['brave'] }, // same label, same engine
      { sweep_label: 'russia_q2', engines: ['google'] }
    ])
    const mod = await import('../../../src/search/rerank.js?mockC=' + Date.now())
    const out = await mod.rerankByTrust([{ url: 'https://t.io/dup' }])
    // distinct sweeps=2 (russia_q1, russia_q2), topics=1 (russia), engines=2 (brave, google)
    const trust = Math.log(2 + 1) * 2 * 1
    assert.equal(out[0].trust_score, r2(trust))
  })

  test('hit with missing engines array does not throw (engines||[] guard)', async () => {
    HITS.clear()
    HITS.set('https://t.io/noeng', [
      { sweep_label: 'solo_q1' } // no `engines` key → engines.size stays 0
    ])
    const mod = await import('../../../src/search/rerank.js?mockD=' + Date.now())
    const out = await mod.rerankByTrust([{ url: 'https://t.io/noeng' }])
    // engines=0 → trust = log(2)*0*1 = 0 → rerank = log(1) = 0
    assert.equal(out[0].trust_score, 0)
    assert.equal(out[0].rerank_score, 0)
  })

  test('final order is by rerank_score desc; position weighting favors earlier index on ties of trust', async () => {
    HITS.clear()
    // Same trust for both urls → rerank = (1/pos)*log(trust+1).
    // Position 1 (index 0) gets the bigger 1/pos factor → ranks first.
    const sameHits = [
      { sweep_label: 'a_q1', engines: ['e1', 'e2'] },
      { sweep_label: 'b_q1', engines: ['e3'] }
    ]
    HITS.set('https://t.io/first', sameHits)
    HITS.set('https://t.io/second', sameHits)
    const mod = await import('../../../src/search/rerank.js?mockE=' + Date.now())
    const out = await mod.rerankByTrust([
      { url: 'https://t.io/first' },
      { url: 'https://t.io/second' }
    ])
    assert.equal(out[0].url, 'https://t.io/first')
    assert.equal(out[1].url, 'https://t.io/second')
    assert.ok(out[0].rerank_score > out[1].rerank_score)
    // first = (1/1)*log(trust+1), second = (1/2)*log(trust+1) → first == 2*second
    assert.ok(Math.abs(out[0].rerank_score - 2 * out[1].rerank_score) < 1e-4)
  })

  test('a higher-trust result at a later position can outrank a low-trust earlier one', async () => {
    HITS.clear()
    // index 0: very low trust (1 sweep, 1 engine, 1 topic) → trust=log(2)*1*1≈0.693
    HITS.set('https://t.io/weak', [{ sweep_label: 'x_q1', engines: ['e1'] }])
    // index 1: high trust (3 sweeps across 3 topics, 4 engines) → big trust
    HITS.set('https://t.io/strong', [
      { sweep_label: 'a_q1', engines: ['e1', 'e2'] },
      { sweep_label: 'b_q1', engines: ['e3'] },
      { sweep_label: 'c_q1', engines: ['e4'] }
    ])
    const mod = await import('../../../src/search/rerank.js?mockF=' + Date.now())
    const out = await mod.rerankByTrust([
      { url: 'https://t.io/weak' },
      { url: 'https://t.io/strong' }
    ])
    // weak rerank = (1/1)*log(0.693+1) ≈ 0.527
    // strong trust = log(4)*4*3 ≈ 16.64; rerank = (1/2)*log(17.64) ≈ 1.435 → wins
    assert.equal(out[0].url, 'https://t.io/strong')
    assert.equal(out[1].url, 'https://t.io/weak')
  })
})
