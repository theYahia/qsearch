// qsearch — Day 3: Brave fetch + QVAC local LLM cleaning pipeline.
// Model: Qwen3-0.6B Q4 (~364MB, downloads once on first request).

import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadModel, completion, QWEN3_600M_INST_Q4 } from '@qvac/sdk'

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

const CLEAN_SYSTEM = `You are a search result cleaner for a local AI agent. /no_think
Given a web search result, extract the key information as 1-2 concise sentences of plain prose.
No bullet points. No headers. No thinking. Return only the cleaned sentences.`

let modelIdPromise = null

function warmModel () {
  if (modelIdPromise) return modelIdPromise
  console.log('Loading QVAC model (Qwen3-0.6B Q4, ~364MB — downloads once)...')
  modelIdPromise = loadModel({
    modelSrc: QWEN3_600M_INST_Q4,
    modelType: 'llamacpp-completion',
    onProgress: (p) => {
      const pct = typeof p === 'number' ? p : p.percentage
      process.stdout.write(`\rModel: ${pct ?? '?'}%   `)
    }
  }).then((id) => {
    console.log(`\nModel ready: ${id}`)
    return id
  })
  return modelIdPromise
}

async function cleanResult (raw) {
  const mid = await warmModel()
  const result = completion({
    modelId: mid,
    history: [
      { role: 'system', content: CLEAN_SYSTEM },
      {
        role: 'user',
        content: `Title: ${raw.title}\nURL: ${raw.url}\nDescription: ${raw.description || ''}`
      }
    ],
    stream: false
  })
  return result.text
}

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

  const count = Math.min(Math.max(Number(body.n_results) || 3, 1), 10)

  // Step 1 — Brave fetch
  const braveStart = Date.now()
  const braveUrl = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}`
  const r = await fetch(braveUrl, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': BRAVE_KEY }
  })
  const braveData = await r.json()
  const brave_ms = Date.now() - braveStart

  const webResults = braveData?.web?.results?.slice(0, count) || []

  // Step 2 — QVAC local cleaning (sequential — one inference at a time)
  const results = []
  for (const item of webResults) {
    const cleanStart = Date.now()
    let cleaned_markdown = null
    try {
      const raw = await cleanResult(item)
      cleaned_markdown = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    } catch (err) {
      console.error('QVAC clean error:', String(err))
      // graceful degradation — return raw snippet if local LLM fails
    }
    results.push({
      url: item.url,
      title: item.title,
      description: item.description || null,
      cleaned_markdown,
      clean_ms: Date.now() - cleanStart
    })
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    query,
    model: QWEN3_600M_INST_Q4.name,
    brave_ms,
    results
  }, null, 2))
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/search') {
    handleSearch(req, res).catch((err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'request failed', detail: String(err) }))
    })
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, () => {
  console.log(`qsearch listening on http://localhost:${PORT}`)
  console.log('POST /search { "query": "...", "n_results": 3 }')
  // Kick off model load in background so first real request is faster
  warmModel().catch(() => {})
})
