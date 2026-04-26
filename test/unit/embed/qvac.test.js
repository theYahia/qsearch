import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { QvacEmbedder } from '../../../src/embed/qvac.js'

describe('QvacEmbedder', () => {
  const e = new QvacEmbedder()

  test('has expected interface', () => {
    assert.strictEqual(typeof e.name, 'string')
    assert.strictEqual(typeof e.dim, 'number')
    assert.strictEqual(typeof e.available, 'boolean')
    assert.strictEqual(typeof e.embed, 'function')
  })

  test('embed throws when unavailable', async (t) => {
    if (e.available) t.skip('QVAC available — skip unavailable test')
    await assert.rejects(() => e.embed('test'))
  })
})
