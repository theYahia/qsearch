import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseQueriesText, VALID_PRIORITIES, VALID_DOMAINS } from '../../../src/sweep/runner.js'

describe('parseQueriesText — Phase 2 priority + Phase A domain', () => {
  test('exports priority and domain vocab', () => {
    assert.ok(VALID_PRIORITIES.has('broad'))
    assert.ok(VALID_PRIORITIES.has('focused'))
    assert.ok(VALID_PRIORITIES.has('critical'))
    assert.ok(VALID_DOMAINS.has('general'))
    assert.ok(VALID_DOMAINS.has('scholarly'))
    assert.ok(VALID_DOMAINS.has('ru'))
  })

  test('2-field default to broad/general', () => {
    const r = parseQueriesText('a|simple query')
    assert.equal(r.length, 1)
    assert.deepEqual(r[0], { label: 'a', query: 'simple query', priority: 'broad', domain: 'general' })
  })

  test('3-field with priority only', () => {
    const r = parseQueriesText('a|q|focused')
    assert.equal(r[0].priority, 'focused')
    assert.equal(r[0].domain, 'general')
  })

  test('3-field with domain only', () => {
    const r = parseQueriesText('a|q|scholarly')
    assert.equal(r[0].priority, 'broad')
    assert.equal(r[0].domain, 'scholarly')
  })

  test('4-field priority + domain', () => {
    const r = parseQueriesText('a|q|focused|scholarly')
    assert.equal(r[0].priority, 'focused')
    assert.equal(r[0].domain, 'scholarly')
  })

  test('preserves URLs with | inside query', () => {
    const r = parseQueriesText('a|search this http://x|y|z|broad|ru')
    assert.equal(r[0].query, 'search this http://x|y|z')
    assert.equal(r[0].priority, 'broad')
    assert.equal(r[0].domain, 'ru')
  })

  test('invalid trailing keyword folds back into query', () => {
    const r = parseQueriesText('a|q|focused|notadomain')
    assert.equal(r[0].query, 'q|focused|notadomain')
    assert.equal(r[0].priority, 'broad')
    assert.equal(r[0].domain, 'general')
  })

  test('wrong order (domain before priority) only matches single trailing', () => {
    const r = parseQueriesText('a|q|scholarly|focused')
    assert.equal(r[0].priority, 'focused')
    // 'scholarly' stays as part of the query since clause 1 requires (priority, domain) order.
    assert.ok(r[0].query.includes('scholarly'))
  })

  test('skips empty lines and comments', () => {
    const r = parseQueriesText('# comment\n\na|q\n# another\nb|r|focused')
    assert.equal(r.length, 2)
    assert.equal(r[0].label, 'a')
    assert.equal(r[1].label, 'b')
  })

  test('auto-labels lines without separator', () => {
    const r = parseQueriesText('just a bare query')
    assert.equal(r.length, 1)
    assert.equal(r[0].label, 'q01')
    assert.equal(r[0].query, 'just a bare query')
    assert.equal(r[0].priority, 'broad')
    assert.equal(r[0].domain, 'general')
  })
})

describe('AcademicBackend interface', () => {
  test('extends SearchBackend and exposes name', async () => {
    const { AcademicBackend } = await import('../../../src/backends/academic.js')
    const b = new AcademicBackend()
    assert.equal(b.name, 'academic')
    assert.equal(typeof b.search, 'function')
  })
})
