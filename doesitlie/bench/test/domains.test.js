// Tests for bench/domains.js — per-domain honesty breakdown + χ² independence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { domainBreakdown, DEFAULT_DOMAIN } from '../domains.js'

const r = (verdict, domain) => ({ claim: 'c', source_url: 'u', verdict, ...(domain ? { domain } : {}) })

test('untagged citations default to the legal domain (no fabrication)', () => {
  const audit = [{ agent: 'X', results: [r('Supported'), r('Unsupported')] }]
  const b = domainBreakdown(audit)
  assert.equal(b.n_domains, 1)
  assert.equal(b.domains[0].domain, DEFAULT_DOMAIN)
  assert.equal(b.domains[0].total, 2)
  assert.equal(b.chi2.applicable, false) // single domain → no test
})

test('per-domain counts + scorable exclude Error from the rate denominator correctly', () => {
  const audit = [{
    agent: 'X',
    results: [r('Supported', 'tech'), r('Fabricated', 'tech'), r('Error', 'tech'), r('Supported', 'tech')]
  }]
  const d = domainBreakdown(audit).domains[0]
  assert.equal(d.domain, 'tech')
  assert.equal(d.total, 4)
  assert.equal(d.scorable, 3)             // Error excluded
  assert.equal(d.counts.Fabricated, 1)
  assert.equal(d.notFully, 1)             // only the Fabricated
  assert.ok(Math.abs(d.notFullyRate - 1 / 3) < 1e-3) // rates rounded to 4dp for clean JSON
  assert.ok(d.notFullyCI.low >= 0 && d.notFullyCI.high <= 1) // Wilson CI present + bounded
  assert.ok(Math.abs(d.fabricatedRate - 0.25) < 1e-6)        // Fabricated over ALL cites
})

test('χ² activates with ≥2 domains and reports an interpretation', () => {
  // legal honest, tech dishonest → distributions clearly differ
  const legal = Array.from({ length: 40 }, () => r('Supported', 'legal'))
    .concat(Array.from({ length: 10 }, () => r('Unsupported', 'legal')))
  const tech = Array.from({ length: 10 }, () => r('Supported', 'tech'))
    .concat(Array.from({ length: 40 }, () => r('Unsupported', 'tech')))
  const b = domainBreakdown([{ agent: 'X', results: [...legal, ...tech] }])
  assert.equal(b.n_domains, 2)
  assert.equal(b.chi2.applicable, true)
  assert.equal(b.chi2.df, 3) // (2 domains - 1) × (4 verdicts - 1)
  assert.ok(b.chi2.pValue < 0.05, `expected significant difference, got p=${b.chi2.pValue}`)
  assert.ok(/differs significantly/.test(b.chi2.interpretation))
  assert.ok(b.chi2.cramersV > 0)
})

test('χ² flags small expected cell counts (validity caveat)', () => {
  const b = domainBreakdown([{ agent: 'X', results: [r('Supported', 'a'), r('Unsupported', 'b')] }])
  assert.equal(b.chi2.applicable, true)
  assert.equal(b.chi2.lowExpectedWarning, true)
})

test('handles empty / malformed audit without throwing', () => {
  assert.equal(domainBreakdown([]).n_domains, 0)
  assert.equal(domainBreakdown(null).n_domains, 0)
  assert.equal(domainBreakdown([{ agent: 'X' }]).n_domains, 0) // no results array
})
