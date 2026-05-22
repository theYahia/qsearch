import { test, describe } from 'node:test'
import assert from 'node:assert'
import { assertPublicHost } from '../../../src/fetch/html.js'

// SSRF guard (CSO-OPS 2026-05-21 P1-1). assertPublicHost must reject any URL whose
// host is a literal private/loopback/link-local IP, and reject non-http(s) schemes.
// DNS-resolving hosts are not asserted here (network-dependent) — covered by the
// literal-IP cases which exercise the same ipIsBlocked logic.

describe('assertPublicHost — SSRF guard', () => {
  const blocked = [
    'http://127.0.0.1:7700/keys',          // Meilisearch admin
    'http://localhost:6333/collections',    // resolves to loopback
    'http://10.0.0.5/',                      // 10/8
    'http://172.16.0.1/',                    // 172.16/12
    'http://172.31.255.1/',                  // 172.16/12 upper
    'http://192.168.1.50:8080/sweep',        // 192.168/16
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://100.64.0.1/',                    // CGNAT 100.64/10
    'http://0.0.0.0/',                       // 0/8
    'http://[::1]/',                          // IPv6 loopback
    'http://[fe80::1]/',                      // IPv6 link-local
    'http://[fc00::1]/'                       // IPv6 ULA
  ]
  for (const url of blocked) {
    test(`rejects ${url}`, async () => {
      await assert.rejects(() => assertPublicHost(url), /SSRF blocked/)
    })
  }

  test('rejects non-http(s) scheme', async () => {
    await assert.rejects(() => assertPublicHost('file:///etc/passwd'), /SSRF blocked/)
    await assert.rejects(() => assertPublicHost('ftp://192.168.0.1/'), /SSRF blocked/)
  })

  test('rejects malformed URL', async () => {
    await assert.rejects(() => assertPublicHost('not a url'), /SSRF blocked/)
  })

  test('allows a public literal IP (8.8.8.8)', async () => {
    await assert.doesNotReject(() => assertPublicHost('http://8.8.8.8/'))
  })
})
