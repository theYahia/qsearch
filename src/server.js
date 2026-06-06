// qsearch v0.3 — Own Corpus layer over Brave proxy.
// Endpoints: POST /search, POST /news, POST /context, POST /index, GET /index/:job_id, GET /corpus/stats, GET /health
import http from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { glob as fsGlob } from 'glob'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'

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
import { createSweepRouter } from './sweep/router.js'
import { parseQueriesText, runSweep } from './sweep/runner.js'
import { renderMarkdown as renderSweepMd } from './sweep/parsed_snippets.js'
import { renderFindings } from './sweep/findings_renderer.js'
import { SearXNGBackend } from './backends/searxng.js'
import { AcademicBackend } from './backends/academic.js'
import { YandexBackend } from './backends/yandex.js'
import { rerankPipeline } from './rerank/pipeline.js'
import { cleanResults, cleanContext, warmModel, localLlmAvailable, CLEAN_MODEL } from './clean/ollama.js'
import { sanitizeText, canonicalizeUrl } from './clean/sanitize.js'
import { MeilisearchCorpus } from './corpus/meilisearch.js'
import { QdrantCorpus } from './corpus/qdrant.js'
import { embedder as ollamaEmbedderInstance } from './embed/ollama.js'
import { LlamaCppEmbedder } from './embed/llamacpp.js'
import { crawl } from './crawl/crawl4ai.js'
import { createJob, getJob, updateJob } from './jobs/store.js'
import { syncToObsidian, appendDailyLog } from './obsidian/sync.js'
import { rerankByTrust } from './search/rerank.js'
import { ingestBraveDir } from './ingest/brave.js'
import { QueryCache, inferEndpoint } from './cache.js'
import { runSweepContext } from './sweep_context.js'
import { fetchHtml, extractMainContent } from './fetch/html.js'
import { runPreSweepCheck } from './sweep/pre_check.js'
import { runBriefScaffold } from './sweep/brief_gen.js'

// ── Corpus clients ─────────────────────────────────────────────────
const MEILI_URL = process.env.MEILISEARCH_URL || 'http://localhost:7700'
// Security (CSO-OPS 2026-05-21 P1-3): refuse the hardcoded default key when the
// server is exposed beyond loopback. On loopback we only warn, so local dev keeps
// working — but a real key (openssl rand -hex 32 in .env.local) is required to expose.
const QSEARCH_BIND = process.env.QSEARCH_BIND || '127.0.0.1'
const IS_LOOPBACK_BIND = ['127.0.0.1', 'localhost', '::1'].includes(QSEARCH_BIND)
let MEILI_KEY = process.env.MEILISEARCH_KEY
if (!MEILI_KEY || MEILI_KEY === 'masterKey') {
  if (!IS_LOOPBACK_BIND) {
    throw new Error('MEILISEARCH_KEY must be set to a non-default value when QSEARCH_BIND is non-loopback. Generate one: openssl rand -hex 32 → .env.local')
  }
  console.warn('[security] MEILISEARCH_KEY unset/default — tolerated only because bound to loopback. Set a real key before any LAN/VPS exposure.')
  MEILI_KEY = MEILI_KEY || 'masterKey'
}
const QDRANT_URL_ENV = process.env.QDRANT_URL || 'http://localhost:6333'

// llama.cpp embedder takes priority over Ollama (used by some deployments). Default → Ollama.
const embedder = process.env.LLAMACPP_URL ? new LlamaCppEmbedder(process.env.LLAMACPP_URL) : ollamaEmbedderInstance
if (process.env.LLAMACPP_URL) console.log(`Embedding: llama.cpp at ${process.env.LLAMACPP_URL}`)

const meili = new MeilisearchCorpus(MEILI_URL, MEILI_KEY)
const qdrant = new QdrantCorpus(QDRANT_URL_ENV, embedder)

// ── Filesystem indexing guard (CSO-OPS 2026-05-21 P1-2 + 5.1) ──────
// /index (glob) and /ingest/brave read caller-supplied paths into the searchable
// corpus. Two protections: (1) never index secrets/keys regardless of path,
// (2) optional hard path boundary via QSEARCH_DATA_ROOTS (semicolon-separated).
const SENSITIVE_FILE_RE = /(^|[/\\])(\.env(\.|$)|.*\.pem$|.*\.key$|id_rsa|id_ed25519|.*\.secret$|credentials)/i
const ALLOWED_ROOTS = (process.env.QSEARCH_DATA_ROOTS || '')
  .split(';').map(s => s.trim()).filter(Boolean).map(p => resolve(p))
function withinAllowedRoots (filePath) {
  if (!ALLOWED_ROOTS.length) return true // unset → no boundary (loopback-only dev default)
  const r = resolve(filePath)
  return ALLOWED_ROOTS.some(root => r === root || r.startsWith(root + sep))
}
// Throws if the path must not be ingested. Used per-file in /index and on /ingest dir.
function assertIndexable (filePath) {
  if (SENSITIVE_FILE_RE.test(filePath)) throw new Error(`refused sensitive file: ${filePath}`)
  if (!withinAllowedRoots(filePath)) throw new Error(`path outside QSEARCH_DATA_ROOTS: ${filePath}`)
}

// ── SearXNG fallback ───────────────────────────────────────────────
const searxng = process.env.SEARXNG_URL ? new SearXNGBackend(process.env.SEARXNG_URL) : null

// Academic backend is always available — arxiv has no auth requirement; PubMed and
// Semantic Scholar work without keys (just lower rate limits). Disable explicitly
// via QSEARCH_ACADEMIC_ENABLED=false if you want to route scholarly elsewhere.
const academic = (process.env.QSEARCH_ACADEMIC_ENABLED !== 'false') ? new AcademicBackend() : null

// Yandex direct backend — only instantiated when both YANDEX_API_KEY and
// YANDEX_FOLDER_ID are set. Otherwise domain=ru falls back to SearXNG with
// language=ru-RU bias (still works, just less Yandex-specific coverage).
let yandex = null
// rd275: surface why Yandex isn't active so /sweep responses can explain the SearXNG fallback.
let yandexInitError = null
if (process.env.YANDEX_API_KEY && process.env.YANDEX_FOLDER_ID) {
  try { yandex = new YandexBackend() } catch (e) {
    yandexInitError = `init_failed: ${e.message}`
    console.warn(`[yandex] init failed: ${e.message}`)
  }
} else {
  const missing = []
  if (!process.env.YANDEX_API_KEY) missing.push('YANDEX_API_KEY')
  if (!process.env.YANDEX_FOLDER_ID) missing.push('YANDEX_FOLDER_ID')
  yandexInitError = `not_configured: missing ${missing.join(' + ')}`
}

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

async function searxngAsBraveResponse (query, params, opts = {}) {
  const t0 = Date.now()
  const searchOpts = { n_results: params.count || 3 }
  if (opts.language) searchOpts.language = opts.language
  if (opts.engines) searchOpts.engines = opts.engines
  const hits = await searxng.search(query, searchOpts)
  return { data: { web: { results: hits }, _searxng: true }, ms: Date.now() - t0, searxng: true }
}

// rd239 ultra-broad: corpus-only lookup. Returns { sufficient, response } where the
// response is Brave-shaped. On insufficient corpus coverage the router falls through
// to the broad tier. Thresholds tunable via QSEARCH_ULTRA_BROAD_* env vars.
async function corpusLookupAsBrave (query, params) {
  const t0 = Date.now()
  const r = await meili.corpusLookup(query, {
    minScore: Number(process.env.QSEARCH_ULTRA_BROAD_MIN_SCORE) || 0.55,
    maxAgeDays: Number(process.env.QSEARCH_ULTRA_BROAD_MAX_AGE_DAYS) || 30,
    limit: params.count || 5
  })
  if (!r.sufficient) return { sufficient: false }
  return {
    sufficient: true,
    response: {
      data: {
        web: { results: r.hits },
        _corpus: true,
        _ultra_broad: { count: r.count, avg_score: Number(r.avgScore.toFixed(3)) }
      },
      ms: Date.now() - t0,
      corpus: true
    }
  }
}

async function academicAsBraveResponse (query, params) {
  const t0 = Date.now()
  const hits = await academic.search(query, { n_results: params.count || 5 })
  return { data: { web: { results: hits }, _academic: true }, ms: Date.now() - t0, academic: true }
}

async function yandexAsBraveResponse (query, params) {
  const t0 = Date.now()
  const hits = await yandex.search(query, { n_results: params.count || 10 })
  return { data: { web: { results: hits }, _yandex: true }, ms: Date.now() - t0, yandex: true }
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
        model: localLlmAvailable && shouldClean ? CLEAN_MODEL?.name : null,
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
        model: localLlmAvailable && shouldClean ? CLEAN_MODEL?.name : null,
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
      model: localLlmAvailable && shouldClean ? CLEAN_MODEL?.name : null,
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
    model: localLlmAvailable && shouldClean ? CLEAN_MODEL?.name : null,
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
        model: localLlmAvailable && shouldClean ? CLEAN_MODEL?.name : null,
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
    model: localLlmAvailable && shouldClean ? CLEAN_MODEL?.name : null,
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
    model: localLlmAvailable ? CLEAN_MODEL?.name : null,
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
    // Reject globs/paths obviously targeting secrets up front (clear 403 to caller).
    if (/\.env|\.ssh|id_rsa|id_ed25519|\.pem|\.key|credentials|\.secret/i.test(url)) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `refused: path/glob targets sensitive files (${url})` }))
      return
    }
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
            assertIndexable(filePath) // skip secrets / out-of-root files
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

// rd275: render the Layer 8 rejected list as a markdown appendix. Only invoked
// when ?include_rejected=true on /sweep or /cached_sweep. Lets users tune the
// QSEARCH_QUALITY_THRESHOLD against composite_score breakdowns from real data.
function renderRejectedSection (resultsMap) {
  const lines = ['## Rejected (Layer 8 quality gate)']
  let anyRejected = false
  for (const [label, entry] of resultsMap) {
    if (!entry?._rejected?.length) continue
    anyRejected = true
    lines.push('', `### ${label}`)
    for (const r of entry._rejected) {
      const parts = r._quality_parts || {}
      const partsStr = Object.entries(parts).map(([k, v]) => `${k}=${Number(v).toFixed(3)}`).join(' ')
      lines.push(`- composite=${r._quality_composite} ${partsStr} — ${r.url || r.title || '(no url)'}`)
    }
  }
  if (!anyRejected) lines.push('', '_No rejections — quality gate either disabled or kept every result._')
  return lines.join('\n')
}

// rd275: GET /backends/status — JSON snapshot of which backends are active and
// why the others aren't. Beats grepping logs when a user sees SearXNG results
// where they expected Yandex.
function handleBackendsStatus (req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    brave: { active: !!BRAVE_KEY, reason: BRAVE_KEY ? 'configured' : 'missing BRAVE_API_KEY' },
    searxng: { active: !!searxng, reason: searxng ? 'configured' : 'missing SEARXNG_URL' },
    academic: { active: !!academic, reason: academic ? 'configured' : 'QSEARCH_ACADEMIC_ENABLED=false' },
    yandex: { active: !!yandex, reason: yandex ? 'configured' : (yandexInitError || 'unknown') }
  }, null, 2))
}

// Reliability (Phase 2): a green /health does NOT prove /sweep works. rd1070 shipped
// twice with /health ok while every broad sweep returned zero (SearXNG silently
// dropped its engines). runSweepCanary issues one real SearXNG query and reports
// which engines actually answered — surfacing degradation instead of hiding it.
async function runSweepCanary () {
  if (!searxng) return { sweep_ok: null, reason: 'searxng_not_configured' }
  try {
    // probe() reports engine health over the FULL result set + SearXNG's unresponsive_engines
    // (the authoritative signal). A real query is used so engine contribution is meaningful —
    // a nonsense query + top-N slice was what made a healthy mojeek look "silent" (rd1070).
    const p = await searxng.probe('open source software')
    return {
      sweep_ok: p.total > 0,
      results: p.total,
      contributing_engines: Object.keys(p.contributing_engines),
      engine_hits: p.contributing_engines,
      unresponsive_engines: p.unresponsive_engines
    }
  } catch (e) {
    return { sweep_ok: false, error: String(e?.message || e) }
  }
}

// Reliability: a present BRAVE_API_KEY can still be revoked (returns 422 SUBSCRIPTION_TOKEN_INVALID
// on every call, silently burning sweeps — observed 2026-06-06). checkBraveKeyValid surfaces
// validity in deep health so the canary catches a dead key instead of every sweep failing.
// Definitive results are cached (10 min TTL) so frequent canary polls don't spend a Brave call
// each time; transient (null) results are not cached so they re-probe next poll.
let _braveKeyCheck = { at: 0, result: null }
async function checkBraveKeyValid () {
  if (!BRAVE_KEY) return { brave_key_valid: null, reason: 'no_key_configured' }
  const TTL_MS = 10 * 60 * 1000
  if (_braveKeyCheck.result && (Date.now() - _braveKeyCheck.at) < TTL_MS) return _braveKeyCheck.result
  let result
  try {
    const base = process.env.BRAVE_BASE_URL || 'https://api.search.brave.com'
    const url = new URL(`${base}/res/v1/web/search`)
    url.searchParams.set('q', 'test')
    url.searchParams.set('count', '1')
    const r = await fetch(url.toString(), {
      headers: { Accept: 'application/json', 'X-Subscription-Token': BRAVE_KEY }
    })
    if (r.ok) result = { brave_key_valid: true, reason: 'ok' }
    else if (r.status === 401 || r.status === 403 || r.status === 422) result = { brave_key_valid: false, reason: `http_${r.status}_subscription_token_invalid` }
    else result = { brave_key_valid: null, reason: `http_${r.status}` } // 429/5xx → transient, don't condemn the key
  } catch (e) {
    result = { brave_key_valid: null, reason: `probe_failed: ${e.message}` }
  }
  if (result.brave_key_valid !== null) _braveKeyCheck = { at: Date.now(), result } // cache only definitive verdicts
  return result
}

// GET /health (liveness) and GET /health?deep=1 (canary sweep — 503 if degraded).
async function handleHealth (req, res) {
  const base = {
    status: 'ok', version: '0.4.0',
    local_llm_available: localLlmAvailable, model_loaded: localLlmAvailable,
    embed_loaded: embedder.available, corpus: corpusStatus
  }
  const deep = /[?&]deep=(1|true)\b/.test(req.url)
  if (!deep) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(base))
    return
  }
  const sweep = await runSweepCanary()
  const brave = await checkBraveKeyValid()
  const degraded = sweep.sweep_ok === false || brave.brave_key_valid === false
  res.writeHead(degraded ? 503 : 200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ...base, status: degraded ? 'degraded' : 'ok', sweep, brave }))
}

async function handleCorpusStats (req, res) {
  const [meiliStats, qdrantStats] = await Promise.all([meili.stats(), qdrant.stats()])
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    total_documents: meiliStats.total,
    namespaces: { builtin: 0, user: meiliStats.total },
    meilisearch_size_mb: meiliStats.size_mb,
    qdrant_vectors: qdrantStats.total,
    last_crawled_at: meiliStats.last_crawled_at ?? null,
    documents_with_crawl_timestamp: meiliStats.documents_with_crawl_timestamp ?? 0,
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
    assertIndexable(braveDir) // enforce QSEARCH_DATA_ROOTS boundary if configured
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
  const sweepRouter = createSweepRouter({
    searxng, academic, yandex, braveKey: BRAVE_KEY,
    braveFetch, searxngAsBraveResponse, academicAsBraveResponse, yandexAsBraveResponse,
    corpusLookup: corpusLookupAsBrave,
    endpointName: '/sweep'
  })
  console.log(`[sweep] starting ${queries.length} queries via priority router (broad→${searxng ? 'SearXNG' : 'Brave'}, focused/critical→${BRAVE_KEY ? 'Brave' : 'SearXNG fallback'}, scholarly→${academic ? 'Academic' : 'disabled'}, ru→${yandex ? 'Yandex' : 'SearXNG+ru-RU'})`)
  const { results, stats } = await runSweep(queries, sweepRouter)

  // Phase B: optional rerank pipeline (embedding similarity, gated by QSEARCH_RERANK_ENABLED).
  const rerankStats = await rerankPipeline(results).catch(e => {
    console.warn('[rerank] failed:', e.message); return { ran: false, error: e.message }
  })
  if (rerankStats.ran) {
    stats.rerank_ms = rerankStats.ms
    stats.rerank = rerankStats
    console.log(`[rerank] stage1: ${rerankStats.stage1.ran} ran / ${rerankStats.stage1.skipped} skipped, stage2: ${rerankStats.stage2.ran} ran (${rerankStats.stage2.calls || 0} LLM calls), gate: ${rerankStats.gate?.ran || 0} ran (rejection=${rerankStats.gate?.rejection_rate ?? 'n/a'}) in ${rerankStats.ms}ms`)
  }

  let md = renderSweepMd(results, queries, stats)

  // rd275: ?include_rejected=true appends the Layer 8 reject list so users can
  // tune QSEARCH_QUALITY_THRESHOLD against real data. Off by default — markdown
  // contract stays unchanged for existing consumers.
  if (new URL(req.url, 'http://localhost').searchParams.get('include_rejected') === 'true') {
    md += '\n\n' + renderRejectedSection(results)
  }

  // Phase 5: record per-priority economy metric (one row per priority tier).
  // Phase A: scholarly queries are billed as `academic` ($0) regardless of priority.
  // Phase C: ru queries with yandex backend billed as `yandex`. Both subtracted
  // from each priority bucket to avoid over-charging Brave for those queries.
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
    const ruOk = stats.by_domain?.ru?.ok || 0
    if (ruOk && yandex) {
      try {
        queryCache.recordSprintMetric({
          ...meta, endpoint: '/sweep', priority: 'ru', backend: 'yandex',
          queries: ruOk, durationMs: stats.duration_ms
        })
      } catch (e) { console.warn('[economy] record error:', e.message) }
    }
    // Per-priority distribution of off-priority-routed queries (subtract to avoid double-count).
    const offRouteByPriority = {}
    for (const [, entry] of results) {
      if (!entry.ok) continue
      const offRoute = (entry.domain === 'scholarly' && academic) ||
                       (entry.domain === 'ru' && yandex)
      if (offRoute) {
        offRouteByPriority[entry.priority] = (offRouteByPriority[entry.priority] || 0) + 1
      }
    }
    for (const [pri, counts] of Object.entries(stats.by_priority)) {
      const ok = Math.max(0, (counts?.ok || 0) - (offRouteByPriority[pri] || 0))
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
    if (domain === 'ru' && yandex) return ['yandex']
    if (domain === 'ru' && searxng) return ['searxng_ru']
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

  // Phase 2 + A + C priority router (mirrors /sweep handler).
  const cachedSweepRouter = createSweepRouter({
    searxng, academic, yandex, braveKey: BRAVE_KEY,
    braveFetch, searxngAsBraveResponse, academicAsBraveResponse, yandexAsBraveResponse,
    corpusLookup: corpusLookupAsBrave,
    endpointName: '/cached_sweep'
  })

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

  // Phase B: rerank merged results (cached hits + fresh) before rendering.
  const rerankStats = await rerankPipeline(merged).catch(e => {
    console.warn('[rerank] failed:', e.message); return { ran: false, error: e.message }
  })
  if (rerankStats.ran) {
    stats.rerank_ms = rerankStats.ms
    stats.rerank = rerankStats
    console.log(`[cached_sweep][rerank] stage1: ${rerankStats.stage1.ran} ran / ${rerankStats.stage1.skipped} skipped, stage2: ${rerankStats.stage2.ran} ran (${rerankStats.stage2.calls || 0} LLM calls), gate: ${rerankStats.gate?.ran || 0} ran (rejection=${rerankStats.gate?.rejection_rate ?? 'n/a'}) in ${rerankStats.ms}ms`)
  }

  let md = renderSweepMd(merged, queries, stats)

  if (new URL(req.url, 'http://localhost').searchParams.get('include_rejected') === 'true') {
    md += '\n\n' + renderRejectedSection(merged)
  }

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
      // Miss row attributed to whichever live backend ran. Phase A: scholarly → academic.
      // Phase C: domain=ru with yandex configured → yandex. Else uses priority tier.
      const scholarlyMisses = missQueries.filter(q => q.domain === 'scholarly').length
      const ruYandexMisses = yandex ? missQueries.filter(q => q.domain === 'ru').length : 0
      const otherMisses = missQueries.filter(q =>
        q.domain !== 'scholarly' && !(q.domain === 'ru' && yandex))
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
      if (ruYandexMisses > 0) {
        try {
          queryCache.recordSprintMetric({
            ...meta, endpoint: '/cached_sweep', priority: 'ru',
            backend: 'yandex',
            queries: ruYandexMisses, cacheHits: 0, cacheMisses: ruYandexMisses,
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
// rd275 Lever C: pre-sweep coverage check against the local corpus.
async function handlePreSweepCheck (req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return
  }
  if (!Array.isArray(body.queries) || !body.queries.length) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'queries[] required (non-empty array of strings)' }))
    return
  }
  if (body.queries.length > 500) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'queries[] capped at 500 per request' }))
    return
  }
  try {
    const idx = await meili.getIndex()
    const out = await runPreSweepCheck(body, idx)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out, null, 2))
  } catch (err) {
    console.error('[pre_sweep_check] error:', err.message)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'pre_sweep_check failed', detail: String(err) }))
  }
}

// rd275 Lever D: research-brief scaffold (Ollama generates clusters + queries.txt,
// Claude finalize load-bearing sections — priors / killer questions / verdict).
async function handleResearchBrief (req, res) {
  let body
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return
  }
  if (!body.topic || typeof body.topic !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'topic (string) required' }))
    return
  }
  const tier = body.tier || 'standard'
  if (!['light', 'standard', 'heavy'].includes(tier)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `tier must be light|standard|heavy (got ${tier})` }))
    return
  }
  try {
    const out = await runBriefScaffold({ topic: body.topic, tier, aperture: body.aperture })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out, null, 2))
  } catch (err) {
    console.error('[research_brief] error:', err.message)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'research_brief failed', detail: String(err) }))
  }
}

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
    // rd275: wire URL-cache so repeat /sweep_context calls on the same (url, focus_query)
    // skip Qwen3-600M extraction (~10-15s/URL on GPU). bust=1 query param forces refresh.
    const reqUrl = new URL(req.url, 'http://localhost')
    const bust = reqUrl.searchParams.get('bust') === '1'
    const cacheClient = queryCache ? {
      get: async (url, query) => queryCache.getSweepContext(url, query, { ttlDays: 7, bust }),
      set: async (url, query, payload) => { queryCache.setSweepContext(url, query, payload) }
    } : null
    const out = await runSweepContext({ urls, focus_query, max_chars_per_url, snippets_per_url, timeout_ms, cacheClient })
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

// POST /url_content — url-keyed full-page cache (claude-webcache hook backend).
// Body: { url, max_age_days? }. corpus-first exact-url lookup (+ freshness gate),
// miss/stale → fetchHtml + extractMainContent → index into corpus (namespace 'webfetch').
// Returns { url, title, markdown, source: 'corpus'|'fetched', crawled_at }.
// Unlike /sweep_context (keyed by url+focus_query, prompt-specific), this is keyed by
// url alone → reusable across prompts/sessions and grows the research corpus passively.
async function handleUrlContent (req, res) {
  let body
  try { body = JSON.parse((await readBody(req)) || '{}') } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON body' }))
    return
  }
  const { url, max_age_days } = body
  if (!url || typeof url !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'url (string) required' }))
    return
  }
  const maxAgeDays = (max_age_days != null)
    ? Number(max_age_days)
    : (Number(process.env.QSEARCH_ULTRA_BROAD_MAX_AGE_DAYS) || 30)
  const toMarkdown = (title, text) => (title ? `# ${title}\n\n` : '') + text

  // 1. corpus-first: exact url lookup (same filter pattern as trustScore) + freshness gate.
  try {
    const idx = await meili.getIndex()
    const filterUrl = url.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const { hits } = await idx.search('', {
      filter: `url = '${filterUrl}'`,
      limit: 1,
      attributesToRetrieve: ['url', 'title', 'text', 'crawled_at']
    })
    const h = hits && hits[0]
    if (h && h.text) {
      const fresh = !h.crawled_at || maxAgeDays <= 0 ||
        (Date.now() - Date.parse(h.crawled_at)) <= maxAgeDays * 86400000
      if (fresh) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ url, title: h.title || '', markdown: toMarkdown(h.title, h.text), source: 'corpus', crawled_at: h.crawled_at || null }))
        return
      }
    }
  } catch (e) {
    console.warn('[url_content] corpus lookup failed (will fetch):', e.message)
  }

  // 2. miss/stale: fetch live (fetchHtml guards SSRF on every redirect hop) + extract + index.
  try {
    const { html } = await fetchHtml(url)
    const { title, text } = extractMainContent(html)
    if (!text) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'no extractable content', url }))
      return
    }
    const crawled_at = new Date().toISOString()
    try {
      await meili.index({ url, title, text, namespace: 'webfetch', engines: ['webfetch'], crawled_at })
    } catch (e) { console.warn('[url_content] index failed (returning anyway):', e.message) }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ url, title, markdown: toMarkdown(title, text), source: 'fetched', crawled_at }))
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'fetch failed', detail: String(err.message || err), url }))
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
  if (req.method === 'GET' && (req.url === '/health' || req.url.startsWith('/health?'))) {
    handleHealth(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'health failed', detail: String(err) })) })
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
  if (req.method === 'POST' && req.url === '/pre_sweep_check') {
    handlePreSweepCheck(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'pre_sweep_check failed', detail: String(err) })) })
    return
  }
  if (req.method === 'POST' && req.url === '/research-brief') {
    handleResearchBrief(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'research_brief failed', detail: String(err) })) })
    return
  }
  if (req.method === 'POST' && (req.url === '/sweep_context' || req.url.startsWith('/sweep_context?'))) {
    handleSweepContext(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'sweep_context failed', detail: String(err) })) })
    return
  }
  if (req.method === 'POST' && req.url === '/url_content') {
    handleUrlContent(req, res).catch((err) => { if (res.headersSent) return; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'url_content failed', detail: String(err) })) })
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
  if (req.method === 'GET' && req.url === '/backends/status') {
    try { handleBackendsStatus(req, res) } catch (err) { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'status failed', detail: String(err) })) } }
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

// Security (CSO-OPS 2026-05-21 P0-1): bind loopback by default. qsearch is a
// single-user dev backend with no auth — LAN exposure = unauthenticated /index,
// /sweep_context (SSRF), /ingest. Override with QSEARCH_BIND only behind real auth.
server.listen(PORT, process.env.QSEARCH_BIND || '127.0.0.1', () => {
  console.log(`qsearch v0.4.0 listening on http://localhost:${PORT}`)
  // rd275: surface gates that ship OFF by default so users notice they exist.
  // Default is intentionally OFF (no behavior change for existing consumers);
  // flip via env after dogfooding — see docs/QUALITY_GATE_DOGFOOD.md.
  if (process.env.QSEARCH_RERANK_ENABLED !== 'true') {
    console.log('[notice] rerank disabled — set QSEARCH_RERANK_ENABLED=true to enable Stages 1+2 (embedding + LLM scoring)')
  }
  if (process.env.QSEARCH_QUALITY_GATE_ENABLED !== 'true') {
    console.log('[notice] Layer 8 quality gate disabled — see docs/QUALITY_GATE_DOGFOOD.md before flipping QSEARCH_QUALITY_GATE_ENABLED=true')
  }
  console.log('POST /search  { "query": "...", "corpus_first": true }')
  console.log('POST /sweep   <queries.txt body> (label|query lines)')
  console.log('POST /cached_sweep  <queries.txt body> (cache-aware, opt-in)')
  console.log('POST /sweep_context  { urls:[], focus_query } (Phase 3 local LLM Context, $0)')
  console.log('POST /url_content  { url, max_age_days? } (url-keyed full-page cache; claude-webcache hook backend)')
  console.log('POST /pre_sweep_check { queries:[], freshness_days?, overlap_threshold? } (rd275 Lever C)')
  console.log('POST /research-brief { topic, tier:light|standard|heavy } (rd275 Lever D, scaffold-only)')
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
  // Reliability (Phase 2): canary the sweep path at startup so a silent SearXNG
  // degradation (rd1070 class) is loud in the log instead of discovered mid-research.
  runSweepCanary().then((c) => {
    if (c.sweep_ok === false) console.warn(`⚠️  SWEEP DEGRADED — SearXNG returned 0 results at startup${c.error ? ` (${c.error})` : ''}. Broad /sweep will be empty. Check engines / SEARXNG_URL.`)
    else if (c.sweep_ok) {
      const unresp = (c.unresponsive_engines || []).map(u => `${u.engine}:${u.reason}`).join(', ')
      console.log(`[canary] sweep ok — ${c.results} results from engines: ${c.contributing_engines.join(', ') || '(none named)'}${unresp ? ` | unresponsive: ${unresp}` : ''}`)
    }
  }).catch(() => {})
})
