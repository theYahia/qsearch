// Lightweight zero-dependency structured logger (Tier 3, 2026-06-23).
//
// Adds correlation IDs + per-request access logging so a single /sweep can be traced
// across the REST server and (via the X-Request-Id header) the MCP-HTTP front. Does NOT
// replace the existing console.log calls wholesale — it sits alongside them and provides
// a structured channel for new code. JSON mode (QSEARCH_LOG_JSON=true) for log aggregators;
// human mode otherwise. Level via QSEARCH_LOG_LEVEL (debug|info|warn|error, default info).

import { randomUUID } from 'node:crypto'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN = LEVELS[(process.env.QSEARCH_LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info
const JSON_LOGS = process.env.QSEARCH_LOG_JSON === 'true'

function emit (level, msg, ctx = {}) {
  if (LEVELS[level] < MIN) return
  if (JSON_LOGS) {
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx }) + '\n')
    return
  }
  const tag = ctx.request_id ? `[${ctx.request_id}] ` : ''
  const extra = Object.entries(ctx)
    .filter(([k]) => k !== 'request_id')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  const fn = level === 'debug' ? console.log : (console[level] || console.log)
  fn(`${tag}${msg}${extra ? ' ' + extra : ''}`)
}

export const logger = {
  debug: (msg, ctx) => emit('debug', msg, ctx),
  info: (msg, ctx) => emit('info', msg, ctx),
  warn: (msg, ctx) => emit('warn', msg, ctx),
  error: (msg, ctx) => emit('error', msg, ctx)
}

// Reuse an inbound X-Request-Id (e.g. propagated from mcp-http) or mint a short one.
export function requestId (req) {
  return req.headers?.['x-request-id'] || randomUUID().slice(0, 8)
}
