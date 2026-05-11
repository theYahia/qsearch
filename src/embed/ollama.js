// Ollama embedding client — Phase B fallback for QVAC embeddings.
// Why: QVAC SDK 0.9.1 exposes no working embed function (see src/embed/qvac.js).
// Ollama runs locally for night-loop already; `ollama pull nomic-embed-text` is a
// one-time 274MB download. Talks pure HTTP, no native deps.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'

let _available = null
let _availabilityPromise = null

async function checkAvailability () {
  if (_availabilityPromise) return _availabilityPromise
  _availabilityPromise = (async () => {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 3000)
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal })
      clearTimeout(t)
      if (!r.ok) return false
      const data = await r.json()
      const models = (data.models || []).map(m => m.name || m.model || '')
      // Embed model name may have :tag suffix; accept either exact or prefix match.
      const found = models.some(m => m === OLLAMA_EMBED_MODEL || m.startsWith(`${OLLAMA_EMBED_MODEL}:`))
      if (!found) {
        console.warn(`[ollama-embed] model "${OLLAMA_EMBED_MODEL}" not found in Ollama. Pull it: ollama pull ${OLLAMA_EMBED_MODEL}`)
        return false
      }
      return true
    } catch (e) {
      console.warn(`[ollama-embed] Ollama not reachable at ${OLLAMA_URL}: ${e.message}`)
      return false
    }
  })()
  return _availabilityPromise
}

export async function ollamaEmbedAvailable () {
  if (_available !== null) return _available
  _available = await checkAvailability()
  return _available
}

export async function ollamaEmbed (text, opts = {}) {
  const timeout_ms = opts.timeout_ms || 15000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout_ms)
  try {
    const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
      signal: ctrl.signal
    })
    if (!r.ok) {
      const err = await r.text().catch(() => '')
      throw new Error(`ollama embed ${r.status}: ${err.slice(0, 200)}`)
    }
    const data = await r.json()
    const vec = data?.embedding
    if (!Array.isArray(vec) || !vec.length) throw new Error('ollama returned no embedding')
    return vec
  } finally {
    clearTimeout(timer)
  }
}

export async function ollamaEmbedBatch (texts, opts = {}) {
  // Ollama /api/embeddings is single-prompt. We fan out with a concurrency cap.
  const conc = Math.max(1, Math.min(opts.concurrency || 6, 12))
  const out = new Array(texts.length)
  let cursor = 0
  async function worker () {
    while (true) {
      const i = cursor++
      if (i >= texts.length) return
      try { out[i] = await ollamaEmbed(texts[i], opts) }
      catch (e) { out[i] = null; if (opts.verbose) console.warn(`[ollama-embed] item ${i}: ${e.message}`) }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  return out
}
