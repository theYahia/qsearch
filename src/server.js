// qsearch v0.3 — Own Corpus layer over Brave proxy.
// Endpoints: POST /search, POST /news, POST /context, POST /index, GET /index/:job_id, GET /corpus/stats, GET /health
import http from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { glob as fsGlob } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const PORT = Number(process.env.PORT) || 8080
const BRAVE_KEY = process.env.BRAVE_API_KEY
const SEARXNG_URL = process.env.SEARXNG_URL
if (!BRAVE_KEY && !SEARXNG_URL) {
  console.error('Missing BRAVE_API_KEY and SEARXNG_URL — set at least one in .env.local')
  console.error('  Free option: docker compose up searxng → SEARXNG_URL=http://localhost:8888')
  process.exit(1)
}
if (!BRAVE_KEY) {
  console.warn('No BRAVE_API_KEY — using SearXNG as primary backend (free, self-hosted)')
}

// ── Imports (after env loading) ────────────────────────────────────
import { braveFetch } from './backends/brave.js'
import { parseQueriesText, runSweep } from './sweep/runner.js'
import { renderMarkdown as renderSweepMd } from './sweep/parsed_snippets.js'
import { renderFindings } from './sweep/findings_renderer.js'
import { SearXNGBackend } from './backends/searxng.js'
import { cleanResults, cleanContext, warmModel, qvacAvailable, QWEN3_600M_INST_Q4 } from './clean/qvac.js'
import { sanitizeText, canonicalizeUrl } from './clean/sanitize.js'
import { MeilisearchCorpus } from './corpus/meilisearch.js'
import { QdrantCorpus } from './corpus/qdrant.js'
import { embedder as qvacEmbedder } from './embed/qvac.js'
import { LlamaCppEmbedder } from './embed/llamacpp.js'
import { crawl } from './crawl/crawl4ai.js'
import { createJob, getJob, updateJob } from './jobs/store.js'
import { syncToObsidian, appendDailyLog } from './obsidian/sync.js'
import { rerankByTrust } from './search/rerank.js'

// ── Corpus clients ─────────────────────────────────────────────────
const MEILI_URL = process.env.MEILISEARCH_URL || 'http://localhost:7700'
const MEILI_KEY = process.env.MEILISEARCH_KEY || 'masterKey'
const QDRANT_URL_ENV = process.env.QDRANT_URL || 'http://localhost:6333'

// llama.cpp embedder takes priority over @qvac/sdk (works on all platforms)
const embedder = process.env.LLAMACPP_URL ? new LlamaCppEmbedder(process.env.LLAMACPP_URL) : qvacEmbedder
if (process.env.LLAMACPP_URL) console.log(`Embedding: llama.cpp at ${process.env.LLAMACPP_URL}`)

const meili = new MeilisearchCorpus(MEILI_URL, MEILI_KEY)
const qdrant = new QdrantCorpus(QDRANT_URL_ENV, embedder)

// ── SearXNG fallback ───────────────────────────────────────────────
const searxng = process.env.SEARXNG_URL ? new SearXNGBackend(process.env.SEARXNG_URL) : null

// ── Corpus health tracking ─────────────────────────────────────────
let corpusStatus = { meilisearch: 'unavailable', qdrant: 'unavailable' }

async function refreshCorpusStatus () {
  const [mOk, qOk] = await Promise.all([meili.ping(), qdrant.ping()])
  corpusStatus.meilisearch = mOk ? 'ok' : 'unavailable'
  corpusStatus.qdrant = qOk ? 'ok' : 'unavailable'
}
refreshCorpusStatus().catch(() => {})
setInterval(() => refreshCorpusStatus().catch(() => {}), 30_000)

// ── Helpers ────────────────────────────────────────────────────────
function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function parseSearchParams (req) {
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`)
    return {
      query: (url.searchParams.get('q') || '').trim(),
      n_results: url.searchParams.get('n') || url.searchParams.get('n_results'),
      freshness: url.searchParams.get('freshness'),
      search_lang: url.searchParams.get('search_lang'),
      country: url.searchParams.get('country'),
      safesearch: url.searchParams.get('safesearch')
    }
  }
  return null
}

function dedupeByUrl (items) {
  const seen = new Set()
  return items.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true })
}

// ── Corpus routing ─────────────────────────────────────────────────
async function corpusSearch (query, n_results) {
  if (corpusStatus.meilisearch === 'unavailable' && corpusStatus.qdrant === 'unavailable') return []
  const results = await Promise.all([
    corpusStatus.meilisearch !== 'unavailable' ? meili.search(query, { limit: n_results }) : Promise.resolve([]),
    (corpusStatus.qdrant !== 'unavailable' && embedder.available) ? qdrant.search(query, { limit: n_results }) : Promise.resolve([])
  ])
  return dedupeByUrl(results.flat())
}

async function searxngAsBraveResponse (query, params) {
  const t0 = Date.now()
  const hits = await searxng.search(query, { n_results: params.count || 3 })
  return { data: { web: { results: hits }, _searxng: true }, ms: Date.now() - t0, searxng: true }
}

async function routedBraveFetch (endpoint, query, params) {
  // No Brave key → SearXNG primary
  if (!BRAVE_KEY) {
    if (!searxng) throw new Error('Neither BRAVE_API_KEY nor SEARXNG_URL configured')
    if (endpoint !== 'web') {
      // SearXNG only supports web search; news/context not available
      const e = new Error(`Endpoint ${endpoint} requires Brave API key (SearXNG supports web search only)`)
      e.status = 501
      throw e
    }
    return await searxngAsBraveResponse(query, params)
  }
  try {
    return await braveFetch(endpoint, query, params)
  } catch (err) {
    // Fallback to SearXNG on Brave 5xx/429 (web search only)
    if (searxng && endpoint === 'web' && (err.status >= 500 || err.status === 429)) {
      console.warn(`Brave ${err.status} — falling back to SearXNG`)
      return await searxngAsBraveResponse(query, params)
    }
    throw err
  }
}

// ── Handlers ───────────────────────────────────────────────────────
async function handleSearch (req, res) {
  let body
  const getParams = parseSearchParams(req)
  if (getParams) {
    body = getParams
  } else {
    try {
      body = JSON.parse((await readBody(req)) || '{}')
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid JSON body' }))
      return
    }
  }

  const query = (body.query || body.q || '').trim()
  if (!query) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'query is required' }))
    return
  }

  const count = Math.min(Math.max(Number(body.n_results || body.n) || 3, 1), 20)
  const corpusFirst = body.corpus_first !== false && (body.corpus_first === true || process.env.CORPUS_FIRST !== 'false')
  const corpusOnly = body.corpus_only === true

  let corpusMs = null, braveMs = null
  let responseSource = 'brave'

  // Corpus path
  if (corpusFirst) {
    const corpusStart = Date.now()
    let corpusHits = await corpusSearch(query, count)
    corpusMs = Date.now() - corpusStart

    if (body.rerank_by_trust !== false && corpusHits.length > 0) {
      corpusHits = await rerankByTrust(corpusHits).catch(() => corpusHits)
    }

    if (corpusHits.length >= count) {
      const shouldClean = body.clean !== false
      const cleaned = shouldClean ? await cleanResults(corpusHits.slice(0, count)) : corpusHits.slice(0, count).map(r => ({ ...r, cleaned_markdown: null, clean_ms: 0 }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        query,
        brave_endpoint: 'web',
        freshness: body.freshness || null,
        total_results: cleaned.length,
        model: qvacAvailable && shouldClean ? QWEN3_600M_INST_Q4?.name : null,
        cleaned: shouldClean,
        brave_ms: null,
        total_clean_ms: 0,
        source: 'corpus',
        corpus_ms: corpusMs,
        results: cleaned.map(r => ({ ...r, source: 'corpus' }))
      }, null, 2))
      return
    }

    if (corpusOnly) {
      const shouldClean = body.clean !== false
      const cleaned = shouldClean ? await cleanResults(corpusHits) : corpusHits.map(r => ({ ...r, cleaned_markdown: null, clean_ms: 0 }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        query,
        brave_endpoint: 'web',
        freshness: body.freshness || null,
        total_results: cleaned.length,
        model: qvacAvailable && shouldClean ? QWEN3_600M_INST_Q4?.name : null,
        cleaned: shouldClean,
        brave_ms: null,
        total_clean_ms: 0,
        source: 'corpus',
        corpus_ms: corpusMs,
        results: cleaned.map(r => ({ ...r, source: 'corpus' }))
      }, null, 2))
      return
    }

    // Hybrid: fill remainder from Brave
    if (corpusHits.length > 0) responseSource = 'hybrid'

    let data
    try {
      ;({ data, ms: braveMs } = await routedBraveFetch('web', query, {
        count: count - corpusHits.length,
        extra_snippets: true,
        text_decorations: false,
        freshness: body.freshness || null,
        search_lang: body.search_lang || null,
        country: body.country || null,
        safesearch: body.safesearch || null
      }))
    } catch (err) {
      // if Brave fails and we have corpus hits, return those
      if (corpusHits.length > 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          query,
          brave_endpoint: 'web',
          freshness: body.freshness || null,
          total_results: corpusHits.length,
          model: null,
          cleaned: false,
          brave_ms: null,
          total_clean_ms: 0,
          source: 'corpus',
          corpus_ms: corpusMs,
          results: corpusHits.map(r => ({ ...r, source: 'corpus', cleaned_markdown: null, clean_ms: 0 }))
        }, null, 2))
        return
      }
      res.writeHead(err.status || 502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'brave_api_error', status: err.status, detail: err.detail || String(err) }))
      return
    }

    const braveItems = data?.web?.results?.slice(0, count - corpusHits.length) || []
    const shouldClean = body.clean !== false
    const cleanStart = Date.now()
    const braveResults = shouldClean ? await cleanResults(braveItems) : braveItems.map(r => ({ ...r, cleaned_markdown: null, clean_ms: 0 }))
    const total_clean_ms = Date.now() - cleanStart
    const merged = dedupeByUrl([...corpusHits.map(r => ({ ...r, cleaned_markdown: null, clean_ms: 0 })), ...braveResults])
    const finalResults = merged.slice(0, count)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      query,
      brave_endpoint: 'web',
      freshness: body.freshness || null,
      total_results: finalResults.length,
      model: qvacAvailable && shouldClean ? QWEN3_600M_INST_Q4?.name : null,
      cleaned: shouldClean,
      brave_ms: braveMs,
      total_clean_ms,
      source: responseSource,
      corpus_ms: corpusMs,
      results: finalResults
    }, null, 2))
    return
  }

  // Brave-only path (corpus_first: false)
  let data
  try {
    ;({ data, ms: braveMs } = await routedBraveFetch('web', query, {
      count,
      extra_snippets: true,
      text_decorations: false,
      freshness: body.freshness || null,
      search_lang: body.search_lang || null,
      country: body.country || null,
      safesearch: body.safesearch || null
    }))
  } catch (err) {
    res.writeHead(err.status || 502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'brave_api_error', status: err.status, detail: err.detail || String(err) }))
    return
  }

  const webItems = data?.web?.results?.slice(0, count) || []
  const shouldClean = body.clean !== false
  const cleanStart = Date.now()
  const results = shouldClean ? await cleanResults(webItems) : webItems.map(r => ({ ...r, cleaned_markdown: null, clean_ms: 0 }))
  const total_clean_ms = Date.now() - cleanStart

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    query,
    brave_endpoint: 'web',
    freshness: body.freshness || null,
    total_results: results.length,
    model: qvacAvailable && shouldClean ? QWEN3_600M_INST_Q4?.name : null,
    cleaned: shouldClean,
    brave_ms: braveMs,
    total_clean_ms,
    source: 'brave',
    corpus_ms: null,
    results
  }, null, 2))
}

async function handleNews (req, res) {
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

  const count = Math.min(Math.max(Number(body.n_results) || 5, 1), 50)
  const corpusFirst = body.corpus_first !== false && (body.corpus_first === true || process.env.CORPUS_FIRST !== 'false')
  const corpusOnly = body.corpus_only === true

  let corpusMs = null, braveMs = null

  if (corpusFirst) {
    const corpusStart = Date.now()
    const corpusHits = await corpusSearch(query, count)
    corpusMs = Date.now() - corpusStart

    if (corpusHits.length >= count || corpusOnly) {
      const hits = corpusHits.slice(0, count)
      const shouldClean = body.clean !== false
      const cleaned = shouldClean ? await cleanResults(hits) : hits.map(r => ({ ...r, cleaned_markdown: null, clean_ms: 0 }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        query,
        type: 'news',
        brave_endpoint: 'news',
        freshness: body.freshness || 'pw',
        total_results: cleaned.length,
        model: qvacAvailable && shouldClean ? QWEN3_600M_INST_Q4?.name : null,
        cleaned: shouldClean,
        brave_ms: null,
        total_clean_ms: 0,
        source: 'corpus',
        corpus_ms: corpusMs,
        results: cleaned.map(r => ({ ...r, source: 'corpus' }))
      }, null, 2))
      return
    }
  }

  let data
  try {
    ;({ data, ms: braveMs } = await braveFetch('news', query, {
      count,
      freshness: body.freshness || 'pw',
      text_decorations: false,
      search_lang: body.search_lang || null
    }))
  } catch (err) {
    res.writeHead(err.status || 502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'brave_api_error', status: err.status, detail: err.detail || String(err) }))
    return
  }

  const newsItems = data?.results?.slice(0, count) || []
  const shouldClean = body.clean !== false
  const cleanStart = Date.now()
  const results = shouldClean ? await cleanResults(newsItems) : newsItems.map(r => ({ ...r, cleaned_markdown: null, clean_ms: 0 }))
  const total_clean_ms = Date.now() - cleanStart

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    query,
    type: 'news',
    brave_endpoint: 'news',
    freshness: body.freshness || 'pw',
    total_results: results.length,
    model: qvacAvailable && shouldClean ? QWEN3_600M_INST_Q4?.name : null,
    cleaned: shouldClean,
    brave_ms: braveMs,
    total_clean_ms,
    source: 'brave',
    corpus_ms: corpusFirst ? corpusMs : null,
    results
  }, null, 2))
}

async function handleContext (req, res) {
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

  const count = Math.min(Math.max(Number(body.n_results) || 3, 1), 10)
  let braveMs = null

  let data
  try {
    ;({ data, ms: braveMs } = await braveFetch('llm/context', query, {
      count,
      freshness: body.freshness || null
    }))
  } catch (err) {
    res.writeHead(err.status || 502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'brave_api_error', status: err.status, detail: err.detail || String(err) }))
    return
  }

  const grounding = data?.grounding?.generic || []
  const cleanStart = Date.now()
  const results = []

  for (const item of grounding) {
    const itemStart = Date.now()
    const { cleanSnippets, cleaned_markdown } = await cleanContext(item)
    results.push({
      url: item.url,
      title: item.title,
      snippet_count: item.snippets?.length || 0,
      cleaned_markdown,
      clean_ms: Date.now() - itemStart,
      source: 'brave'
    })
  }

  const total_clean_ms = Date.now() - cleanStart

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    query,
    type: 'context',
    brave_endpoint: 'llm/context',
    freshness: body.freshness || null,
    total_results: results.length,
    model: qvacAvailable ? QWEN3_600M_INST_Q4?.name : null,
    brave_ms: braveMs,
    total_clean_ms,
    source: 'brave',
    corpus_ms: null,
    results
  }, null, 2))
}

async function handleIndex (req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return
  }

  const url = (body.url || body.path || body.glob || '').trim()
  if (!url) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'url, path, or glob is required' }))
    return
  }

  // File/glob indexing path (not a URL)
  if (!url.startsWith('http')) {
    const namespace = 'user'
    const job_id = createJob(url, namespace)
    res.writeHead(202, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ job_id, status: 'queued', path: url, namespace, queued_at: getJob(job_id).queued_at }))

    setImmediate(async () => {
      updateJob(job_id, { status: 'running', started_at: new Date().toISOString() })
      let indexed = 0
      try {
        const pattern = url.replace(/\\/g, '/')
        const files = []
        for await (const f of fsGlob(pattern)) files.push(f)
        if (!files.length) {
          updateJob(job_id, { status: 'failed', error: `No files matched: ${url}`, finished_at: new Date().toISOString() })
          return
        }
        for (const filePath of files) {
          try {
            const raw = readFileSync(filePath, 'utf8')
            const title = raw.match(/^#\s+(.+)/m)?.[1]?.trim() ||
              raw.match(/^title:\s+(.+)/im)?.[1]?.trim() ||
              filePath.split(/[/\\]/).pop().replace(/\.md$/, '')
            const text = raw.replace(/^---[\s\S]*?---\n/m, '').replace(/[#*`>_]/g, '').trim()
            const docUrl = 'file://' + filePath.replace(/\\/g, '/')
            const doc = {
              id: docUrl, url: docUrl, title,
              text: text.slice(0, 10000),
              description: text.slice(0, 300),
              namespace,
              crawled_at: new Date().toISOString()
            }
            await meili.index(doc)
            indexed++
            updateJob(job_id, { pages_indexed: indexed })
          } catch (e) {
            console.error('[index-files] skip:', filePath, e.message)
          }
        }
        updateJob(job_id, { status: 'done', pages_crawled: files.length, pages_indexed: indexed, finished_at: new Date().toISOString() })
        console.log(`[index-files] indexed ${indexed}/${files.length} files`)
        await refreshCorpusStatus()
      } catch (err) {
        updateJob(job_id, { status: 'failed', error: String(err), finished_at: new Date().toISOString() })
      }
    })
    return
  }

  const depth = Math.min(Math.max(Number(body.depth) || 1, 1), 3)
  const namespace = body.namespace === 'builtin' ? 'builtin' : 'user'
  const job_id = createJob(url, namespace)

  res.writeHead(202, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ job_id, status: 'queued', url, namespace, queued_at: getJob(job_id).queued_at }))

  // Run crawl in background
  setImmediate(async () => {
    updateJob(job_id, { status: 'running', started_at: new Date().toISOString() })
    try {
      const { pages, error } = await crawl(url, {
        depth,
        onDoc: async (doc) => {
          const j = getJob(job_id)
          updateJob(job_id, { pages_crawled: j.pages_crawled + 1 })
          try {
            const docToIndex = { id: doc.url, ...doc, namespace, crawled_at: new Date().toISOString() }
            await Promise.all([meili.index(docToIndex), qdrant.index(docToIndex)])
            updateJob(job_id, { pages_indexed: getJob(job_id).pages_indexed + 1 })
          } catch (e) {
            console.error('[index] Failed to index:', doc.url, e.message)
          }
        }
      })
      updateJob(job_id, { status: error ? 'failed' : 'done', error: error || null, finished_at: new Date().toISOString() })
      await refreshCorpusStatus()
    } catch (err) {
      updateJob(job_id, { status: 'failed', error: String(err), finished_at: new Date().toISOString() })
    }
  })
}

async function handleIndexStatus (req, res, job_id) {
  const job = getJob(job_id)
  if (!job) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'job not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(job, null, 2))
}

async function handleCorpusStats (req, res) {
  const [meiliStats, qdrantStats] = await Promise.all([meili.stats(), qdrant.stats()])
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    total_documents: meiliStats.total,
    namespaces: { builtin: 0, user: meiliStats.total },
    meilisearch_size_mb: meiliStats.size_mb,
    qdrant_vectors: qdrantStats.total,
    last_crawled_at: null
  }, null, 2))
}

async function handleTrust (req, res) {
  const match = req.url.match(/^\/trust\/(.+?)(?:\?|$)/)
  if (!match) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'usage: /trust/<urlencoded-url>' }))
    return
  }
  const url = decodeURIComponent(match[1])
  try {
    const result = await meili.trustScore(url)
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'URL not in corpus', url }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result, null, 2))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'trust computation failed', detail: String(err) }))
  }
}

async function handleCorpusTop (req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`)
  const limit = Math.min(Number(reqUrl.searchParams.get('limit')) || 20, 100)
  const minEngines = Number(reqUrl.searchParams.get('min_engines')) || 1
  try {
    const top = await meili.topByTrust({ limit, minEngines })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ top, limit, min_engines: minEngines }, null, 2))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'top query failed', detail: String(err) }))
  }
}

async function handleSweep (req, res) {
  const contentType = req.headers['content-type'] || ''
  let queriesText, saveOutput = false

  if (contentType.includes('application/json')) {
    let body
    try { body = JSON.parse((await readBody(req)) || '{}') } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid JSON body' }))
      return
    }
    queriesText = body.queries || ''
    saveOutput = Boolean(body.save)
  } else {
    queriesText = await readBody(req)
  }

  const queries = parseQueriesText(queriesText)
  if (!queries.length) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'no queries found — send label|query lines in body' }))
    return
  }

  // /sweep is the SearXNG half of DUAL SWEEP (brave_sweep.py is the Brave half).
  // Always prefer SearXNG so we capture per-result engines[] attribution. Fall back to
  // routedBraveFetch only when SearXNG is unavailable.
  const sweepFetch = searxng
    ? async (endpoint, query, params) => {
      if (endpoint !== 'web') {
        throw new Error(`/sweep only supports web endpoint via SearXNG (got ${endpoint})`)
      }
      return await searxngAsBraveResponse(query, params)
    }
    : routedBraveFetch
  console.log(`[sweep] starting ${queries.length} queries via ${searxng ? 'SearXNG' : 'Brave (no SearXNG configured)'}`)
  const { results, stats } = await runSweep(queries, sweepFetch)
  const md = renderSweepMd(results, queries, stats)

  // Extract topic before response is sent (req.url must not be accessed after res.end)
  const sweepReqUrl = req.url

  // Index results into corpus (background, don't block response)
  setImmediate(async () => {
    let indexed = 0
    for (const { label } of queries) {
      const entry = results.get(label)
      if (!entry?.ok) continue
      for (const r of entry.results) {
        if (!r.url) continue
        try {
          const cleanUrl = canonicalizeUrl(r.url)
          const engines = Array.isArray(r.engines) ? r.engines : []
          const doc = {
            url: cleanUrl,
            title: sanitizeText(r.title || ''),
            description: sanitizeText(r.description || ''),
            text: sanitizeText([r.title, r.description, ...(r.extra_snippets || [])].filter(Boolean).join('\n')),
            namespace: 'sweep',
            sweep_label: label,
            engines,
            engine_count: engines.length,
            backend_source: r.source || null,
            crawled_at: new Date().toISOString()
          }
          await meili.index(doc)
          indexed++
        } catch (e) {
          console.error('[sweep] index error:', r.url, e.message)
        }
      }
    }
    if (indexed) {
      console.log(`[sweep] indexed ${indexed} results into corpus`)
      await refreshCorpusStatus()
    }
  })

  // Write findings.md to _raw_data folder (background)
  setImmediate(async () => {
    try {
      const reqUrl = new URL(sweepReqUrl, 'http://localhost')
      const topic = reqUrl.searchParams.get('topic') ||
                    `sweep_${new Date().toISOString().slice(0, 10)}`
      const sanitizedTopic = topic.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
      const outDir = join(__dirname, '..', '_raw_data', sanitizedTopic)
      mkdirSync(outDir, { recursive: true })
      const findings = await renderFindings(results, queries, stats, sanitizedTopic)
      writeFileSync(join(outDir, 'findings.md'), findings, 'utf8')
      console.log(`[sweep] findings.md → _raw_data/${sanitizedTopic}/findings.md`)
    } catch (e) {
      console.error('[sweep] findings render error:', e.message)
    }
  })

  // Sync to Obsidian vault (background)
  setImmediate(async () => {
    try {
      const reqUrl = new URL(sweepReqUrl, 'http://localhost')
      const topic = reqUrl.searchParams.get('topic') ||
                    `sweep_${new Date().toISOString().slice(0, 10)}`
      const sanitizedTopic = topic.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
      const obsPath = await syncToObsidian({ topic: sanitizedTopic, queries, results, stats })
      if (obsPath) console.log(`[sweep] Obsidian sync → ${obsPath}`)
      const logPath = await appendDailyLog({ topic: sanitizedTopic, queries, stats })
      if (logPath) console.log(`[sweep] daily log → ${logPath}`)
    } catch (e) {
      console.error('[sweep] Obsidian sync error:', e.message)
    }
  })

  if (saveOutput) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outDir = join(__dirname, '..', 'data', 'sweeps', ts)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'parsed_snippets.md'), md, 'utf8')
    console.log(`[sweep] saved → ${outDir}/parsed_snippets.md`)
  }

  console.log(`[sweep] done: ${stats.web_ok} ok / ${stats.web_fail} fail in ${(stats.duration_ms / 1000).toFixed(1)}s`)
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(md)
}

// ── Static files ───────────────────────────────────────────────────
const indexHtml = readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf8')
const docsMd = readFileSync(join(__dirname, '..', 'public', 'docs.md'), 'utf8')

// ── HTTP Server ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(indexHtml)
    return
  }
  if (req.method === 'GET' && (req.url === '/skill.md' || req.url === '/docs')) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(docsMd)
    return
  }
  if (req.method === 'GET' && req.url === '/health') {
    const modelReady = true // warmModel status tracked in clean/qvac.js
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', version: '0.3.0', qvac_available: qvacAvailable, model_loaded: modelReady, embed_loaded: embedder.available, corpus: corpusStatus }))
    return
  }
  if ((req.method === 'POST' && req.url === '/search') || (req.method === 'GET' && req.url.startsWith('/search?'))) {
    handleSearch(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'request failed', detail: String(err) })) })
    return
  }
  if (req.method === 'POST' && req.url === '/news') {
    handleNews(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'request failed', detail: String(err) })) })
    return
  }
  if (req.method === 'POST' && req.url === '/context') {
    handleContext(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'request failed', detail: String(err) })) })
    return
  }
  if (req.method === 'POST' && req.url === '/index') {
    handleIndex(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'request failed', detail: String(err) })) })
    return
  }
  if (req.method === 'POST' && req.url === '/sweep') {
    handleSweep(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'sweep failed', detail: String(err) })) })
    return
  }
  const indexJobMatch = req.method === 'GET' && req.url.match(/^\/index\/([a-f0-9-]{36})$/)
  if (indexJobMatch) {
    handleIndexStatus(req, res, indexJobMatch[1]).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'request failed', detail: String(err) })) })
    return
  }
  if (req.method === 'GET' && req.url === '/corpus/stats') {
    handleCorpusStats(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'request failed', detail: String(err) })) })
    return
  }
  if (req.method === 'GET' && req.url.startsWith('/trust/')) {
    handleTrust(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })) })
    return
  }
  if (req.method === 'GET' && req.url.startsWith('/corpus/top')) {
    handleCorpusTop(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })) })
    return
  }
  if (req.method === 'GET' && (req.url === '/ui' || req.url === '/ui/')) {
    try {
      const html = readFileSync(join(__dirname, '..', 'public', 'ui.html'), 'utf8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('UI not found')
    }
    return
  }
  if (req.method === 'GET' && req.url === '/ui/app.js') {
    try {
      const js = readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf8')
      res.writeHead(200, { 'Content-Type': 'application/javascript' })
      res.end(js)
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('app.js not found')
    }
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.keepAliveTimeout = 65000
server.headersTimeout = 66000

server.listen(PORT, () => {
  console.log(`qsearch v0.3.0 listening on http://localhost:${PORT}`)
  console.log('POST /search  { "query": "...", "corpus_first": true }')
  console.log('POST /sweep   <queries.txt body> (label|query lines)')
  console.log('POST /news    { "query": "...", "n_results": 5 }')
  console.log('POST /context { "query": "...", "n_results": 3 }')
  console.log('POST /index   { "url": "https://..." } | { "glob": "D:/path/**/*.md" }')
  console.log('GET  /corpus/stats')
  console.log('GET  /corpus/top?limit=20&min_engines=3')
  console.log('GET  /trust/:url')
  console.log('GET  /ui')
  console.log('GET  /health')
  warmModel().catch(() => {})
})
