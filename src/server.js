// qsearch — Day 2 skeleton: POST /search → raw Brave Search API JSON.
// Node runtime for now; Bare port lands Day 3 with @qvac/sdk.

import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2].trim()
  }
}

const PORT = Number(process.env.PORT) || 8080
const BRAVE_KEY = process.env.BRAVE_API_KEY
if (!BRAVE_KEY) {
  console.error('Missing BRAVE_API_KEY — put it in .env.local')
  process.exit(1)
}

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleSearch (req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return
  }
  const query = (body.query || '').trim()
  if (!query) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'query is required' }))
    return
  }
  const count = Math.min(Math.max(Number(body.n_results) || 5, 1), 20)
  const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}`
  const started = Date.now()
  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': BRAVE_KEY
    }
  })
  const raw = await r.json()
  res.writeHead(r.status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    query,
    upstream_status: r.status,
    took_ms: Date.now() - started,
    raw
  }, null, 2))
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/search') {
    handleSearch(req, res).catch((err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'brave fetch failed', detail: String(err) }))
    })
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, () => {
  console.log(`qsearch skeleton listening on http://localhost:${PORT}`)
  console.log('POST /search { "query": "..." }')
})
