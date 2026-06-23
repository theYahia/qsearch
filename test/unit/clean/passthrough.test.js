import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PassthroughCleaner } from '../../../src/clean/passthrough.js'
import { Cleaner } from '../../../src/clean/interface.js'

describe('PassthroughCleaner — name', () => {
  test('reports the cleaner name "passthrough"', () => {
    const c = new PassthroughCleaner()
    assert.equal(c.name, 'passthrough')
  })

  test('is a subclass of the Cleaner interface', () => {
    const c = new PassthroughCleaner()
    assert.ok(c instanceof PassthroughCleaner)
    assert.ok(c instanceof Cleaner)
  })
})

describe('PassthroughCleaner — clean (happy path)', () => {
  test('returns item.description verbatim (no transform / no-op)', async () => {
    const c = new PassthroughCleaner()
    const desc = 'Some <b>raw</b> description with  weird   spacing and 漢字'
    const out = await c.clean({ description: desc })
    // Pin exact output: passthrough must NOT strip html, collapse spaces, or trim.
    assert.equal(out, desc)
  })

  test('clean is async — returns a Promise that resolves to a string', () => {
    const c = new PassthroughCleaner()
    const p = c.clean({ description: 'hello' })
    assert.ok(p instanceof Promise)
    return p.then((v) => assert.equal(v, 'hello'))
  })

  test('ignores all other item fields, reads only .description', async () => {
    const c = new PassthroughCleaner()
    const out = await c.clean({
      description: 'keep me',
      title: 'IGNORE',
      url: 'http://example.com',
      content: 'IGNORE BODY'
    })
    assert.equal(out, 'keep me')
  })

  test('preserves whitespace-only description (truthy, not coerced to "")', async () => {
    const c = new PassthroughCleaner()
    // "   " is truthy in JS, so the || fallback must NOT fire.
    const out = await c.clean({ description: '   ' })
    assert.equal(out, '   ')
  })
})

describe('PassthroughCleaner — clean (falsy descriptions fall through to "")', () => {
  test('empty-string description → "" (the || branch)', async () => {
    const c = new PassthroughCleaner()
    assert.equal(await c.clean({ description: '' }), '')
  })

  test('missing description field → ""', async () => {
    const c = new PassthroughCleaner()
    assert.equal(await c.clean({}), '')
  })

  test('null description → ""', async () => {
    const c = new PassthroughCleaner()
    assert.equal(await c.clean({ description: null }), '')
  })

  test('undefined description → ""', async () => {
    const c = new PassthroughCleaner()
    assert.equal(await c.clean({ description: undefined }), '')
  })

  test('numeric 0 description → "" (falsy, NOT the number 0)', async () => {
    const c = new PassthroughCleaner()
    const out = await c.clean({ description: 0 })
    // Documents current behavior: 0 is falsy so || returns the empty string.
    assert.equal(out, '')
    assert.notEqual(out, 0)
  })

  test('boolean false description → ""', async () => {
    const c = new PassthroughCleaner()
    assert.equal(await c.clean({ description: false }), '')
  })

  test('NaN description → "" (NaN is falsy)', async () => {
    const c = new PassthroughCleaner()
    assert.equal(await c.clean({ description: NaN }), '')
  })
})

describe('PassthroughCleaner — clean (truthy non-string descriptions pass through unchanged)', () => {
  test('nonzero number passes through as-is (no string coercion)', async () => {
    const c = new PassthroughCleaner()
    const out = await c.clean({ description: 42 })
    // 42 is truthy → returned verbatim, NOT "42".
    assert.equal(out, 42)
    assert.notEqual(out, '42')
  })

  test('object description passes through by reference', async () => {
    const c = new PassthroughCleaner()
    const obj = { html: '<p>x</p>' }
    const out = await c.clean({ description: obj })
    assert.equal(out, obj)
  })

  test('array description passes through by reference', async () => {
    const c = new PassthroughCleaner()
    const arr = ['a', 'b']
    const out = await c.clean({ description: arr })
    assert.equal(out, arr)
  })
})

describe('PassthroughCleaner — clean (malformed item argument)', () => {
  test('null item rejects with TypeError (reads .description of null)', async () => {
    const c = new PassthroughCleaner()
    await assert.rejects(() => c.clean(null), TypeError)
  })

  test('undefined item rejects with TypeError', async () => {
    const c = new PassthroughCleaner()
    await assert.rejects(() => c.clean(undefined), TypeError)
  })

  test('no-arg call rejects with TypeError (item is undefined)', async () => {
    const c = new PassthroughCleaner()
    await assert.rejects(() => c.clean(), TypeError)
  })
})
