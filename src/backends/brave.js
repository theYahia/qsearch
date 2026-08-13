import { SearchBackend } from './interface.js'

// Outbound pacing toward Brave. Default 0 = off (opt-in until dogfooded, same convention as
// QSEARCH_SWEEP_QUERY_TIMEOUT_MS in src/sweep/runner.js).
//
// This module is the only chokepoint: every Brave request in the repo goes through
// braveFetch — /search, /news, /llm/context, both sweep routers. Anything higher up misses
// some of them. Before this there was no outbound limiter of any kind: concurrency was the
// only brake, the sweep Semaphore is created per runSweep call (so N concurrent /sweep
// requests give N×6 slots), and /search, /news and /context sit outside it entirely.
const BRAVE_RPS = Number(process.env.QSEARCH_BRAVE_RPS) || 0
const BRAVE_TIMEOUT_MS = Number(process.env.QSEARCH_BRAVE_TIMEOUT_MS) || 10000
// 429 without a wait is a wasted call and a step deeper into the limit. Retry cheaply.
const BRAVE_429_RETRIES = Math.max(0, Number(process.env.QSEARCH_BRAVE_429_RETRIES) ?? 2)
const MAX_BACKOFF_MS = 30_000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Slot reservation, not a sleep-until-free loop: the read-and-write of _nextSlot happens
// synchronously, so concurrent callers each reserve a distinct slot instead of all waking
// at the same instant and firing together.
let _nextSlot = 0
async function pace () {
  if (BRAVE_RPS <= 0) return
  const interval = 1000 / BRAVE_RPS
  const now = Date.now()
  const slot = Math.max(now, _nextSlot)
  _nextSlot = slot + interval
  if (slot > now) await sleep(slot - now)
}

/** Test seam: drop any reserved slots so one test's pacing cannot bleed into the next. */
export function _resetPacing () { _nextSlot = 0 }

/**
 * How long to wait after a 429, from Brave's own headers.
 * Retry-After is seconds or an HTTP date; X-RateLimit-Reset is seconds until the window
 * rolls over. Falls back to exponential backoff when neither is usable.
 */
export function retryDelayMs (headers, attempt) {
  const get = k => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k])

  const retryAfter = get('retry-after')
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_BACKOFF_MS)
    const at = Date.parse(retryAfter)
    if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), MAX_BACKOFF_MS)
  }

  // Presence must be checked before parsing: Number('') is 0, which is finite and >= 0,
  // so an ABSENT header would otherwise look like "reset in 0s" and permanently shadow the
  // exponential fallback below.
  const resetRaw = get('x-ratelimit-reset')
  if (resetRaw != null && String(resetRaw).trim() !== '') {
    const reset = Number(String(resetRaw).split(',')[0])
    if (Number.isFinite(reset) && reset >= 0) return Math.min(reset * 1000 + 500, MAX_BACKOFF_MS)
  }

  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS)
}

// ⚠️ ENDPOINT ROUTING:
//   'web'         → /res/v1/web/search
//   'news'        → /res/v1/news/search
//   'llm/context' → /res/v1/llm/context  (NO /search suffix!)
export async function braveFetch (endpoint, query, params) {
  const suffix = endpoint === 'llm/context' ? '' : '/search'
  const base = process.env.BRAVE_BASE_URL || 'https://api.search.brave.com'
  const url = new URL(`${base}/res/v1/${endpoint}${suffix}`)
  url.searchParams.set('q', query)
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue
    // Repeatable params (goggles) must be appended, not joined into one comma-separated
    // value — set() with an array stringifies to "a,b" and Brave reads that as one goggle.
    if (Array.isArray(v)) { for (const item of v) if (item != null) url.searchParams.append(k, String(item)) } else { url.searchParams.set(k, String(v)) }
  }

  const start = Date.now()
  for (let attempt = 0; ; attempt++) {
    await pace()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), BRAVE_TIMEOUT_MS)
    const r = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_API_KEY
      },
      signal: ctrl.signal
    }).catch((err) => {
      clearTimeout(timer)
      if (err.name === 'AbortError') {
        const e = new Error(`Brave API timeout (${BRAVE_TIMEOUT_MS}ms)`)
        e.status = 504
        e.detail = `Request to Brave Search API timed out after ${BRAVE_TIMEOUT_MS}ms`
        throw e
      }
      throw err
    })
    clearTimeout(timer)

    if (r.status === 429 && attempt < BRAVE_429_RETRIES) {
      const wait = retryDelayMs(r.headers, attempt)
      console.warn(`[brave] 429 on ${endpoint} — waiting ${wait}ms (attempt ${attempt + 1}/${BRAVE_429_RETRIES})`)
      await sleep(wait)
      continue
    }

    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      const e = new Error(`Brave API error ${r.status}`)
      e.status = r.status
      // Brave returns 422 for BOTH a malformed parameter and a rejected token. Surface its
      // own code so the two stop looking alike — a stale key in the ambient environment
      // shadowing .env.local produces SUBSCRIPTION_TOKEN_INVALID on every single request.
      e.code = err?.error?.code || null
      e.detail = err?.error?.detail || 'Unknown Brave API error'
      throw e
    }

    const data = await r.json()
    return { data, ms: Date.now() - start }
  }
}

export class BraveBackend extends SearchBackend {
  get name () { return 'brave' }

  async search (query, opts = {}) {
    const count = opts.n_results || opts.count || 3
    const { data } = await braveFetch('web', query, {
      count,
      extra_snippets: true,
      text_decorations: false,
      freshness: opts.freshness || null,
      search_lang: opts.search_lang || null,
      country: opts.country || null,
      safesearch: opts.safesearch || null
    })
    const items = data?.web?.results || []
    return items.map(r => ({
      url: r.url,
      title: r.title,
      description: r.description || null,
      extra_snippets: r.extra_snippets || [],
      age: r.age || null,
      page_age: r.page_age || null,
      language: r.language || null,
      source: r.profile?.name || null
    }))
  }
}
