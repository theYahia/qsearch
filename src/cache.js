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

// Phase 5: per-call cost estimates (USD). Tunable via env (QSEARCH_COST_BRAVE_WEB etc.).
// Used by recordSprintMetric to compute realised vs hypothetical-baseline cost.
export const COST_PER_CALL = {
  cache_hit: 0,
  searxng: 0,
  qsearch_local: 0,
  brave_web: Number(process.env.QSEARCH_COST_BRAVE_WEB) || 0.005,
  brave_context: Number(process.env.QSEARCH_COST_BRAVE_CTX) || 0.01,
  brave_news: Number(process.env.QSEARCH_COST_BRAVE_NEWS) || 0.005
}

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

      -- Phase 5: per-call sprint metrics for economy reports.
      -- Each row = one sweep/sweep_context invocation. Aggregated by /economy_report.
      CREATE TABLE IF NOT EXISTS sprint_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sprint_id TEXT,
        topic TEXT,
        timestamp INTEGER NOT NULL,
        endpoint TEXT NOT NULL,
        priority TEXT,
        backend TEXT NOT NULL,
        queries INTEGER NOT NULL,
        cost_usd REAL NOT NULL DEFAULT 0,
        cache_hits INTEGER DEFAULT 0,
        cache_misses INTEGER DEFAULT 0,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sm_sprint ON sprint_metrics(sprint_id);
      CREATE INDEX IF NOT EXISTS idx_sm_ts ON sprint_metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sm_topic ON sprint_metrics(topic);
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

  // ── Phase 5: economy logger ────────────────────────────────────

  /**
   * Record one sweep/sweep_context invocation. Cost computed from COST_PER_CALL[backend]
   * × (queries - cacheHits). Cache hits cost $0.
   * @param {{sprintId?,topic?,endpoint:string,priority?,backend:string,queries:number,cacheHits?:number,cacheMisses?:number,durationMs?:number}} m
   * @returns {number} row id
   */
  recordSprintMetric (m) {
    const { sprintId = null, topic = null, endpoint, priority = null, backend, queries,
      cacheHits = 0, cacheMisses = 0, durationMs = null } = m
    const billable = Math.max(0, (queries || 0) - (cacheHits || 0))
    const cost = (COST_PER_CALL[backend] != null ? COST_PER_CALL[backend] : 0) * billable
    const stmt = this.db.prepare(`
      INSERT INTO sprint_metrics (sprint_id, topic, timestamp, endpoint, priority, backend, queries, cost_usd, cache_hits, cache_misses, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const r = stmt.run(sprintId, topic, Date.now(), endpoint, priority, backend, queries || 0, cost, cacheHits, cacheMisses, durationMs)
    return Number(r.lastInsertRowid)
  }

  /**
   * Aggregate sprint_metrics into a markdown-/json-renderable report.
   * Filters: from/to (epoch ms), sprintId, topic.
   */
  economyReport ({ from = null, to = null, sprintId = null, topic = null } = {}) {
    const where = []
    const params = []
    if (from) { where.push('timestamp >= ?'); params.push(Number(from)) }
    if (to) { where.push('timestamp <= ?'); params.push(Number(to)) }
    if (sprintId) { where.push('sprint_id = ?'); params.push(sprintId) }
    if (topic) { where.push('topic = ?'); params.push(topic) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const total = this.db.prepare(`
      SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(queries), 0) AS total_queries,
        COALESCE(SUM(cost_usd), 0) AS total_cost,
        COALESCE(SUM(cache_hits), 0) AS total_hits,
        COALESCE(SUM(cache_misses), 0) AS total_misses
      FROM sprint_metrics ${whereSql}
    `).get(...params)

    const byBackend = this.db.prepare(`
      SELECT backend, COUNT(*) AS calls, SUM(queries) AS queries, SUM(cost_usd) AS cost
      FROM sprint_metrics ${whereSql}
      GROUP BY backend ORDER BY cost DESC
    `).all(...params)

    const byPriority = this.db.prepare(`
      SELECT COALESCE(priority, '(none)') AS priority, COUNT(*) AS calls, SUM(queries) AS queries
      FROM sprint_metrics ${whereSql}
      GROUP BY priority
    `).all(...params)

    // Hypothetical baseline: every query через Brave web + 10% через Brave Context.
    // Tunable via env if user's mix differs.
    const baselineCtxFrac = Number(process.env.QSEARCH_BASELINE_CTX_FRAC) || 0.1
    const baselineCost = (total.total_queries || 0) *
      ((COST_PER_CALL.brave_web || 0) + baselineCtxFrac * (COST_PER_CALL.brave_context || 0))
    const savings = baselineCost - total.total_cost
    const savingsPct = baselineCost > 0 ? (savings / baselineCost) : 0

    return {
      period: { from, to },
      filter: { sprintId, topic },
      total,
      by_backend: byBackend,
      by_priority: byPriority,
      baseline_cost_all_brave: baselineCost,
      actual_cost: total.total_cost,
      savings_usd: savings,
      savings_pct: Number(savingsPct.toFixed(4))
    }
  }

  close () {
    try { this.db.close() } catch { /* ignore */ }
  }
}
