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

export function parseQueriesText (text) {
  const queries = []
  let autoIdx = 1
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let parsed = false
    for (const sep of ['|', ':']) {
      const idx = line.indexOf(sep)
      if (idx > 0) {
        const label = line.slice(0, idx).trim()
        const query = line.slice(idx + 1).trim()
        if (/^[a-zA-Z0-9_]+$/.test(label) && query) {
          queries.push({ label, query })
          parsed = true
          break
        }
      }
    }
    if (!parsed) {
      queries.push({ label: `q${String(autoIdx).padStart(2, '0')}`, query: line })
      autoIdx++
    }
  }
  return queries
}

export async function runSweep (queries, searchFn, opts = {}) {
  const { count = 20, retryZeroResults = true } = opts
  const t0 = Date.now()
  const results = new Map()
  const seenUrls = new Set()
  const stats = { web_ok: 0, web_fail: 0, web_zero: 0, web_zero_recovered: 0, total_deduped: 0 }

  const sem = new Semaphore(MAX_PARALLEL)
  const urlToFirstResult = new Map() // url -> result object reference, for engines union on dedup

  const fetchAndDedupe = async (query) => {
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

  await Promise.all(queries.map(({ label, query }) =>
    sem.run(async () => {
      try {
        let filtered = await fetchAndDedupe(query)
        // Zero-result reliability: backend fetch succeeded but response carried no usable results.
        // Classic silent failure (e.g. distribution_channels_2026-04-28 → empty parsed_snippets.md).
        // Retry once before marking as zero-result fail.
        if (filtered.length === 0 && retryZeroResults) {
          await new Promise(r => setTimeout(r, 600 + Math.random() * 400))
          filtered = await fetchAndDedupe(query)
          if (filtered.length > 0) stats.web_zero_recovered++
        }
        if (filtered.length === 0) {
          results.set(label, { query, results: [], ok: false, error: 'zero_results', reason: 'zero_results' })
          stats.web_zero++
          console.warn(`  [sweep] ⚠ ${label}  ${query.slice(0, 55)} — ZERO RESULTS after retry`)
          return
        }
        results.set(label, { query, results: filtered, ok: true })
        stats.web_ok++
        console.log(`  [sweep] ✓ ${label}  ${query.slice(0, 55)}`)
      } catch (err) {
        results.set(label, { query, results: [], ok: false, error: err.message })
        stats.web_fail++
        console.error(`  [sweep] ✗ ${label}  ${query.slice(0, 55)} — ${err.message}`)
      }
    })
  ))

  stats.duration_ms = Date.now() - t0
  return { results, stats }
}
