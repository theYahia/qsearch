// qsearch v0.3 — Own Corpus layer over Brave proxy.
// Endpoints: POST /search, POST /news, POST /context, POST /index, GET /index/:job_id, GET /corpus/stats, GET /health
import http from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { glob as fsGlob } from 'glob'
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
import { AcademicBackend } from './backends/academic.js'
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
import { ingestBraveDir } from './ingest/brave.js'
import { QueryCache, inferEndpoint } from './cache.js'
import { runSweepContext } from './sweep_context.js'

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

// Academic backend is always available — arxiv has no auth requirement; PubMed and
// Semantic Scholar work without keys (just lower rate limits). Disable explicitly
// via QSEARCH_ACADEMIC_ENABLED=false if you want to route scholarly elsewhere.
const academic = (process.env.QSEARCH_ACADEMIC_ENABLED !== 'false') ? new AcademicBackend() : null

// ── Memcache (Phase 1: exact-match SQLite) ─────────────────────────
const CACHE_DB_PATH = process.env.QSEARCH_CACHE_DB || join(__dirname, '..', 'data', 'cache.db')
let queryCache = null
try {
  queryCache = new QueryCache(CACHE_DB_PATH)
  console.log(`[cache] memcache ready at ${CACHE_DB_PATH}`)
} catch (err) {
  console.warn(`[cache] disabled — could not init SQLite at ${CACHE_DB_PATH}: ${err.message}`)
}

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

async function academicAsBraveResponse (query, params) {
  const t0 = Date.now()
  const hits = await academic.search(query, { n_results: params.count || 5 })
  return { data: { web: { results: hits }, _academic: true }, ms: Date.now() - t0, academic: true }
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
        const files = await fsGlob(pattern)
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
    last_crawled_at: null,
    high_trust_count: meiliStats.high_trust_count ?? 0
  }, null, 2))
}

async function handleIngestBrave (req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }

  const { brave_dir: braveDir, topic = 'brave_ingest' } = body
  if (!braveDir) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'brave_dir required' }))
    return
  }

  try {
    const indexed = await ingestBraveDir(braveDir, topic, meili)
    if (indexed) {
      await refreshCorpusStatus()
      console.log(`[ingest/brave] +${indexed} URLs from ${braveDir}`)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, indexed, brave_dir: braveDir, topic }))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err) }))
  }
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
  const VALID_SORTS = ['trust', 'engine_count', 'sweep_count', 'first_seen']
  const sortParam = reqUrl.searchParams.get('sort') || 'trust'
  const sort = VALID_SORTS.includes(sortParam) ? sortParam : 'trust'
  const offset = Number(reqUrl.searchParams.get('offset')) || 0
  try {
    const top = await meili.topByTrust({ limit, minEngines, sort, offset })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ top, limit, min_engines: minEngines, sort, offset }, null, 2))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'top query failed', detail: String(err) }))
  }
}

// Phase A: dedicated JSON endpoint for academic-only search (arxiv + PubMed + S2).
// For mixed-priority research sweeps with domain=scholarly lines, use POST /sweep.
async function handleAcademicSearch (req, res) {
  if (!academic) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'academic backend disabled (QSEARCH_ACADEMIC_ENABLED=false)' }))
    return
  }
  let body
  const getParams = parseSearchParams(req)
  if (getParams) body = getParams
  else {
    try { body = JSON.parse((await readBody(req)) || '{}') }
    catch {
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
  const n = Math.min(Math.max(Number(body.n_results || body.n) || 5, 1), 20)
  const sources = Array.isArray(body.sources) && body.sources.length
    ? body.sources.filter(s => ['arxiv', 'pubmed', 'semanticscholar'].includes(s))
    : undefined
  const t0 = Date.now()
  const results = await academic.search(query, { n_results: n, sources })
  const durationMs = Date.now() - t0
  if (queryCache) {
    try {
      const meta = sprintMetadataFromReq(req)
      queryCache.recordSprintMetric({
        ...meta, endpoint: '/academic_search', backend: 'academic',
        queries: 1, durationMs
      })
    } catch (e) { console.warn('[economy] record error:', e.message) }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ query, count: results.length, results, duration_ms: durationMs }))
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

  // Phase 2 priority router: per-priority backend selection.
  //   broad    → SearXNG (free, $0); falls back to Brave web if SearXNG missing.
  //   focused  → Brave web with extra_snippets=true; falls back to SearXNG if no Brave key.
  //   critical → Brave web with extra_snippets=true (Phase 3 layers in Brave Context endpoint).
  // Returns Brave-shape response for runSweep's fetchAndDedupe to consume.
  const sweepRouter = (priority, domain) => async (endpoint, query, params) => {
    if (endpoint !== 'web') throw new Error(`/sweep only supports web endpoint (got ${endpoint})`)
    // Phase A: scholarly domain → academic backend (free, peer-reviewed). Overrides priority.
    if (domain === 'scholarly' && academic) return await academicAsBraveResponse(query, params)
    if (priority === 'broad') {
      if (searxng) return await searxngAsBraveResponse(query, params)
      if (BRAVE_KEY) return await braveFetch('web', query, params)
      throw new Error('broad priority needs SEARXNG_URL or BRAVE_API_KEY')
    }
    // focused / critical — prefer Brave with extra_snippets, SearXNG fallback only on missing key.
    if (BRAVE_KEY) return await braveFetch('web', query, { ...params, extra_snippets: true })
    if (searxng) return await searxngAsBraveResponse(query, params)
    throw new Error(`${priority} priority needs BRAVE_API_KEY (or SEARXNG_URL fallback)`)
  }
  console.log(`[sweep] starting ${queries.length} queries via priority router (broad→${searxng ? 'SearXNG' : 'Brave'}, focused/critical→${BRAVE_KEY ? 'Brave' : 'SearXNG fallback'}, scholarly→${academic ? 'Academic' : 'disabled'})`)
  const { results, stats } = await runSweep(queries, sweepRouter)
  const md = renderSweepMd(results, queries, stats)

  // Phase 5: record per-priority economy metric (one row per priority tier).
  // Phase A: scholarly queries are billed as `academic` ($0) regardless of priority.
  // We subtract scholarly counts from each priority bucket to avoid over-charging.
  if (queryCache && stats.by_priority) {
    const meta = sprintMetadataFromReq(req)
    const scholarlyOk = stats.by_domain?.scholarly?.ok || 0
    if (scholarlyOk && academic) {
      try {
        queryCache.recordSprintMetric({
          ...meta, endpoint: '/sweep', priority: 'scholarly', backend: 'academic',
          queries: scholarlyOk, durationMs: stats.duration_ms
        })
      } catch (e) { console.warn('[economy] record error:', e.message) }
    }
    // Per-priority distribution of scholarly queries (subtract them to avoid double-count).
    const scholarlyByPriority = {}
    for (const [, entry] of results) {
      if (entry.domain === 'scholarly' && entry.ok) {
        scholarlyByPriority[entry.priority] = (scholarlyByPriority[entry.priority] || 0) + 1
      }
    }
    for (const [pri, counts] of Object.entries(stats.by_priority)) {
      const ok = Math.max(0, (counts?.ok || 0) - (scholarlyByPriority[pri] || 0))
      if (!ok) continue
      const backend = pri === 'broad'
        ? (searxng ? 'searxng' : 'brave_web')
        : (pri === 'critical' ? 'brave_context' : 'brave_web')
      try {
        queryCache.recordSprintMetric({
          ...meta, endpoint: '/sweep', priority: pri, backend,
          queries: ok, durationMs: stats.duration_ms
        })
      } catch (e) { console.warn('[economy] record error:', e.message) }
    }
  }

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

  // Write findings.md + _sweep_summary.json to _raw_data folder (background).
  // Summary makes silent failures visible to downstream consumers (brave_sweep.py
  // sanity-check, automated quality gates, retro reports). Mirrors brave_sweep.py
  // _sweep_log.json shape — keep schemas similar for future dual-sweep tooling.
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

      const zeroResultLabels = []
      const failedLabels = []
      const okLabels = []
      for (const { label } of queries) {
        const e = results.get(label)
        if (!e) continue
        if (!e.ok && e.reason === 'zero_results') zeroResultLabels.push(label)
        else if (!e.ok) failedLabels.push({ label, error: e.error || 'unknown' })
        else okLabels.push(label)
      }
      const summary = {
        topic: sanitizedTopic,
        generated_at: new Date().toISOString(),
        backend: searxng ? 'searxng' : 'brave',
        total_queries: queries.length,
        ok: stats.web_ok,
        failed: stats.web_fail,
        zero_result: stats.web_zero || 0,
        zero_result_recovered: stats.web_zero_recovered || 0,
        zero_result_rate: queries.length ? Number(((stats.web_zero || 0) / queries.length).toFixed(4)) : 0,
        deduped_urls: stats.total_deduped,
        duration_ms: stats.duration_ms,
        zero_result_queries: zeroResultLabels,
        failed_queries: failedLabels
      }
      writeFileSync(join(outDir, '_sweep_summary.json'), JSON.stringify(summary, null, 2), 'utf8')
      if (summary.zero_result_rate > 0.05) {
        console.warn(`[sweep] ⚠ zero-result rate ${(summary.zero_result_rate * 100).toFixed(1)}% (>5% threshold) — investigate ${sanitizedTopic}`)
      }
    } catch (e) {
      console.error('[sweep] findings/summary render error:', e.message)
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

// ── Memcache endpoints ─────────────────────────────────────────────
function defaultEnginesForSweep () {
  return searxng ? ['searxng'] : ['brave']
}

// Phase 5: pull sprint_id + topic from headers (preferred) or query string for economy logging.
function sprintMetadataFromReq (req) {
  let url
  try { url = new URL(req.url, 'http://localhost') } catch { url = { searchParams: { get: () => null } } }
  return {
    sprintId: req.headers['x-sprint-id'] || url.searchParams.get('sprint_id') || null,
    topic: req.headers['x-topic'] || url.searchParams.get('topic') || null
  }
}

// Parse per-endpoint TTL query params (?ttl_web=7&ttl_news=1&ttl_context=30).
// Returns null if no ttl_* params present (caller falls back to legacy max_age).
function parseTtlMap (searchParams) {
  const map = {}
  let any = false
  for (const ep of ['web', 'news', 'context']) {
    const v = Number(searchParams.get(`ttl_${ep}`))
    if (Number.isFinite(v) && v > 0) { map[ep] = v; any = true }
  }
  const def = Number(searchParams.get('ttl_default'))
  if (Number.isFinite(def) && def > 0) { map.default = def; any = true }
  return any ? map : null
}

async function handleCachedSweep (req, res) {
  if (!queryCache) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'cache unavailable' }))
    return
  }

  const reqUrl = new URL(req.url, 'http://localhost')
  const maxAgeDays = Number(reqUrl.searchParams.get('max_age')) || null
  const ttlMap = parseTtlMap(reqUrl.searchParams)

  const contentType = req.headers['content-type'] || ''
  let queriesText = ''
  if (contentType.includes('application/json')) {
    try {
      const body = JSON.parse((await readBody(req)) || '{}')
      queriesText = body.queries || ''
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid JSON body' }))
      return
    }
  } else {
    queriesText = await readBody(req)
  }

  const queries = parseQueriesText(queriesText)
  if (!queries.length) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'no queries found — send label|query lines in body' }))
    return
  }

  // Phase 2: cache key engines depends on priority — keeps SearXNG-broad results from
  // colliding with Brave-focused (different snippet depth = different cached payload).
  const cacheEnginesFor = (priority, domain) => {
    if (domain === 'scholarly' && academic) return ['academic']
    if (priority === 'broad' && searxng) return ['searxng']
    if (priority === 'critical') return ['brave_critical']
    if (priority === 'focused') return ['brave_focused']
    return defaultEnginesForSweep()  // legacy / no priority → original behaviour
  }
  const cacheOpts = ttlMap ? { ttlMap } : (maxAgeDays ? { maxAgeDays } : {})

  // Split: hits (return from cache) vs misses (run sweep)
  const hits = new Map() // label -> cached entry
  const missQueries = []
  for (const { label, query, priority, domain } of queries) {
    const engines = cacheEnginesFor(priority, domain)
    const cached = queryCache.lookup(query, engines, cacheOpts)
    if (cached) hits.set(label, { query, priority, domain, results: cached.results || [], ok: true, cache: 'hit' })
    else missQueries.push({ label, query, priority, domain })
  }

  // Phase 2 + A priority router (mirrors /sweep handler).
  const cachedSweepRouter = (priority, domain) => async (endpoint, query, params) => {
    if (endpoint !== 'web') throw new Error(`/cached_sweep only supports web endpoint (got ${endpoint})`)
    if (domain === 'scholarly' && academic) return await academicAsBraveResponse(query, params)
    if (priority === 'broad') {
      if (searxng) return await searxngAsBraveResponse(query, params)
      if (BRAVE_KEY) return await braveFetch('web', query, params)
      throw new Error('broad priority needs SEARXNG_URL or BRAVE_API_KEY')
    }
    if (BRAVE_KEY) return await braveFetch('web', query, { ...params, extra_snippets: true })
    if (searxng) return await searxngAsBraveResponse(query, params)
    throw new Error(`${priority} priority needs BRAVE_API_KEY (or SEARXNG_URL fallback)`)
  }

  let liveResults = new Map()
  let liveStats = { web_ok: 0, web_fail: 0, total_deduped: 0, duration_ms: 0 }
  if (missQueries.length > 0) {
    const r = await runSweep(missQueries, cachedSweepRouter)
    liveResults = r.results
    liveStats = r.stats
    // Store fresh results in cache (per-priority engines list keeps tiers isolated)
    for (const { label, query, priority, domain } of missQueries) {
      const entry = liveResults.get(label)
      if (entry?.ok) {
        try { queryCache.store(query, cacheEnginesFor(priority, domain), { results: entry.results }) } catch (e) { console.warn('[cache] store error:', e.message) }
      }
    }
  }

  // Merge results in original order
  const merged = new Map()
  for (const { label } of queries) {
    if (hits.has(label)) merged.set(label, hits.get(label))
    else if (liveResults.has(label)) merged.set(label, { ...liveResults.get(label), cache: 'miss' })
  }

  const stats = {
    ...liveStats,
    cache_hits: hits.size,
    cache_misses: missQueries.length,
    cache_hit_rate: queries.length > 0 ? Number((hits.size / queries.length).toFixed(4)) : 0
  }

  const md = renderSweepMd(merged, queries, stats)

  // Phase 5: economy metric — cache_hit row + miss row (so reports show savings).
  if (queryCache) {
    const meta = sprintMetadataFromReq(req)
    if (hits.size) {
      try {
        queryCache.recordSprintMetric({
          ...meta, endpoint: '/cached_sweep', backend: 'cache_hit',
          queries: hits.size, cacheHits: hits.size, cacheMisses: 0
        })
      } catch (e) { console.warn('[economy] record error:', e.message) }
    }
    if (missQueries.length) {
      // Miss row attributed to whichever live backend ran. Phase A: scholarly domain
      // routes to academic regardless of priority; everything else uses priority tier.
      const scholarlyMisses = missQueries.filter(q => q.domain === 'scholarly').length
      const otherMisses = missQueries.filter(q => q.domain !== 'scholarly')
      const broadMisses = otherMisses.filter(q => q.priority === 'broad').length
      const braveMisses = otherMisses.length - broadMisses
      if (scholarlyMisses > 0 && academic) {
        try {
          queryCache.recordSprintMetric({
            ...meta, endpoint: '/cached_sweep', priority: 'scholarly',
            backend: 'academic',
            queries: scholarlyMisses, cacheHits: 0, cacheMisses: scholarlyMisses,
            durationMs: liveStats.duration_ms
          })
        } catch (e) { console.warn('[economy] record error:', e.message) }
      }
      if (broadMisses > 0) {
        try {
          queryCache.recordSprintMetric({
            ...meta, endpoint: '/cached_sweep', priority: 'broad',
            backend: searxng ? 'searxng' : 'brave_web',
            queries: broadMisses, cacheHits: 0, cacheMisses: broadMisses,
            durationMs: liveStats.duration_ms
          })
        } catch (e) { console.warn('[economy] record error:', e.message) }
      }
      if (braveMisses > 0) {
        try {
          queryCache.recordSprintMetric({
            ...meta, endpoint: '/cached_sweep', priority: 'focused',
            backend: 'brave_web',
            queries: braveMisses, cacheHits: 0, cacheMisses: braveMisses,
            durationMs: liveStats.duration_ms
          })
        } catch (e) { console.warn('[economy] record error:', e.message) }
      }
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Cache-Stats': `hits=${hits.size}, misses=${missQueries.length}`,
    'X-Cache-Hit-Rate': String(stats.cache_hit_rate)
  })
  res.end(md)
}

async function handleCacheLookup (req, res) {
  if (!queryCache) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'cache unavailable' }))
    return
  }
  const url = new URL(req.url, 'http://localhost')
  const hash = url.searchParams.get('hash')
  const queryText = url.searchParams.get('query')
  const enginesParam = url.searchParams.get('engines')
  const engines = enginesParam ? enginesParam.split(',').map(s => s.trim()).filter(Boolean) : []
  const maxAgeDays = Number(url.searchParams.get('max_age')) || null
  const ttlMap = parseTtlMap(url.searchParams)

  // Resolve effective TTL: prefer explicit ttlMap (per-endpoint inferred from engines),
  // fall back to legacy max_age. ttlMap requires engines to infer; without engines we can't route.
  let effectiveMaxAge = maxAgeDays
  if (ttlMap && engines.length) {
    const ep = inferEndpoint(engines)
    const v = ttlMap[ep]
    effectiveMaxAge = (v != null) ? v : (ttlMap.default != null ? ttlMap.default : maxAgeDays)
  }

  let row = null
  if (hash) {
    const r = queryCache._stmtLookup.get(hash)
    if (r) {
      if (effectiveMaxAge && (Date.now() - r.created_at) > effectiveMaxAge * 86400_000) {
        row = null
      } else {
        queryCache._stmtIncr.run(Date.now(), hash)
        queryCache._sessionHits++
        try { row = { hit: true, results: JSON.parse(r.results_json) } } catch { row = null }
      }
    }
  } else if (queryText) {
    const opts = ttlMap ? { ttlMap } : (effectiveMaxAge ? { maxAgeDays: effectiveMaxAge } : {})
    const cached = queryCache.lookup(queryText, engines, opts)
    if (cached) row = { hit: true, results: cached.results || cached }
  } else {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'provide ?hash=<sha256> or ?query=<text>&engines=<csv>' }))
    return
  }

  if (!row) {
    queryCache._sessionMisses++
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ hit: false }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(row))
}

async function handleCacheStore (req, res) {
  if (!queryCache) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'cache unavailable' }))
    return
  }
  let body
  try { body = JSON.parse((await readBody(req)) || '{}') } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return
  }
  const { query, engines, results, hash } = body
  if (!query && !hash) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'query (string) and results (object) required (engines optional)' }))
    return
  }
  if (results == null) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'results payload required' }))
    return
  }
  try {
    const storedHash = queryCache.store(query || '', engines || [], results)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, hash: storedHash }))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'store failed', detail: String(err) }))
  }
}

// Phase 3: local LLM Context endpoint — Brave LLM Context analogue (free, GPU only).
// Body: { urls: string[], focus_query: string, snippets_per_url?, max_chars_per_url?, timeout_ms? }
// Returns Brave-context-shape JSON: { query, type, source, results: [{url, title, snippets[], cleaned_markdown, source}], total_fetch_ms, total_clean_ms, cache_hits, cache_misses }
async function handleSweepContext (req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return
  }
  const { urls, focus_query, max_chars_per_url, snippets_per_url, timeout_ms } = body
  if (!Array.isArray(urls) || !urls.length) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'urls[] required (non-empty array)' }))
    return
  }
  if (urls.length > 20) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'urls[] capped at 20 per request' }))
    return
  }
  if (!focus_query || typeof focus_query !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'focus_query (string) required' }))
    return
  }
  try {
    const out = await runSweepContext({ urls, focus_query, max_chars_per_url, snippets_per_url, timeout_ms })
    // Phase 5: record qsearch_local cost = $0 (GPU only).
    if (queryCache) {
      const meta = sprintMetadataFromReq(req)
      try {
        queryCache.recordSprintMetric({
          ...meta, endpoint: '/sweep_context', backend: 'qsearch_local',
          queries: out.results.length, cacheHits: out.cache_hits || 0, cacheMisses: out.cache_misses || 0,
          durationMs: (out.total_fetch_ms || 0) + (out.total_clean_ms || 0)
        })
      } catch (e) { console.warn('[economy] record error:', e.message) }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out, null, 2))
  } catch (err) {
    console.error('[sweep_context] error:', err.message)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'sweep_context failed', detail: String(err) }))
  }
}

// Phase 5: GET /economy_report — markdown report of sprint_metrics.
// Filters: ?from=<ISO>&to=<ISO>&sprint_id=&topic=&format=markdown|json
async function handleEconomyReport (req, res) {
  if (!queryCache) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'cache unavailable' }))
    return
  }
  const url = new URL(req.url, 'http://localhost')
  const fromStr = url.searchParams.get('from')
  const toStr = url.searchParams.get('to')
  const from = fromStr ? Date.parse(fromStr) : null
  const to = toStr ? Date.parse(toStr) : null
  if (fromStr && Number.isNaN(from)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `invalid 'from' date: ${fromStr}` }))
    return
  }
  if (toStr && Number.isNaN(to)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `invalid 'to' date: ${toStr}` }))
    return
  }
  const sprintId = url.searchParams.get('sprint_id')
  const topic = url.searchParams.get('topic')
  const fmt = url.searchParams.get('format') || 'markdown'

  let report
  try { report = queryCache.economyReport({ from, to, sprintId, topic }) } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'economy_report failed', detail: String(err) }))
    return
  }

  if (fmt === 'json') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(report, null, 2))
    return
  }

  // Markdown rendering
  const lines = []
  lines.push('# qsearch — economy report', '')
  if (from || to) {
    lines.push(`**Period:** ${from ? new Date(from).toISOString().slice(0, 10) : '(start)'} → ${to ? new Date(to).toISOString().slice(0, 10) : 'now'}`, '')
  }
  if (sprintId) lines.push(`**Sprint ID:** \`${sprintId}\``, '')
  if (topic) lines.push(`**Topic:** \`${topic}\``, '')
  lines.push(`- Total HTTP calls logged: **${report.total.calls}**`)
  lines.push(`- Total queries swept: **${report.total.total_queries}**`)
  lines.push(`- Cache hits: **${report.total.total_hits}** / misses: **${report.total.total_misses}**`)
  lines.push(`- Actual cost: **$${(report.actual_cost || 0).toFixed(4)}**`)
  lines.push(`- Baseline (all-Brave + 10% Context): **$${(report.baseline_cost_all_brave || 0).toFixed(4)}**`)
  const savedFmt = (report.savings_usd || 0).toFixed(4)
  lines.push(`- **Saved: $${savedFmt} (${(report.savings_pct * 100).toFixed(1)}%)**`, '')
  lines.push('## By backend', '')
  lines.push('| Backend | Calls | Queries | Cost USD |')
  lines.push('|---|---|---|---|')
  for (const r of report.by_backend) {
    lines.push(`| ${r.backend} | ${r.calls} | ${r.queries || 0} | $${(r.cost || 0).toFixed(4)} |`)
  }
  lines.push('', '## By priority', '')
  lines.push('| Priority | Calls | Queries |')
  lines.push('|---|---|---|')
  for (const r of report.by_priority) {
    lines.push(`| ${r.priority} | ${r.calls} | ${r.queries || 0} |`)
  }
  res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
  res.end(lines.join('\n'))
}

async function handleCacheStats (req, res) {
  if (!queryCache) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'cache unavailable' }))
    return
  }
  const s = queryCache.stats()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(s, null, 2))
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
    res.end(JSON.stringify({ status: 'ok', version: '0.4.0', qvac_available: qvacAvailable, model_loaded: modelReady, embed_loaded: embedder.available, corpus: corpusStatus }))
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
  if ((req.method === 'POST' && req.url === '/academic_search') || (req.method === 'GET' && req.url.startsWith('/academic_search?'))) {
    handleAcademicSearch(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'academic_search failed', detail: String(err) })) })
    return
  }
  if (req.method === 'POST' && (req.url === '/sweep' || req.url.startsWith('/sweep?'))) {
    handleSweep(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'sweep failed', detail: String(err) })) })
    return
  }
  if (req.method === 'POST' && (req.url === '/cached_sweep' || req.url.startsWith('/cached_sweep?'))) {
    handleCachedSweep(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'cached_sweep failed', detail: String(err) })) })
    return
  }
  if (req.method === 'GET' && (req.url === '/cache_lookup' || req.url.startsWith('/cache_lookup?'))) {
    handleCacheLookup(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })) })
    return
  }
  if (req.method === 'POST' && req.url === '/cache_store') {
    handleCacheStore(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })) })
    return
  }
  if (req.method === 'GET' && req.url === '/cache_stats') {
    handleCacheStats(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })) })
    return
  }
  if (req.method === 'POST' && req.url === '/sweep_context') {
    handleSweepContext(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'sweep_context failed', detail: String(err) })) })
    return
  }
  if (req.method === 'GET' && (req.url === '/economy_report' || req.url.startsWith('/economy_report?'))) {
    handleEconomyReport(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })) })
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
  if (req.method === 'POST' && req.url === '/ingest/brave') {
    handleIngestBrave(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })) })
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
  console.log(`qsearch v0.4.0 listening on http://localhost:${PORT}`)
  console.log('POST /search  { "query": "...", "corpus_first": true }')
  console.log('POST /sweep   <queries.txt body> (label|query lines)')
  console.log('POST /cached_sweep  <queries.txt body> (cache-aware, opt-in)')
  console.log('POST /sweep_context  { urls:[], focus_query } (Phase 3 local LLM Context, $0)')
  console.log('GET  /economy_report?from=&to=&sprint_id=&topic=&format=markdown|json  (Phase 5)')
  console.log('GET  /cache_lookup?hash=<sha256>  (or ?query=<text>&engines=<csv>)')
  console.log('POST /cache_store   { query, engines, results }')
  console.log('GET  /cache_stats')
  console.log('POST /news    { "query": "...", "n_results": 5 }')
  console.log('POST /context { "query": "...", "n_results": 3 }')
  console.log('POST /index   { "url": "https://..." } | { "glob": "D:/path/**/*.md" }')
  console.log('GET  /corpus/stats')
  console.log('GET  /corpus/top?limit=20&min_engines=3')
  console.log('GET  /trust/:url')
  console.log('POST /ingest/brave { "brave_dir": "/path/to/brave/", "topic": "..." }')
  console.log('GET  /ui')
  console.log('GET  /health')
  warmModel().catch(() => {})
})
