import { Embedder } from './interface.js'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const _hasBareRuntime = (() => {
  try {
    const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', `bare-runtime-${process.platform}-${process.arch}`)
    return existsSync(pkg)
  } catch { return false }
})()

let _loadModel, _embeddingModelSrc, _embedAvailable = false, _embedModelIdPromise = null

if (_hasBareRuntime) {
  try {
    const qvac = await import('@qvac/sdk')
    _loadModel = qvac.loadModel
    // Try known constant names in priority order (checked against @qvac/sdk 0.9.1 exports)
    // 0.9.1 ships PLUGIN_EMBEDDING, EMBEDDINGGEMMA_300M_Q4_0, and future Qwen3 embedding constants
    _embeddingModelSrc = qvac.QWEN3_EMBED_600M || qvac.QWEN3_EMBEDDING_600M || qvac.QWEN3_EMBED ||
      qvac.PLUGIN_EMBEDDING || qvac.EMBEDDINGGEMMA_300M_Q4_0 || null
    if (_loadModel && _embeddingModelSrc) {
      _embedAvailable = true
    } else {
      console.warn('QVAC embed: embedding model constant not found in @qvac/sdk — run: node -e "import(\'@qvac/sdk\').then(m=>console.log(Object.keys(m).filter(k=>k.includes(\'EMBED\'))))" to find it')
    }
  } catch (err) {
    console.warn(`QVAC embed load error: ${err.message}`)
  }
}

export class QvacEmbedder extends Embedder {
  get name () { return 'qvac-embed' }
  get dim () { return 512 } // Qwen3-Embedding-0.6B typical dim — verify after install
  get available () { return _embedAvailable }

  async _warmEmbed () {
    if (!_embedAvailable) throw new Error('QVAC embedding unavailable')
    if (_embedModelIdPromise) return _embedModelIdPromise
    console.log('Loading QVAC embedding model (Qwen3-Embedding-0.6B, ~600MB — downloads once)...')
    _embedModelIdPromise = _loadModel({
      modelSrc: _embeddingModelSrc,
      modelType: 'llamacpp-embedding',
      onProgress: (p) => {
        const pct = typeof p === 'number' ? p : p.percentage
        process.stdout.write(`\rEmbed model: ${pct ?? '?'}%   `)
      }
    }).then(id => { console.log(`\nEmbed model ready: ${id}`); return id })
      .catch(err => { console.error('Embed model load failed:', String(err)); _embedModelIdPromise = null; throw err })
    return _embedModelIdPromise
  }

  async embed (text) {
    if (!_embedAvailable) throw new Error('QVAC embedding unavailable')
    // Returns a number[] — implementation depends on @qvac/sdk 0.9.1 API
    // VERIFY after upgrading: check if SDK exports `embed`, `embedText`, or similar
    const qvac = await import('@qvac/sdk')
    const embedFn = qvac.embed || qvac.embedText || null
    if (!embedFn) throw new Error('No embed function found in @qvac/sdk — check exported keys')
    const mid = await this._warmEmbed()
    return embedFn({ modelId: mid, text })
  }
}

export const embedder = new QvacEmbedder()
export const embedAvailable = _embedAvailable
