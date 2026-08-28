import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { YandexBackend } from '../../../src/backends/yandex.js'

describe('YandexBackend', () => {
  test('throws if YANDEX_SEARCH_API_KEY or YANDEX_FOLDER_ID missing', () => {
    assert.throws(() => new YandexBackend({ apiKey: '', folderId: '' }),
      /YANDEX_SEARCH_API_KEY and YANDEX_FOLDER_ID/)
  })

  test('constructs when both creds provided', () => {
    const b = new YandexBackend({ apiKey: 'k', folderId: 'f' })
    assert.equal(b.name, 'yandex')
    assert.equal(typeof b.search, 'function')
  })

  test('live search', async (t) => {
    if (!process.env.YANDEX_SEARCH_API_KEY || !process.env.YANDEX_FOLDER_ID) {
      return t.skip('Yandex creds not set — skip integration')
    }
    const b = new YandexBackend()
    const r = await b.search('tadviser обзор', { n_results: 3 })
    assert.ok(Array.isArray(r))
    if (r.length) {
      assert.equal(r[0].source, 'yandex')
      assert.equal(r[0].language, 'ru')
      assert.ok(r[0].url)
    }
  })
})
