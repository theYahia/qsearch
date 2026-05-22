const MAX_PARALLEL = parseInt(process.env.SWEEP_CONCURRENCY || '6')

class Semaphore {
  constructor (max) {
    this._max = max
    this._count = 0
    this._queue = []
  }

  run (fn) {
    return new Promise((resolve, reject) => {
      const entry = async () => {
        this._count++
        try { resolve(await fn()) } catch (e) { reject(e) } finally {
          this._count--
          if (this._queue.length) this._queue.shift()()
        }
      }
      if (this._count < this._max) entry()
      else this._queue.push(entry)
    })
  }
}

export const VALID_PRIORITIES = new Set(['ultra-broad', 'broad', 'focused', 'critical'])
// rd239 safety: ultra-broad serves cached corpus hits — wrong for time-sensitive topics.
const STALE_PRONE_LABEL_RE = /^(news|market|regulatory)/i
export const VALID_DOMAINS = new Set(['general', 'scholarly', 'ru'])

export function parseQueriesText (text) {
  const queries = []
  let autoIdx = 1
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let parsed = false
    for (const sep of ['|', ':']) {
      const parts = line.split(sep).map(s => s.trim())
      if (parts.length >= 2 && /^[a-zA-Z0-9_]+$/.test(parts[0]) && parts[1]) {
        const label = parts[0]
        let priority = 'broad'
        let domain = 'general'
        let queryEnd = parts.length

        // Parse trailing keyword fields right-to-left. Each trailing part is only
        // consumed if it matches a known vocabulary; otherwise it stays in the query
        // (preserves URLs, dates, etc. that may contain '|').
        const last = parts[queryEnd - 1]?.toLowerCase()
        const second = parts[queryEnd - 2]?.toLowerCase()
        if (queryEnd >= 3 && VALID_DOMAINS.has(last) && VALID_PRIORITIES.has(second)) {
          domain = last
          priority = second
          queryEnd -= 2
        } else if (queryEnd >= 3 && VALID_PRIORITIES.has(last)) {
          priority = last
          queryEnd -= 1
        } else if (queryEnd >= 3 && VALID_DOMAINS.has(last)) {
          domain = last
          queryEnd -= 1
        }
        const query = parts.slice(1, queryEnd).join(sep)
        if (!query) continue
        // rd239: don't serve stale corpus hits for time-sensitive topics — downgrade.
        if (priority === 'ultra-broad' && STALE_PRONE_LABEL_RE.test(label)) {
          console.warn(`[sweep] ultra-broad → broad for time-sensitive label "${label}" (stale corpus risk)`)
          priority = 'broad'
        }
        queries.push({ label, query, priority, domain })
        parsed = true
        break
      }
    }
    if (!parsed) {
      queries.push({ label: `q${String(autoIdx).padStart(2, '0')}`, query: line, priority: 'broad', domain: 'general' })
      autoIdx++
    }
  }
  return queries
}

export async function runSweep (queries, searchFnOrRouter, opts = {}) {
  const { count = 20, retryZeroResults = true } = opts
  const t0 = Date.now()
  const results = new Map()
  const seenUrls = new Set()
  const stats = {
    web_ok: 0, web_fail: 0, web_zero: 0, web_zero_recovered: 0, total_deduped: 0,
    by_priority: {
      'ultra-broad': { ok: 0, fail: 0, zero: 0 },
      broad: { ok: 0, fail: 0, zero: 0 },
      focused: { ok: 0, fail: 0, zero: 0 },
      critical: { ok: 0, fail: 0, zero: 0 }
    },
    by_domain: {
      general: { ok: 0, fail: 0, zero: 0 },
      scholarly: { ok: 0, fail: 0, zero: 0 },
      ru: { ok: 0, fail: 0, zero: 0 }
    }
  }

  // Router shim: if caller passes a plain (endpoint, query, params)→Promise fn (legacy),
  // wrap it so runSweep treats every priority identically. Router-style fn takes
  // (priority, domain) and returns the searchFn for that tier (Phase 2 + A routing).
  // Heuristic: a router fn has arity ≤2; a plain searchFn has arity 3.
  const router = (typeof searchFnOrRouter === 'function' && searchFnOrRouter.length <= 2)
    ? searchFnOrRouter
    : (() => searchFnOrRouter)

  const sem = new Semaphore(MAX_PARALLEL)
  const urlToFirstResult = new Map() // url -> result object reference, for engines union on dedup

  const fetchAndDedupe = async (query, searchFn) => {
    const { data } = await searchFn('web', query, { count })
    const raw = data?.web?.results || []
    const filtered = []
    for (const r of raw) {
      if (r.url && seenUrls.has(r.url)) {
        stats.total_deduped++
        const first = urlToFirstResult.get(r.url)
        if (first && Array.isArray(r.engines) && r.engines.length) {
          const merged = new Set([...(first.engines || []), ...r.engines])
          first.engines = [...merged]
        }
        continue
      }
      if (r.url) {
        seenUrls.add(r.url)
        urlToFirstResult.set(r.url, r)
      }
      filtered.push(r)
    }
    return filtered
  }

  await Promise.all(queries.map(({ label, query, priority, domain }) =>
    sem.run(async () => {
      const effectivePriority = (priority && VALID_PRIORITIES.has(priority)) ? priority : 'broad'
      const effectiveDomain = (domain && VALID_DOMAINS.has(domain)) ? domain : 'general'
      const pStats = stats.by_priority[effectivePriority]
      const dStats = stats.by_domain[effectiveDomain]
      const searchFn = router(effectivePriority, effectiveDomain)
      try {
        let filtered = await fetchAndDedupe(query, searchFn)
        if (filtered.length === 0 && retryZeroResults) {
          await new Promise(r => setTimeout(r, 600 + Math.random() * 400))
          filtered = await fetchAndDedupe(query, searchFn)
          if (filtered.length > 0) stats.web_zero_recovered++
        }
        if (filtered.length === 0) {
          results.set(label, { query, priority: effectivePriority, domain: effectiveDomain, results: [], ok: false, error: 'zero_results', reason: 'zero_results' })
          stats.web_zero++
          pStats.zero++
          dStats.zero++
          console.warn(`  [sweep] ⚠ ${label}  ${query.slice(0, 55)} — ZERO RESULTS after retry`)
          return
        }
        results.set(label, { query, priority: effectivePriority, domain: effectiveDomain, results: filtered, ok: true })
        stats.web_ok++
        pStats.ok++
        dStats.ok++
        console.log(`  [sweep] ✓ ${label}  ${query.slice(0, 55)}`)
      } catch (err) {
        results.set(label, { query, priority: effectivePriority, domain: effectiveDomain, results: [], ok: false, error: err.message })
        stats.web_fail++
        pStats.fail++
        dStats.fail++
        console.error(`  [sweep] ✗ ${label}  ${query.slice(0, 55)} — ${err.message}`)
      }
    })
  ))

  stats.duration_ms = Date.now() - t0
  return { results, stats }
}
