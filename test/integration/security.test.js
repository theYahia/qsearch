// Integration tests for the Tier 0 hardening (2026-06-23): body-size cap, sensitive-file
// rejection, correlation id, and the fail-fast that refuses to expose unauthenticated.
// Spawns the real server (mirrors test/server.test.js). Corpus services are pointed at
// dead ports — the server tolerates that (corpus unavailable), which is all we need here.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

function request (port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port, method, path, headers: { ...headers } }
    let payload = null
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body)
      opts.headers['Content-Type'] = 'application/json'
      opts.headers['Content-Length'] = Buffer.byteLength(payload)
    }
    const req = http.request(opts, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        let json = null
        try { json = JSON.parse(raw) } catch {}
        resolve({ status: res.statusCode, headers: res.headers, raw, json })
      })
    })
    req.on('error', reject)
    if (payload != null) req.write(payload)
    req.end()
  })
}

function waitForServer (port, retries = 40) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => { res.resume(); resolve() })
      req.on('error', () => {
        if (++attempts >= retries) return reject(new Error('Server did not start'))
        setTimeout(check, 200)
      })
    }
    check()
  })
}

describe('Tier 0 hardening — running server', () => {
  let proc
  const PORT = 18944

  before(async () => {
    proc = spawn('node', ['src/server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        BRAVE_API_KEY: 'test-key-12345',
        QSEARCH_MAX_BODY_BYTES: '200', // tiny cap so a normal JSON body trips 413
        CORPUS_FIRST: 'false',
        MEILISEARCH_URL: 'http://localhost:57702',
        QDRANT_URL: 'http://localhost:56334'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    proc.stdout.on('data', () => {})
    proc.stderr.on('data', () => {})
    await waitForServer(PORT)
  })

  after(() => { if (proc) proc.kill('SIGTERM') })

  test('413 when request body exceeds the cap', async () => {
    const big = 'x'.repeat(500)
    const res = await request(PORT, 'POST', '/search', { query: big })
    assert.equal(res.status, 413)
    assert.equal(res.json.error, 'payload_too_large')
  })

  test('404 for unknown route', async () => {
    const res = await request(PORT, 'GET', '/definitely-not-a-route')
    assert.equal(res.status, 404)
  })

  test('every response carries an X-Request-Id correlation header', async () => {
    const res = await request(PORT, 'GET', '/definitely-not-a-route')
    assert.ok(res.headers['x-request-id'])
  })

  test('/index refuses globs targeting sensitive files (403)', async () => {
    const res = await request(PORT, 'POST', '/index', { glob: 'D:/secrets/.env' })
    assert.equal(res.status, 403)
    assert.match(res.json.error, /refused/i)
  })
})

describe('Tier 0 hardening — fail-fast on unauthenticated exposure', () => {
  test('non-loopback bind with no auth configured exits non-zero (never fail open)', async () => {
    const code = await new Promise((resolve) => {
      const p = spawn('node', ['src/server.js'], {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: '18945',
          BRAVE_API_KEY: 'test-key-12345',
          QSEARCH_BIND: '0.0.0.0',
          MEILISEARCH_KEY: 'a-real-non-default-key', // get past the Meili-key assertion
          QSEARCH_API_KEY: '', // explicitly no auth
          QSEARCH_IP_ALLOWLIST: ''
        },
        stdio: ['ignore', 'ignore', 'ignore']
      })
      p.on('exit', (c) => resolve(c))
      // safety: if it somehow starts listening, kill and fail
      setTimeout(() => { try { p.kill('SIGKILL') } catch {} ; resolve(0) }, 8000)
    })
    assert.notEqual(code, 0)
  })
})
