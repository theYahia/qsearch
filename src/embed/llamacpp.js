import { Embedder } from './interface.js'

export class LlamaCppEmbedder extends Embedder {
  constructor (url) {
    super()
    this._url = (url || '').replace(/\/$/, '')
    this._dim = null
  }

  get name () { return 'llamacpp' }
  get dim () { return this._dim || 1024 }
  get available () { return Boolean(this._url) }

  async embed (text) {
    if (!this._url) throw new Error('LLAMACPP_URL not configured')
    const r = await fetch(`${this._url}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'embedding' }),
      signal: AbortSignal.timeout(30000)
    })
    if (!r.ok) {
      const e = new Error(`llama.cpp embedding error ${r.status}`)
      e.status = r.status
      throw e
    }
    const data = await r.json()
    const vec = data?.data?.[0]?.embedding || data?.embedding
    if (!Array.isArray(vec) || !vec.length) throw new Error('No embedding vector in llama.cpp response')
    if (!this._dim) this._dim = vec.length
    return vec
  }
}
