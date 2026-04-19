import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── Mock Brave API ──────────────────────────────────────────────────

const MOCK_WEB_RESPONSE = {
  web: {
    results: [
      {
        url: 'https://example.com/result1',
        title: 'Test Result One',
        description: 'First test result description.',
        page_age: '2026-04-10T12:00:00',
        age: '1 week ago',
        language: 'en',
        profile: { name: 'Example' },
        extra_snippets: ['Extra snippet one.']
      },
      {
        url: 'https://example.com/result2',
        title: 'Test Result Two',
        description: 'Second test result description.',
        page_age: null,
        age: null,
        language: 'en',
        profile: { name: 'Example2' },
        extra_snippets: []
      },
      {
        url: 'https://example.com/result3',
        title: 'Test Result Three',
        description: 'Third test result.',
        page_age: null,
        age: null,
        language: 'en',
        profile: null,
        extra_snippets: []
      }
    ]
  }
}

const MOCK_NEWS_RESPONSE = {
  results: [
    {
      url: 'https://news.example.com/1',
      title: 'Breaking News',
      description: 'Something happened.',
      page_age: '2026-04-19T08:00:00',
      age: '2 hours ago',
      language: 'en',
      profile: { name: 'NewsOrg' },
      extra_snippets: []
    }
  ]
}

const MOCK_CONTEXT_RESPONSE = {
  grounding: {
    generic: [
      {
        url: 'https://docs.example.com',
        title: 'Documentation',
        snippets: [
          'This is a long snippet with more than fifty characters of content for testing purposes and validation.',
          'Short',
          'Another long snippet that passes the fifty character filter for testing the context endpoint properly.'
        ]
      }
    ]
  }
}

function createMockBrave () {
  let requestLog = []
  const server = http.createServer((req, res) => {
    requestLog.push({ method: req.method, url: req.url })

    if (req.url.includes('/res/v1/web/search')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(MOCK_WEB_RESPONSE))
    } else if (req.url.includes('/res/v1/news/search')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(MOCK_NEWS_RESPONSE))
    } else if (req.url.includes('/res/v1/llm/context')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(MOCK_CONTEXT_RESPONSE))
    } else if (req.url.includes('/timeout')) {
      // Don't respond — simulate timeout
    } else {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { detail: 'Rate limited' } }))
    }
  })

  return { server, getLog: () => requestLog, clearLog: () => { requestLog = [] } }
}

// ── Helpers ─────────────────────────────────────────────────────────

function request (port, method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port, method, path, headers: {} }
    if (body) {
      const payload = JSON.stringify(body)
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
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function waitForServer (port, retries = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => resolve())
      })
      req.on('error', () => {
        if (++attempts >= retries) return reject(new Error('Server did not start'))
        setTimeout(check, 200)
      })
    }
    check()
  })
}

// ── Test suite ──────────────────────────────────────────────────────

describe('qsearch server', () => {
  let mockBrave
  let mockBravePort
  let serverProc
  const QSEARCH_PORT = 18932

  before(async () => {
    const mock = createMockBrave()
    mockBrave = mock
    await new Promise((resolve) => {
      mock.server.listen(0, '127.0.0.1', () => {
        mockBravePort = mock.server.address().port
        resolve()
      })
    })

    serverProc = spawn('node', ['src/server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(QSEARCH_PORT),
        BRAVE_API_KEY: 'test-key-12345',
        BRAVE_BASE_URL: `http://127.0.0.1:${mockBravePort}`,
        NODE_ENV: 'test'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    serverProc.stderr.on('data', () => {})
    serverProc.stdout.on('data', () => {})

    await waitForServer(QSEARCH_PORT)
  })

  after(async () => {
    if (serverProc) serverProc.kill('SIGTERM')
    if (mockBrave) await new Promise(r => mockBrave.server.close(r))
  })

  // ── GET / (landing page) ──

  test('GET / returns HTML landing page', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/')
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type'].includes('text/html'))
    assert.ok(res.raw.includes('<title>'))
    assert.ok(res.raw.includes('qsearch'))
  })

  test('GET /index.html also returns landing page', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/index.html')
    assert.equal(res.status, 200)
    assert.ok(res.raw.includes('qsearch'))
  })

  // ── GET /health ──

  test('GET /health returns status ok', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/health')
    assert.equal(res.status, 200)
    assert.equal(res.json.status, 'ok')
    assert.equal(res.json.version, '0.2.2')
    assert.equal(typeof res.json.qvac_available, 'boolean')
    assert.equal(typeof res.json.model_loaded, 'boolean')
  })

  // ── GET /skill.md & /docs ──

  test('GET /skill.md returns API docs', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/skill.md')
    assert.equal(res.status, 200)
    assert.ok(res.headers['content-type'].includes('text/plain'))
    assert.ok(res.raw.includes('POST /search'))
  })

  test('GET /docs returns same API docs', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/docs')
    assert.equal(res.status, 200)
    assert.ok(res.raw.includes('POST /search'))
  })

  // ── POST /search ──

  test('POST /search returns results', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', { query: 'test query', n_results: 3 })
    assert.equal(res.status, 200)
    assert.equal(res.json.query, 'test query')
    assert.equal(res.json.brave_endpoint, 'web')
    assert.equal(res.json.total_results, 3)
    assert.ok(Array.isArray(res.json.results))
    assert.equal(res.json.results.length, 3)
    assert.ok(typeof res.json.brave_ms, 'number')
    assert.ok(typeof res.json.total_clean_ms, 'number')
  })

  test('POST /search result items have correct shape', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', { query: 'test' })
    const item = res.json.results[0]
    assert.equal(item.url, 'https://example.com/result1')
    assert.equal(item.title, 'Test Result One')
    assert.equal(item.description, 'First test result description.')
    assert.equal(item.source, 'Example')
    assert.equal(item.language, 'en')
    assert.deepEqual(item.extra_snippets, ['Extra snippet one.'])
    assert.ok('cleaned_markdown' in item)
    assert.ok('clean_ms' in item)
  })

  test('POST /search with n_results=1 returns 1 result', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', { query: 'test', n_results: 1 })
    assert.equal(res.json.total_results, 1)
    assert.equal(res.json.results.length, 1)
  })

  test('POST /search requires query', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', {})
    assert.equal(res.status, 400)
    assert.equal(res.json.error, 'query is required')
  })

  test('POST /search rejects empty query', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', { query: '   ' })
    assert.equal(res.status, 400)
    assert.equal(res.json.error, 'query is required')
  })

  test('POST /search rejects invalid JSON', async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: QSEARCH_PORT, method: 'POST', path: '/search',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 11 }
      }, (r) => {
        const chunks = []
        r.on('data', c => chunks.push(c))
        r.on('end', () => resolve({ status: r.statusCode, json: JSON.parse(Buffer.concat(chunks).toString()) }))
      })
      req.on('error', reject)
      req.write('not-json!!!')
      req.end()
    })
    assert.equal(res.status, 400)
    assert.equal(res.json.error, 'invalid JSON body')
  })

  test('POST /search n_results clamped to 20', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', { query: 'test', n_results: 100 })
    assert.equal(res.status, 200)
    // Server asks Brave for max 20 — mock returns 3, so we get 3
    assert.ok(res.json.total_results <= 20)
  })

  test('POST /search passes optional params', async () => {
    mockBrave.clearLog()
    await request(QSEARCH_PORT, 'POST', '/search', {
      query: 'test', freshness: 'pd', search_lang: 'de', country: 'de', safesearch: 'strict'
    })
    const braveReq = mockBrave.getLog().find(r => r.url.includes('/web/search'))
    assert.ok(braveReq, 'Brave was called')
    assert.ok(braveReq.url.includes('freshness=pd'))
    assert.ok(braveReq.url.includes('search_lang=de'))
    assert.ok(braveReq.url.includes('country=de'))
    assert.ok(braveReq.url.includes('safesearch=strict'))
  })

  // ── GET /search?q= ──

  test('GET /search?q=test returns results', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/search?q=test&n=2')
    assert.equal(res.status, 200)
    assert.equal(res.json.query, 'test')
    assert.equal(res.json.total_results, 2)
  })

  test('GET /search?q= with empty query returns 400', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/search?q=&n=3')
    assert.equal(res.status, 400)
    assert.equal(res.json.error, 'query is required')
  })

  test('GET /search?q= supports n_results alias', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/search?q=test&n_results=1')
    assert.equal(res.status, 200)
    assert.equal(res.json.total_results, 1)
  })

  // ── POST /news ──

  test('POST /news returns news results', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/news', { query: 'test news', n_results: 5 })
    assert.equal(res.status, 200)
    assert.equal(res.json.query, 'test news')
    assert.equal(res.json.type, 'news')
    assert.equal(res.json.brave_endpoint, 'news')
    assert.ok(Array.isArray(res.json.results))
    assert.equal(res.json.results[0].title, 'Breaking News')
  })

  test('POST /news requires query', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/news', {})
    assert.equal(res.status, 400)
  })

  test('POST /news defaults freshness to pw', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/news', { query: 'test' })
    assert.equal(res.json.freshness, 'pw')
  })

  // ── POST /context ──

  test('POST /context returns context results', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/context', { query: 'test context' })
    assert.equal(res.status, 200)
    assert.equal(res.json.query, 'test context')
    assert.equal(res.json.type, 'context')
    assert.equal(res.json.brave_endpoint, 'llm/context')
    assert.ok(Array.isArray(res.json.results))
  })

  test('POST /context result has snippet_count', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/context', { query: 'test' })
    const item = res.json.results[0]
    assert.equal(item.url, 'https://docs.example.com')
    assert.equal(item.snippet_count, 3)
    assert.ok(item.cleaned_markdown)
  })

  test('POST /context filters short snippets', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/context', { query: 'test' })
    const item = res.json.results[0]
    // "Short" snippet (5 chars) should be filtered out, leaving 2 long ones
    assert.ok(!item.cleaned_markdown.includes('Short'))
  })

  test('POST /context requires query', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/context', {})
    assert.equal(res.status, 400)
  })

  // ── 404 ──

  test('Unknown route returns 404', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/nonexistent')
    assert.equal(res.status, 404)
    assert.equal(res.json.error, 'not found')
  })

  test('Wrong method returns 404', async () => {
    const res = await request(QSEARCH_PORT, 'PUT', '/search')
    assert.equal(res.status, 404)
  })

  // ── QVAC graceful degradation ──

  test('model field is null when QVAC unavailable', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', { query: 'test' })
    assert.equal(res.json.model, null)
  })

  test('cleaned_markdown is null when QVAC unavailable', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', { query: 'test' })
    for (const item of res.json.results) {
      assert.equal(item.cleaned_markdown, null)
    }
  })

  test('health reports qvac_available false', async () => {
    const res = await request(QSEARCH_PORT, 'GET', '/health')
    assert.equal(res.json.qvac_available, false)
  })

  // ── Response shape consistency ──

  test('search response has all required fields', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', { query: 'test' })
    const required = ['query', 'brave_endpoint', 'freshness', 'total_results', 'model', 'brave_ms', 'total_clean_ms', 'results']
    for (const field of required) {
      assert.ok(field in res.json, `missing field: ${field}`)
    }
  })

  test('search result item has all required fields', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/search', { query: 'test' })
    const required = ['url', 'title', 'description', 'page_age', 'age', 'language', 'source', 'extra_snippets', 'cleaned_markdown', 'clean_ms']
    for (const item of res.json.results) {
      for (const field of required) {
        assert.ok(field in item, `result missing field: ${field}`)
      }
    }
  })

  test('news response has type field', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/news', { query: 'test' })
    assert.equal(res.json.type, 'news')
  })

  test('context result item has snippet_count and clean_ms', async () => {
    const res = await request(QSEARCH_PORT, 'POST', '/context', { query: 'test' })
    for (const item of res.json.results) {
      assert.ok('snippet_count' in item)
      assert.ok('clean_ms' in item)
      assert.ok('cleaned_markdown' in item)
    }
  })
})
