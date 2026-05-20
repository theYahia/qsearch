// rd277: unit coverage for QueryCache URL-cache additions (sweep_context_cache
// table + normalisation helpers). Uses :memory: SQLite so tests are self-
// contained and never touch the on-disk cache.db.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { QueryCache } from '../../src/cache.js'

function freshCache () {
  // DatabaseSync supports ':memory:' for ephemeral test databases.
  return new QueryCache(':memory:')
}

describe('QueryCache.normalizeUrl', () => {
  test('case-insensitive scheme + host', () => {
    assert.equal(QueryCache.normalizeUrl('HTTPS://Example.COM/Page'), 'https://example.com/Page')
  })

  test('strips fragment', () => {
    assert.equal(QueryCache.normalizeUrl('https://a.com/x#section-2'), 'https://a.com/x')
  })

  test('strips trailing slash on non-root paths', () => {
    assert.equal(QueryCache.normalizeUrl('https://a.com/x/'), 'https://a.com/x')
  })

  test('preserves root slash', () => {
    assert.equal(QueryCache.normalizeUrl('https://a.com/'), 'https://a.com/')
  })

  test('preserves query string', () => {
    assert.equal(QueryCache.normalizeUrl('https://a.com/x?q=1'), 'https://a.com/x?q=1')
  })

  test('non-URL falls back to lowercase trim', () => {
    assert.equal(QueryCache.normalizeUrl('  Not A URL  '), 'not a url')
  })

  test('empty input → empty string', () => {
    assert.equal(QueryCache.normalizeUrl(''), '')
    assert.equal(QueryCache.normalizeUrl(null), '')
    assert.equal(QueryCache.normalizeUrl(undefined), '')
  })
})

describe('QueryCache.normalizeKey', () => {
  test('lowercase + trim + collapse whitespace', () => {
    assert.equal(QueryCache.normalizeKey('  Hello   World  '), 'hello world')
  })

  test('tabs and newlines collapse to single space', () => {
    assert.equal(QueryCache.normalizeKey('foo\tbar\nbaz'), 'foo bar baz')
  })

  test('empty input returns empty string', () => {
    assert.equal(QueryCache.normalizeKey(''), '')
    assert.equal(QueryCache.normalizeKey(null), '')
  })
})

describe('QueryCache.hashSweepContextKey — equivalence under normalisation', () => {
  test('case + trailing slash + fragment differences hash identically', () => {
    const a = QueryCache.hashSweepContextKey('HTTPS://Example.COM/Page/#frag', 'Hello World')
    const b = QueryCache.hashSweepContextKey('https://example.com/Page', '  hello   world  ')
    assert.equal(a, b)
  })

  test('different query strings produce different hashes', () => {
    const a = QueryCache.hashSweepContextKey('https://a.com/x', 'foo')
    const b = QueryCache.hashSweepContextKey('https://a.com/x', 'bar')
    assert.notEqual(a, b)
  })

  test('different URLs produce different hashes', () => {
    const a = QueryCache.hashSweepContextKey('https://a.com', 'q')
    const b = QueryCache.hashSweepContextKey('https://b.com', 'q')
    assert.notEqual(a, b)
  })
})

describe('QueryCache sweep_context get/set round-trip', () => {
  test('set then get returns the stored payload', () => {
    const c = freshCache()
    const payload = { title: 'foo', paragraphs: ['p1', 'p2'] }
    c.setSweepContext('https://a.com/x', 'q1', payload)
    const got = c.getSweepContext('https://a.com/x', 'q1')
    assert.deepEqual(got, payload)
  })

  test('get on missing key returns null', () => {
    const c = freshCache()
    assert.equal(c.getSweepContext('https://nope', 'q'), null)
  })

  test('normalised lookup hits the same row', () => {
    const c = freshCache()
    c.setSweepContext('https://Example.com/X/', 'Hello World', { p: 1 })
    const got = c.getSweepContext('HTTPS://EXAMPLE.COM/X#frag', '  hello   WORLD  ')
    assert.deepEqual(got, { p: 1 })
  })

  test('bust:true forces miss even when entry exists', () => {
    const c = freshCache()
    c.setSweepContext('https://a.com', 'q', { p: 1 })
    assert.deepEqual(c.getSweepContext('https://a.com', 'q'), { p: 1 })
    assert.equal(c.getSweepContext('https://a.com', 'q', { bust: true }), null)
  })

  test('ttlDays=0 always returns null (instant expiry)', () => {
    const c = freshCache()
    c.setSweepContext('https://a.com', 'q', { p: 1 })
    assert.equal(c.getSweepContext('https://a.com', 'q', { ttlDays: 0 }), null)
  })

  test('overwriting same key updates payload', () => {
    const c = freshCache()
    c.setSweepContext('https://a.com', 'q', { v: 1 })
    c.setSweepContext('https://a.com', 'q', { v: 2 })
    assert.deepEqual(c.getSweepContext('https://a.com', 'q'), { v: 2 })
  })
})

describe('QueryCache sweep_context TTL expiry', () => {
  test('entry with manually backdated created_at past TTL → null', () => {
    const c = freshCache()
    c.setSweepContext('https://a.com', 'q', { p: 1 })
    // Backdate by 8 days via direct SQL — simulates an old entry without
    // pulling in sinon or fake timers.
    const eightDaysAgo = Date.now() - 8 * 86400_000
    c.db.prepare('UPDATE sweep_context_cache SET created_at = ?').run(eightDaysAgo)
    assert.equal(c.getSweepContext('https://a.com', 'q', { ttlDays: 7 }), null)
  })

  test('entry within TTL is returned', () => {
    const c = freshCache()
    c.setSweepContext('https://a.com', 'q', { p: 1 })
    const threeDaysAgo = Date.now() - 3 * 86400_000
    c.db.prepare('UPDATE sweep_context_cache SET created_at = ?').run(threeDaysAgo)
    assert.deepEqual(c.getSweepContext('https://a.com', 'q', { ttlDays: 7 }), { p: 1 })
  })
})

describe('QueryCache sweep_context hit counter', () => {
  test('hit_count increments per successful lookup', () => {
    const c = freshCache()
    c.setSweepContext('https://a.com', 'q', { p: 1 })
    c.getSweepContext('https://a.com', 'q')
    c.getSweepContext('https://a.com', 'q')
    c.getSweepContext('https://a.com', 'q')
    const row = c.db.prepare('SELECT hit_count FROM sweep_context_cache').get()
    assert.equal(row.hit_count, 3)
  })

  test('hit_count does NOT increment on TTL miss', () => {
    const c = freshCache()
    c.setSweepContext('https://a.com', 'q', { p: 1 })
    c.getSweepContext('https://a.com', 'q', { ttlDays: 0 })
    c.getSweepContext('https://a.com', 'q', { ttlDays: 0 })
    const row = c.db.prepare('SELECT hit_count FROM sweep_context_cache').get()
    assert.equal(row.hit_count, 0)
  })
})
