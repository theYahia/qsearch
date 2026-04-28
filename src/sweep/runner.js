const MAX_PARALLEL = 6

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
  const { count = 20 } = opts
  const t0 = Date.now()
  const results = new Map()
  const seenUrls = new Set()
  const stats = { web_ok: 0, web_fail: 0, total_deduped: 0 }

  const sem = new Semaphore(MAX_PARALLEL)
  const urlToFirstResult = new Map() // url -> result object reference, for engines union on dedup
  await Promise.all(queries.map(({ label, query }) =>
    sem.run(async () => {
      try {
        const { data } = await searchFn('web', query, { count })
        const raw = data?.web?.results || []
        const filtered = []
        for (const r of raw) {
          if (r.url && seenUrls.has(r.url)) {
            stats.total_deduped++
            // Merge engines union into the first occurrence so trust signal aggregates across queries
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
