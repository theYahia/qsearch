// Auth guard for non-loopback deployments (Tier 0 hardening, 2026-06-23).
//
// qsearch has no per-endpoint auth — loopback binding is the only protection on a
// local single-user dev backend. The moment QSEARCH_BIND is non-loopback (LAN/VPS/
// multi-user), every endpoint (/index filesystem glob, /sweep_context fetch, /search)
// is reachable with zero auth. This guard requires an API key OR an IP allowlist
// before serving any non-public request when bound beyond loopback.
//
// Design: loopback bind → always allowed (no behavior change for local use).
// Non-loopback → require X-API-Key (or `Authorization: Bearer`) matching
// QSEARCH_API_KEY, or a source IP present in QSEARCH_IP_ALLOWLIST. Compared in
// constant time. A startup assertion (in server.js) refuses to bind non-loopback
// with neither configured, so this guard never silently fails open.

import { timingSafeEqual } from 'node:crypto'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

export function isLoopbackBind (bind) {
  return LOOPBACK.has(bind)
}

function timingSafeEqualStr (a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  // timingSafeEqual throws on length mismatch — compare lengths first (non-secret).
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

function bearer (authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

// Best-effort source IP. Honors X-Forwarded-For only when trustProxy is set
// (behind a reverse proxy); otherwise uses the socket peer to avoid spoofing.
export function remoteIp (req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const xff = req.headers?.['x-forwarded-for']
    if (xff) return String(xff).split(',')[0].trim()
  }
  const raw = req.socket?.remoteAddress || req.connection?.remoteAddress || ''
  return raw.replace(/^::ffff:/, '') // unwrap IPv4-mapped IPv6
}

/**
 * Decide whether a request is authorized.
 * @returns {{ ok: boolean, status?: number, reason: string }}
 */
export function checkAuth (req, { bind, apiKey, ipAllowlist, trustProxy } = {}) {
  if (isLoopbackBind(bind)) return { ok: true, reason: 'loopback' }

  const ip = remoteIp(req, { trustProxy })
  if (Array.isArray(ipAllowlist) && ipAllowlist.length && ipAllowlist.includes(ip)) {
    return { ok: true, reason: 'ip_allowlist' }
  }

  const provided = req.headers?.['x-api-key'] || bearer(req.headers?.authorization)
  if (apiKey && provided && timingSafeEqualStr(provided, apiKey)) {
    return { ok: true, reason: 'api_key' }
  }

  // Misconfiguration backstop (startup assertion should prevent reaching here).
  if (!apiKey && !(Array.isArray(ipAllowlist) && ipAllowlist.length)) {
    return { ok: false, status: 401, reason: 'no_auth_configured' }
  }
  return { ok: false, status: provided ? 403 : 401, reason: provided ? 'invalid_key' : 'missing_credentials' }
}

/**
 * Express-free guard for the raw node:http dispatcher. Writes a 401/403 JSON
 * response and returns false when blocked; returns true (no write) when allowed.
 */
export function authGuard (req, res, opts) {
  const r = checkAuth(req, opts)
  if (r.ok) return true
  res.writeHead(r.status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'unauthorized', reason: r.reason }))
  return false
}

// Parse "1.2.3.4;5.6.7.8" → ['1.2.3.4','5.6.7.8'].
export function parseAllowlist (raw) {
  return String(raw || '').split(';').map(s => s.trim()).filter(Boolean)
}
