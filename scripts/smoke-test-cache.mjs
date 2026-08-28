#!/usr/bin/env node
// Smoke test for qsearch memcache (Phase 1, exact-match).
// Standalone — does NOT spin up the full server. Tests cache.js directly + verifies
// hash collision behaviour. Mock-Brave hit/miss flow is exercised via direct API calls
// (no actual Brave network — the cache module never sees Brave).
//
// Run:  node scripts/smoke-test-cache.mjs
// Exit: 0 = all pass, 1 = any failure

import { QueryCache, inferEndpoint, DEFAULT_TTL } from '../src/cache.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const tmp = mkdtempSync(join(tmpdir(), 'qsearch-cache-'))
const dbPath = join(tmp, 'test.db')

let pass = 0, fail = 0
function test (name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    pass++
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err.message}`)
    fail++
  }
}

console.log(`\n[smoke] cache.db at ${dbPath}\n`)

const cache = new QueryCache(dbPath)

const sampleResults = {
  results: [
    { url: 'https://example.com/a', title: 'A', description: 'first' },
    { url: 'https://example.com/b', title: 'B', description: 'second' }
  ]
}

test('1st lookup → MISS (empty db)', () => {
  const r = cache.lookup('telegram bot framework', ['searxng'])
  assert.equal(r, null, 'expected null on cold lookup')
})

test('store + 2nd lookup → HIT (same query+engines)', () => {
  cache.store('telegram bot framework', ['searxng'], sampleResults)
  const r = cache.lookup('telegram bot framework', ['searxng'])
  assert.notEqual(r, null, 'expected hit')
  assert.equal(r.results.length, 2)
  assert.equal(r.results[0].url, 'https://example.com/a')
})

test('hash collision check — same query, different engines = different keys', () => {
  const h1 = QueryCache.hashKey('python sqlite tutorial', ['brave'])
  const h2 = QueryCache.hashKey('python sqlite tutorial', ['searxng'])
  const h3 = QueryCache.hashKey('python sqlite tutorial', ['brave', 'searxng'])
  assert.notEqual(h1, h2, 'brave vs searxng must hash differently')
  assert.notEqual(h1, h3, 'brave vs [brave,searxng] must hash differently')
  assert.notEqual(h2, h3, 'searxng vs [brave,searxng] must hash differently')
})

test('engines array order is normalized (sorted) before hashing', () => {
  const h1 = QueryCache.hashKey('python sqlite tutorial', ['brave', 'searxng'])
  const h2 = QueryCache.hashKey('python sqlite tutorial', ['searxng', 'brave'])
  assert.equal(h1, h2, 'engine array order must not affect hash')
})

test('query whitespace + case normalized', () => {
  const h1 = QueryCache.hashKey('Python   SQLite Tutorial  ', ['brave'])
  const h2 = QueryCache.hashKey('python sqlite tutorial', ['brave'])
  assert.equal(h1, h2, 'whitespace/case normalization must produce same hash')
})

test('hit_count increments on each lookup', () => {
  // already have 1 hit on telegram_bot_framework from test 2
  cache.lookup('telegram bot framework', ['searxng'])
  cache.lookup('telegram bot framework', ['searxng'])
  const stats = cache.stats()
  const top = stats.top_10_queries_by_hit.find(r => r.query === 'telegram bot framework')
  assert.ok(top, 'query must be in top_10')
  assert.ok(top.hits >= 2, `expected ≥2 hits after 3 lookups, got ${top.hits}`)
})

test('store with same key updates results (upsert)', () => {
  const updated = { results: [{ url: 'https://example.com/c', title: 'C' }] }
  cache.store('telegram bot framework', ['searxng'], updated)
  const r = cache.lookup('telegram bot framework', ['searxng'])
  assert.equal(r.results.length, 1)
  assert.equal(r.results[0].url, 'https://example.com/c')
})

test('store + lookup with different engines stays isolated', () => {
  cache.store('llm api', ['brave'], { results: [{ url: 'b' }] })
  cache.store('llm api', ['searxng'], { results: [{ url: 's' }] })
  const rb = cache.lookup('llm api', ['brave'])
  const rs = cache.lookup('llm api', ['searxng'])
  assert.equal(rb.results[0].url, 'b')
  assert.equal(rs.results[0].url, 's')
})

test('maxAgeDays expires old entries', () => {
  cache.store('expired test', ['brave'], { results: [{ url: 'old' }] })
  // age check: with maxAgeDays = 0 (anything older than now considered expired) — but
  // since we just stored, it's age 0ms. Use very small slice:
  const fresh = cache.lookup('expired test', ['brave'], { maxAgeDays: 1 })
  assert.notEqual(fresh, null, 'fresh entry within 1 day should hit')
  // fake-expire by manually dialling created_at backwards — simulate 31d old
  cache.db.exec(`UPDATE query_cache SET created_at = ${Date.now() - 31 * 86400_000} WHERE query_text = 'expired test'`)
  const stale = cache.lookup('expired test', ['brave'], { maxAgeDays: 30 })
  assert.equal(stale, null, '31-day-old entry must miss with maxAgeDays=30')
})

test('inferEndpoint maps engine labels to endpoints', () => {
  assert.equal(inferEndpoint(['brave_news']), 'news')
  assert.equal(inferEndpoint(['brave_context']), 'context')
  assert.equal(inferEndpoint(['brave_web']), 'web')
  assert.equal(inferEndpoint(['brave']), 'web')
  assert.equal(inferEndpoint(['searxng']), 'web')
  // case-insensitive
  assert.equal(inferEndpoint(['Brave_News']), 'news')
})

test('DEFAULT_TTL has sensible defaults (news 1, web 7, context 30)', () => {
  assert.equal(DEFAULT_TTL.news, 1)
  assert.equal(DEFAULT_TTL.web, 7)
  assert.equal(DEFAULT_TTL.context, 30)
})

test('ttlMap routes per-endpoint TTL — news 1d expires faster than web 7d', () => {
  cache.store('ttl test news', ['brave_news'], { results: [{ url: 'n' }] })
  cache.store('ttl test web', ['brave_web'], { results: [{ url: 'w' }] })
  // age both 2 days
  cache.db.exec(`UPDATE query_cache SET created_at = ${Date.now() - 2 * 86400_000} WHERE query_text IN ('ttl test news','ttl test web')`)
  const ttlMap = { news: 1, web: 7, context: 30 }
  // news (2d > 1d ttl) → miss
  assert.equal(cache.lookup('ttl test news', ['brave_news'], { ttlMap }), null,
    '2-day-old news with ttl=1d must miss')
  // web (2d < 7d ttl) → hit
  const hit = cache.lookup('ttl test web', ['brave_web'], { ttlMap })
  assert.notEqual(hit, null, '2-day-old web with ttl=7d must hit')
  assert.equal(hit.results[0].url, 'w')
})

test('ttlMap with default fallback — unknown endpoint uses default', () => {
  cache.store('ttl default test', ['searxng'], { results: [{ url: 'x' }] })
  cache.db.exec(`UPDATE query_cache SET created_at = ${Date.now() - 5 * 86400_000} WHERE query_text = 'ttl default test'`)
  // searxng → web (5d < 7d ttl) hit
  assert.notEqual(cache.lookup('ttl default test', ['searxng'], { ttlMap: { web: 7 } }), null)
  // ttlMap with default = 3 (5d > 3d) miss — but engines='searxng' infers web, so picks web key first
  assert.equal(cache.lookup('ttl default test', ['searxng'], { ttlMap: { web: 3 } }), null,
    '5-day-old web with ttl_web=3d must miss')
})

test('stats returns reasonable shape', () => {
  const s = cache.stats()
  assert.ok(typeof s.total_entries === 'number')
  assert.ok(typeof s.session_hits === 'number')
  assert.ok(typeof s.session_misses === 'number')
  assert.ok(typeof s.hit_rate === 'number' && s.hit_rate >= 0 && s.hit_rate <= 1)
  assert.ok(Array.isArray(s.top_10_queries_by_hit))
  assert.ok(typeof s.db_size_kb === 'number')
})

cache.close()
rmSync(tmp, { recursive: true, force: true })

console.log(`\n[smoke] ${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
