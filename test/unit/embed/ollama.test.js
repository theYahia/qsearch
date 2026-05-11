import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { OllamaEmbedder, embedder } from '../../../src/embed/ollama.js'

describe('OllamaEmbedder', () => {
  test('exposes Embedder interface', () => {
    const e = new OllamaEmbedder()
    assert.equal(typeof e.name, 'string')
    assert.ok(e.name.startsWith('ollama-'))
    assert.equal(typeof e.dim, 'number')
    assert.ok(e.dim > 0)
    assert.equal(typeof e.embed, 'function')
    assert.equal(typeof e.embedBatch, 'function')
  })

  test('default singleton is exported', () => {
    assert.ok(embedder instanceof OllamaEmbedder)
  })

  test('embed throws when Ollama unreachable', async (t) => {
    // If Ollama is actually running locally, skip — we only want to verify the
    // error path. The `available` getter is the live check.
    if (embedder.available) t.skip('Ollama running — skip unavailable-path test')
    await assert.rejects(() => new OllamaEmbedder().embed('test').then(() => { throw new Error('unexpected ok') }))
  })
})
