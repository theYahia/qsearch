const MAX_PARALLEL = parseInt(process.env.SWEEP_CONCURRENCY || '6')

// Per-query deadline (frees the semaphore slot when a backend hangs). Default 0 = off:
// a live timeout could abort legitimately-slow scholarly/critical queries, so it is
// opt-in until dogfooded. Recommended 20000-30000 when enabled. See ANALYSIS-2026-06-23.md T1.
const QUERY_TIMEOUT_MS = Number(process.env.QSEARCH_SWEEP_QUERY_TIMEOUT_MS) || 0
// Zero-result retries with exponential backoff (default 1 retry — prior behavior, but
// backoff now grows so a 429/overload isn't hit again at the same fixed 800ms).
const ZERO_RETRIES = Math.max(0, Number(process.env.QSEARCH_SWEEP_ZERO_RETRIES) || 1)
const RETRY_BASE_MS = Number(process.env.QSEARCH_SWEEP_RETRY_BASE_MS) || 800

// Reject a promise after ms (0 = no timeout). The underlying fetch is not cancelled,
// but the sweep stops awaiting it, freeing the concurrency slot for the next query.
function withTimeout (promise, ms) {
  if (!ms || ms <= 0) return promise
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(`query timeout after ${ms}ms`), { timedOut: true })), ms)
    promise.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

// Unique label allocator — prevents a bare-line auto-label (q01) or a repeated explicit
// label from silently overwriting an earlier query's result in the Map<label,result>.
function uniqueLabel (label, seen) {
  if (!seen.has(label)) { seen.add(label); return label }
  let n = 2
  while (seen.has(`${label}_${n}`)) n++
  const unique = `${label}_${n}`
  seen.add(unique)
  console.warn(`[sweep] duplicate label "${label}" → "${unique}" (would otherwise overwrite results)`)
  return unique
}

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
  const seen = new Set()
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
        queries.push({ label: uniqueLabel(label, seen), query, priority, domain })
        parsed = true
        break
      }
    }
    if (!parsed) {
      queries.push({ label: uniqueLabel(`q${String(autoIdx).padStart(2, '0')}`, seen), query: line, priority: 'broad', domain: 'general' })
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
    // context_grounding is attached by the router for critical-tier queries (Brave LLM Context).
    // Thread it out so the entry can carry it to renderMarkdown — fetchAndDedupe otherwise drops
    // everything but data.web.results.
    return { filtered, contextGrounding: data?.context_grounding || null }
  }

  await Promise.all(queries.map(({ label, query, priority, domain }) =>
    sem.run(async () => {
      const effectivePriority = (priority && VALID_PRIORITIES.has(priority)) ? priority : 'broad'
      const effectiveDomain = (domain && VALID_DOMAINS.has(domain)) ? domain : 'general'
      const pStats = stats.by_priority[effectivePriority]
      const dStats = stats.by_domain[effectiveDomain]
      const searchFn = router(effectivePriority, effectiveDomain)
      try {
        let { filtered, contextGrounding } = await withTimeout(fetchAndDedupe(query, searchFn), QUERY_TIMEOUT_MS)
        if (filtered.length === 0 && retryZeroResults) {
          for (let attempt = 1; attempt <= ZERO_RETRIES && filtered.length === 0; attempt++) {
            // Exponential backoff so a rate-limited (429) or overloaded backend isn't
            // re-hit at the same fixed delay: 800ms, 1600ms, 3200ms … + jitter.
            const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 400
            await new Promise(r => setTimeout(r, delay))
            ;({ filtered, contextGrounding } = await withTimeout(fetchAndDedupe(query, searchFn), QUERY_TIMEOUT_MS))
          }
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
        results.set(label, { query, priority: effectivePriority, domain: effectiveDomain, results: filtered, context_grounding: contextGrounding, ok: true })
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
