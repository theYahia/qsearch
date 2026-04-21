// qsearch MCP-over-HTTP server
//
// Exposes qsearch via MCP protocol over HTTP using Streamable HTTP transport.
// Use with QVAC Workbench Custom Integration, Claude Desktop (HTTP mode),
// OpenClaw, or any MCP-over-HTTP client.
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

const PORT = Number(process.env.MCP_PORT) || 8081
const HOST = process.env.MCP_HOST || '0.0.0.0'

const transports = new Map() // sessionId -> transport

const httpServer = http.createServer(async (req, res) => {
  const reqId = Math.random().toString(36).slice(2, 8)
  const sid = req.headers['mcp-session-id'] || '-'
  console.log(`[${reqId}] ${req.method} ${req.url} sid=${sid} ua=${(req.headers['user-agent'] || '').slice(0, 40)}`)

  // CORS headers for cross-origin MCP clients.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version')
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
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

    const mcpServer = new McpServer({ name: 'qsearch', version: '0.2.2' })
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
  console.log('QVAC Workbench Custom Integration config (replace <LAN-IP> with this machine\'s LAN address):')
  console.log(JSON.stringify({
    qsearch: {
      type: 'http',
      url: `http://<LAN-IP>:${PORT}`
    }
  }, null, 2))
  console.log('')
  console.log('Note: qsearch REST server must be running on :8080 (run `npm start` in another terminal).')
})
