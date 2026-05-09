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

export const VALID_PRIORITIES = new Set(['broad', 'focused', 'critical'])

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
        let query, priority
        // Phase 2: optional 3rd field = priority. To preserve queries containing the
        // separator (e.g. URLs with '|'), treat last part as priority only if it's a
        // valid keyword; else fold it back into the query.
        if (parts.length >= 3 && VALID_PRIORITIES.has(parts[parts.length - 1].toLowerCase())) {
          priority = parts[parts.length - 1].toLowerCase()
          query = parts.slice(1, -1).join(sep)
        } else {
          query = parts.slice(1).join(sep)
          priority = 'broad'
        }
        queries.push({ label, query, priority })
        parsed = true
        break
      }
    }
    if (!parsed) {
      queries.push({ label: `q${String(autoIdx).padStart(2, '0')}`, query: line, priority: 'broad' })
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
      broad: { ok: 0, fail: 0, zero: 0 },
      focused: { ok: 0, fail: 0, zero: 0 },
      critical: { ok: 0, fail: 0, zero: 0 }
    }
  }

  // Router shim: if caller passes a plain (endpoint, query, params)→Promise fn (legacy),
  // wrap it so runSweep treats every priority identically. Router-style fn takes a single
  // priority string and returns the searchFn for that tier (Phase 2 priority routing).
  // Heuristic: a router fn has arity 1; a plain searchFn has arity 3.
  const router = (typeof searchFnOrRouter === 'function' && searchFnOrRouter.length === 1)
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

  await Promise.all(queries.map(({ label, query, priority }) =>
    sem.run(async () => {
      const effectivePriority = (priority && VALID_PRIORITIES.has(priority)) ? priority : 'broad'
      const pStats = stats.by_priority[effectivePriority]
      const searchFn = router(effectivePriority)
      try {
        let filtered = await fetchAndDedupe(query, searchFn)
        // Zero-result reliability: backend fetch succeeded but response carried no usable results.
        // Classic silent failure (e.g. distribution_channels_2026-04-28 → empty parsed_snippets.md).
        // Retry once before marking as zero-result fail.
        if (filtered.length === 0 && retryZeroResults) {
          await new Promise(r => setTimeout(r, 600 + Math.random() * 400))
          filtered = await fetchAndDedupe(query, searchFn)
          if (filtered.length > 0) stats.web_zero_recovered++
        }
        if (filtered.length === 0) {
          results.set(label, { query, priority: effectivePriority, results: [], ok: false, error: 'zero_results', reason: 'zero_results' })
          stats.web_zero++
          pStats.zero++
          console.warn(`  [sweep] ⚠ ${label}  ${query.slice(0, 55)} — ZERO RESULTS after retry`)
          return
        }
        results.set(label, { query, priority: effectivePriority, results: filtered, ok: true })
        stats.web_ok++
        pStats.ok++
        console.log(`  [sweep] ✓ ${label}  ${query.slice(0, 55)}`)
      } catch (err) {
        results.set(label, { query, priority: effectivePriority, results: [], ok: false, error: err.message })
        stats.web_fail++
        pStats.fail++
        console.error(`  [sweep] ✗ ${label}  ${query.slice(0, 55)} — ${err.message}`)
      }
    })
  ))

  stats.duration_ms = Date.now() - t0
  return { results, stats }
}
