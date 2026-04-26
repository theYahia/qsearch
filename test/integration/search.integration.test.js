import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')

const MEILI_URL = process.env.MEILISEARCH_URL
const QDRANT_URL = process.env.QDRANT_URL
const skip = !MEILI_URL || !QDRANT_URL

describe('Search integration with corpus', { skip: skip ? 'Docker services not available' : false }, () => {
  let mockBrave, bravePort, server, serverPort

  before(async () => {
    // Start mock Brave
    mockBrave = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ web: { results: [{ url: 'https://brave.example.com', title: 'Brave Result', description: 'From Brave', extra_snippets: [], page_age: null, age: null, language: 'en', profile: null }] } }))
    })
    await new Promise(r => mockBrave.listen(0, r))
    bravePort = mockBrave.address().port

    // Start server
    await new Promise((resolve, reject) => {
      server = spawn(process.execPath, [join(ROOT, 'src/server.js')], {
        env: { ...process.env, PORT: '0', BRAVE_API_KEY: 'test', BRAVE_BASE_URL: `http://localhost:${bravePort}`, MEILISEARCH_URL, QDRANT_URL, CORPUS_FIRST: 'true' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      server.stdout.on('data', (d) => {
        const m = d.toString().match(/listening on http:\/\/localhost:(\d+)/)
        if (m) { serverPort = Number(m[1]); resolve() }
      })
      server.on('error', reject)
      setTimeout(() => reject(new Error('Server start timeout')), 10000)
    })
  })

  after(() => { server?.kill(); mockBrave?.close() })

  test('/health shows corpus status', async () => {
    const res = await fetch(`http://localhost:${serverPort}/health`)
    const body = await res.json()
    assert.strictEqual(res.status, 200)
    assert.ok(body.corpus)
    assert.ok(['ok', 'unavailable', 'degraded'].includes(body.corpus.meilisearch))
  })
})
