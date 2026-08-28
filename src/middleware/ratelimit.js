// Per-IP, per-route fixed-window rate limiter (Tier 0 hardening, 2026-06-23).
//
// Without this, /sweep_context (20 external fetches/req), /index (filesystem glob),
// and /search (paid backend calls) accept unbounded requests — a DoS vector once the
// service is reachable beyond loopback. In-memory, zero-dependency token counting per
// (ip, route) with a fixed window. Limits are per-route; 0/undefined = unlimited.
//
// Defaults are sized for the documented attack surface, not for blocking a local
// research sprint (a sweep posts many queries in ONE request, so /sweep at 30/min is
// per-request, not per-query). Tune via QSEARCH_RATE_LIMITS.

export const DEFAULT_LIMITS = {
  '/index': 10,
  '/ingest/brave': 10,
  '/sweep_context': 20,
  '/sweep': 30,
  '/cached_sweep': 30,
  '/search': 100,
  '/academic_search': 60,
  // Writes ledger rows to SQLite. One sweep reports once, so 60/min is far above real use;
  // the cap only exists so an exposed instance can't be made to grow the DB unbounded.
  // Backfill sends its whole history as a single batched request, so it is unaffected.
  '/sprint_metric': 60
}

// Parse "/index=10,/search=100" → { '/index': 10, '/search': 100 }.
export function parseLimits (raw) {
  const out = {}
  for (const pair of String(raw || '').split(',')) {
    const [k, v] = pair.split('=').map(s => s.trim())
    const n = Number(v)
    if (k && Number.isFinite(n) && n >= 0) out[k] = n
  }
  return out
}

export function createRateLimiter ({ windowMs = 60_000, limits = DEFAULT_LIMITS } = {}) {
  const buckets = new Map() // `${ip}:${route}` -> { count, resetAt }

  // Opportunistic prune so the Map doesn't grow unbounded under churny IPs.
  function prune (now) {
    if (buckets.size < 10_000) return
    for (const [key, b] of buckets) if (now >= b.resetAt) buckets.delete(key)
  }

  function check (ip, route, now = Date.now()) {
    const limit = limits[route]
    if (!limit) return { ok: true } // unlimited route
    prune(now)
    const key = `${ip}:${route}`
    let b = buckets.get(key)
    if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b) }
    b.count++
    if (b.count > limit) {
      return { ok: false, limit, retryAfterMs: Math.max(0, b.resetAt - now), resetAt: b.resetAt }
    }
    return { ok: true, limit, remaining: limit - b.count, resetAt: b.resetAt }
  }

  return { check, _buckets: buckets }
}

/**
 * Guard for the raw node:http dispatcher. Writes a 429 + Retry-After when the
 * (ip, route) bucket is exhausted and returns false; returns true otherwise.
 */
export function rateLimitGuard (limiter, ip, route, res, now = Date.now()) {
  const r = limiter.check(ip, route, now)
  if (r.ok) {
    if (r.limit) {
      res.setHeader('X-RateLimit-Limit', String(r.limit))
      res.setHeader('X-RateLimit-Remaining', String(r.remaining))
    }
    return true
  }
  const retryAfterSec = Math.ceil(r.retryAfterMs / 1000)
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': String(retryAfterSec),
    'X-RateLimit-Limit': String(r.limit)
  })
  res.end(JSON.stringify({ error: 'rate_limited', route, limit: r.limit, retry_after_s: retryAfterSec }))
  return false
}
