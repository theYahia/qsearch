// qsearch MCP-over-HTTP server
//
// Exposes qsearch via MCP protocol over HTTP using Streamable HTTP transport.
// Use with Claude Code, Claude Desktop (HTTP mode), OpenClaw, or any MCP-over-HTTP client.
//
// Architecture:
//   [ MCP client ] --HTTP MCP--> [ this server :8081 ] --HTTP REST--> [ qsearch server :8080 ]
//
// The qsearch REST server (src/server.js) must already be running on :8080.
// Start both with: `npm start` (REST) then `npm run start:mcp` (MCP-HTTP).

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { qsearchTool } from './mcp.js'
import { authGuard, isLoopbackBind, parseAllowlist } from './middleware/auth.js'

const PORT = Number(process.env.MCP_PORT) || 8081
const HOST = process.env.MCP_HOST || '127.0.0.1'
// This server proxies into the full REST surface (/sweep_context, /index, /search), so it MUST carry
// the same Tier-0 controls as server.js — it previously had none (CORS *, no auth, no body cap).
const API_KEY = process.env.QSEARCH_API_KEY || ''
const IP_ALLOWLIST = parseAllowlist(process.env.QSEARCH_IP_ALLOWLIST)
const TRUST_PROXY = process.env.QSEARCH_TRUST_PROXY === 'true'
const MAX_BODY_BYTES = Number(process.env.QSEARCH_MAX_BODY_BYTES) || 10 * 1024 * 1024
const MAX_SESSIONS = Number(process.env.QSEARCH_MCP_MAX_SESSIONS) || 256
const CORS_ORIGIN = process.env.QSEARCH_MCP_ALLOWED_ORIGIN || '' // empty → no CORS header (MCP clients aren't browsers)
const AUTH_OPTS = { bind: HOST, apiKey: API_KEY, ipAllowlist: IP_ALLOWLIST, trustProxy: TRUST_PROXY }

// Fail-fast (mirrors server.js): never silently expose the REST surface on a non-loopback bind with no auth.
if (!isLoopbackBind(HOST) && !API_KEY && IP_ALLOWLIST.length === 0) {
  console.error(`[mcp-http] REFUSING to bind non-loopback (${HOST}) with no auth. Set QSEARCH_API_KEY or QSEARCH_IP_ALLOWLIST, or bind 127.0.0.1.`)
  process.exit(1)
}

const transports = new Map() // sessionId -> transport

const httpServer = http.createServer(async (req, res) => {
  const reqId = Math.random().toString(36).slice(2, 8)
  const sid = req.headers['mcp-session-id'] || '-'
  console.log(`[${reqId}] ${req.method} ${req.url} sid=${sid} ua=${(req.headers['user-agent'] || '').slice(0, 40)}`)

  // CORS only when an explicit origin is allowlisted (QSEARCH_MCP_ALLOWED_ORIGIN). Default: none —
  // MCP-over-HTTP clients (Claude Code/Desktop, OpenClaw) are not browsers; reflecting '*' alongside
  // Authorization let any web page drive this server from a victim's browser.
  if (CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version')
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')
    res.setHeader('Vary', 'Origin')
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  // Auth: loopback → allowed (local dev, no behavior change); non-loopback → require API key /
  // allowlisted IP. Same guard as the REST server (single source of truth).
  if (!authGuard(req, res, AUTH_OPTS)) return

  // Body cap up front (mirrors the REST server's MAX_BODY_BYTES).
  if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) {
    res.writeHead(413, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `request body exceeds ${MAX_BODY_BYTES} bytes` }))
    return
  }

  // Log POST body (request method/params) so we see what Workbench is calling.
  if (req.method === 'POST') {
    const chunks = []
    const origEmit = req.emit.bind(req)
    req.emit = function (event, ...args) {
      if (event === 'data') chunks.push(args[0])
      if (event === 'end') {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          const parsed = JSON.parse(body)
          console.log(`[${reqId}] body method=${parsed.method || '-'} id=${parsed.id || '-'}`)
        } catch {}
      }
      return origEmit(event, ...args)
    }
  }

  const sessionId = req.headers['mcp-session-id']
  let transport = sessionId ? transports.get(sessionId) : null

  if (!transport) {
    // Bound the session map — a client opening sessions and never closing them would otherwise grow
    // it without limit (each holds a live McpServer). Reject new sessions past the cap.
    if (transports.size >= MAX_SESSIONS) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'too many active MCP sessions; retry shortly' }))
      return
    }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newId) => {
        transports.set(newId, transport)
      }
    })

    transport.onclose = () => {
      const id = transport.sessionId
      if (id) transports.delete(id)
    }

    const mcpServer = new McpServer({ name: 'qsearch', version: '0.4.0' })
    qsearchTool(mcpServer)
    await mcpServer.connect(transport)
  }

  try {
    await transport.handleRequest(req, res)
  } catch (err) {
    console.error('MCP request error:', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }
})

httpServer.listen(PORT, HOST, () => {
  console.log(`qsearch MCP-over-HTTP listening on http://${HOST}:${PORT}`)
  console.log('')
  console.log('[mcp-http] MCP HTTP server config (Claude Code / Claude Desktop / any MCP client):')
  console.log(JSON.stringify({
    qsearch: {
      type: 'http',
      url: `http://<LAN-IP>:${PORT}`
    }
  }, null, 2))
  console.log('')
  console.log('Note: qsearch REST server must be running on :8080 (run `npm start` in another terminal).')
})
