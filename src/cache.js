// qsearch memcache (Phase 1, exact-match) — SHA256(query+engines) → cached results.
// Design ref: D:/Yahia/active/qsearch/MEMCACHE_DESIGN_2026-05-07.md
// Storage: native node:sqlite (Node 22.5+, stable in 24+). No native deps.
//
// Schema simplified vs design (no compression, no checksum) — Phase 1 only,
// add when Phase 2 ships if eviction/corruption become real problems.

import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// Default per-endpoint TTL in days. news ages fast (24h), web stable for a week,
// llm/context grounding sources are quasi-stable (30d). Tunable via opts.ttlMap.
export const DEFAULT_TTL = { web: 7, news: 1, context: 30 }

// Infer endpoint from engines array. brave_sweep.py tags entries as
// 'brave_web' / 'brave_news' / 'brave_context'. qsearch self-sweeps use
// 'searxng' or 'brave' which default to 'web'.
export function inferEndpoint (engines) {
  const arr = Array.isArray(engines) ? engines : [String(engines || '')]
  for (const e of arr) {
    const s = String(e).toLowerCase()
    if (s.includes('news')) return 'news'
    if (s.includes('context')) return 'context'
  }
  return 'web'
}

export class QueryCache {
  constructor (dbPath) {
    this.dbPath = dbPath
    if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS query_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_hash TEXT NOT NULL UNIQUE,
        query_text TEXT NOT NULL,
        engines TEXT NOT NULL,
        results_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_qcache_hash ON query_cache(query_hash);
      CREATE INDEX IF NOT EXISTS idx_qcache_last_used ON query_cache(last_used);
      CREATE INDEX IF NOT EXISTS idx_qcache_created ON query_cache(created_at);
    `)
    this._stmtLookup = this.db.prepare('SELECT results_json, hit_count, created_at FROM query_cache WHERE query_hash = ?')
    this._stmtIncr = this.db.prepare('UPDATE query_cache SET hit_count = hit_count + 1, last_used = ? WHERE query_hash = ?')
    this._stmtUpsert = this.db.prepare(`
      INSERT INTO query_cache (query_hash, query_text, engines, results_json, created_at, last_used, hit_count)
      VALUES (?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(query_hash) DO UPDATE SET
        results_json = excluded.results_json,
        last_used = excluded.last_used
    `)

    // session counters (process-lifetime; reset on restart)
    this._sessionHits = 0
    this._sessionMisses = 0
  }

  static hashKey (queryText, engines) {
    const norm = String(queryText || '').toLowerCase().trim().replace(/\s+/g, ' ')
    const sortedEngines = Array.isArray(engines) ? [...engines].sort().join(',') : String(engines || '')
    return createHash('sha256').update(norm + '|' + sortedEngines).digest('hex')
  }

  /**
   * Look up cached results.
   * @param {string} queryText
   * @param {string[]} engines  — sorted array part of cache key
   * @param {object} [opts]     — { maxAgeDays?: number, ttlMap?: {web?,news?,context?,default?} }
   *                              ttlMap (per-endpoint days) overrides maxAgeDays when present.
   *                              Endpoint inferred from engines via inferEndpoint().
   * @returns {object|null}     — parsed results or null on miss/expired
   */
  lookup (queryText, engines, opts = {}) {
    const hash = QueryCache.hashKey(queryText, engines)
    const row = this._stmtLookup.get(hash)
    if (!row) {
      this._sessionMisses++
      return null
    }
    let maxAgeDays = opts.maxAgeDays
    if (!maxAgeDays && opts.ttlMap) {
      const ep = inferEndpoint(engines)
      const v = opts.ttlMap[ep]
      maxAgeDays = (v != null) ? v : opts.ttlMap.default
    }
    if (maxAgeDays) {
      const ageMs = Date.now() - row.created_at
      if (ageMs > maxAgeDays * 86400_000) {
        this._sessionMisses++
        return null
      }
    }
    this._stmtIncr.run(Date.now(), hash)
    this._sessionHits++
    try {
      return JSON.parse(row.results_json)
    } catch {
      this._sessionMisses++
      return null
    }
  }

  /**
   * Store (or refresh) cached results.
   * @param {string} queryText
   * @param {string[]} engines
   * @param {object} results — JSON-serializable payload
   */
  store (queryText, engines, results) {
    const hash = QueryCache.hashKey(queryText, engines)
    const now = Date.now()
    this._stmtUpsert.run(hash, queryText, JSON.stringify(engines || []), JSON.stringify(results), now, now)
    return hash
  }

  /** @returns {{total_entries:number,total_hits:number,total_misses:number,hit_rate:number,top_10_queries_by_hit:object[],db_size_kb:number}} */
  stats () {
    const totalRow = this.db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(hit_count), 0) AS hits FROM query_cache').get()
    const top10 = this.db.prepare('SELECT query_text, hit_count, created_at FROM query_cache ORDER BY hit_count DESC, last_used DESC LIMIT 10').all()
    let dbSizeKb = 0
    try {
      const stat = this.db.prepare("SELECT page_count * page_size AS sz FROM pragma_page_count(), pragma_page_size()").get()
      dbSizeKb = Math.round((stat?.sz || 0) / 1024)
    } catch { /* ignore */ }
    const totalLookups = this._sessionHits + this._sessionMisses
    return {
      total_entries: totalRow.c,
      total_hits: totalRow.hits, // lifetime, accumulated across all sessions
      session_hits: this._sessionHits,
      session_misses: this._sessionMisses,
      hit_rate: totalLookups > 0 ? Number((this._sessionHits / totalLookups).toFixed(4)) : 0,
      top_10_queries_by_hit: top10.map(r => ({ query: r.query_text, hits: r.hit_count, created_at: r.created_at })),
      db_size_kb: dbSizeKb
    }
  }

  /** Reset session-level hit/miss counters. */
  resetSessionCounters () {
    this._sessionHits = 0
    this._sessionMisses = 0
  }

  close () {
    try { this.db.close() } catch { /* ignore */ }
  }
}
