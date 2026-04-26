import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// Test the dedupeByUrl logic inline (extracted concept)
function dedupeByUrl (items) {
  const seen = new Set()
  return items.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true })
}

describe('URL deduplication', () => {
  test('removes duplicate URLs', () => {
    const items = [
      { url: 'https://a.com', title: 'A', source: 'corpus' },
      { url: 'https://b.com', title: 'B', source: 'brave' },
      { url: 'https://a.com', title: 'A dup', source: 'brave' }
    ]
    const result = dedupeByUrl(items)
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].source, 'corpus') // corpus wins
  })

  test('preserves order', () => {
    const items = [
      { url: 'https://z.com' },
      { url: 'https://a.com' },
      { url: 'https://m.com' }
    ]
    const result = dedupeByUrl(items)
    assert.deepStrictEqual(result.map(r => r.url), ['https://z.com', 'https://a.com', 'https://m.com'])
  })
})
