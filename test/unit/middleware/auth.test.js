import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { checkAuth, isLoopbackBind, remoteIp, parseAllowlist } from '../../../src/middleware/auth.js'

function reqWith ({ headers = {}, ip = '203.0.113.5' } = {}) {
  return { headers, socket: { remoteAddress: ip } }
}

describe('auth — isLoopbackBind', () => {
  test('recognizes loopback binds', () => {
    assert.ok(isLoopbackBind('127.0.0.1'))
    assert.ok(isLoopbackBind('localhost'))
    assert.ok(isLoopbackBind('::1'))
  })
  test('non-loopback binds are not loopback', () => {
    assert.equal(isLoopbackBind('0.0.0.0'), false)
    assert.equal(isLoopbackBind('192.168.1.10'), false)
  })
})

describe('auth — parseAllowlist', () => {
  test('splits on semicolons and trims', () => {
    assert.deepEqual(parseAllowlist(' 1.2.3.4 ; 5.6.7.8 '), ['1.2.3.4', '5.6.7.8'])
  })
  test('empty → []', () => {
    assert.deepEqual(parseAllowlist(''), [])
    assert.deepEqual(parseAllowlist(undefined), [])
  })
})

describe('auth — remoteIp', () => {
  test('unwraps IPv4-mapped IPv6', () => {
    assert.equal(remoteIp({ socket: { remoteAddress: '::ffff:1.2.3.4' } }), '1.2.3.4')
  })
  test('ignores X-Forwarded-For unless trustProxy', () => {
    const req = { headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '1.1.1.1' } }
    assert.equal(remoteIp(req), '1.1.1.1')
    assert.equal(remoteIp(req, { trustProxy: true }), '9.9.9.9')
  })
})

describe('auth — checkAuth', () => {
  test('loopback bind always passes (no auth needed locally)', () => {
    const r = checkAuth(reqWith(), { bind: '127.0.0.1' })
    assert.equal(r.ok, true)
    assert.equal(r.reason, 'loopback')
  })

  test('non-loopback with valid X-API-Key passes', () => {
    const r = checkAuth(reqWith({ headers: { 'x-api-key': 'secret123' } }), { bind: '0.0.0.0', apiKey: 'secret123' })
    assert.equal(r.ok, true)
    assert.equal(r.reason, 'api_key')
  })

  test('non-loopback with valid Bearer token passes', () => {
    const r = checkAuth(reqWith({ headers: { authorization: 'Bearer secret123' } }), { bind: '0.0.0.0', apiKey: 'secret123' })
    assert.equal(r.ok, true)
  })

  test('non-loopback with wrong key → 403', () => {
    const r = checkAuth(reqWith({ headers: { 'x-api-key': 'wrong' } }), { bind: '0.0.0.0', apiKey: 'secret123' })
    assert.equal(r.ok, false)
    assert.equal(r.status, 403)
  })

  test('non-loopback with no credentials → 401', () => {
    const r = checkAuth(reqWith(), { bind: '0.0.0.0', apiKey: 'secret123' })
    assert.equal(r.ok, false)
    assert.equal(r.status, 401)
  })

  test('non-loopback IP allowlist hit passes without key', () => {
    const r = checkAuth(reqWith({ ip: '203.0.113.5' }), { bind: '0.0.0.0', ipAllowlist: ['203.0.113.5'] })
    assert.equal(r.ok, true)
    assert.equal(r.reason, 'ip_allowlist')
  })

  test('non-loopback IP not in allowlist and no key → 401', () => {
    const r = checkAuth(reqWith({ ip: '198.51.100.9' }), { bind: '0.0.0.0', ipAllowlist: ['203.0.113.5'] })
    assert.equal(r.ok, false)
  })

  test('non-loopback with nothing configured → 401 no_auth_configured (never fail open)', () => {
    const r = checkAuth(reqWith(), { bind: '0.0.0.0' })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'no_auth_configured')
  })
})
