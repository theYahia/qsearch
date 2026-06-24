// qsearch RaaS — test suite (node:test, matches `node --test`).
//
// Covers the whole pipeline: tier classification, the triangulation gate (the product),
// markdown source-gathering, the verify adapter (with an injected fake verifier — no live judge),
// and an end-to-end runBrief → renderReport/buildAudit on the offline fixture.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { registrableDomain, meetsFloor, isExcluded, tierOf, tierRank } from '../../../src/raas/tiers.js'
import { gateClaim, confidenceSummary, DEFAULT_GATE } from '../../../src/raas/triangulate.js'
import { sweepBody, parseSweepMarkdown, loadCandidatesFromFixture } from '../../../src/raas/gather.js'
import { verifyClaim, setVerifier } from '../../../src/raas/verify.js'
import { runBrief } from '../../../src/raas/pipeline.js'
import { renderReport, buildAudit } from '../../../src/raas/report.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(__dirname, '..', '..', '..', 'src', 'raas', 'examples', 'candidates.fixture.json')

// helper: a supported source on a domain at a given tier
const S = (url, tier) => ({ source_url: url, verdict: 'Supported', tier, evidence: 'q' })

// ── tiers ───────────────────────────────────────────────────────────────────

test('registrableDomain strips www and keeps eTLD+1', () => {
  assert.equal(registrableDomain('https://www.clearbrief.com/pricing'), 'clearbrief.com')
  assert.equal(registrableDomain('https://legaltechhub.com/x'), 'legaltechhub.com')
  assert.equal(registrableDomain('not a url'), '')
})

test('registrableDomain handles two-label public suffixes (independence key)', () => {
  // legislation.gov.uk and parliament.gov.uk must be DISTINCT registrable domains, not both "gov.uk"
  assert.equal(registrableDomain('https://www.legislation.gov.uk/ukpga/2018/12'), 'legislation.gov.uk')
  assert.equal(registrableDomain('https://services.parliament.gov.uk/bills'), 'parliament.gov.uk')
  assert.notEqual(registrableDomain('https://a.gov.uk/x'), registrableDomain('https://b.gov.uk/y'))
})

test('meetsFloor ranks 1A/1B above press/community', () => {
  assert.equal(meetsFloor('1B', '2'), true)
  assert.equal(meetsFloor('4', '2'), false)
  assert.equal(meetsFloor('2', '2'), true)
  assert.equal(meetsFloor('1A', '1B'), true)
})

test('tierOf maps known domains, walks subdomains, and falls back on provenance', () => {
  assert.equal(tierOf({ url: 'https://arxiv.org/abs/1' }), '1A')
  // full-host seed entry must match even though eTLD+1 is nih.gov
  assert.equal(tierOf({ url: 'https://pubmed.ncbi.nlm.nih.gov/123' }), '1A')
  assert.equal(tierOf({ url: 'https://www.reuters.com/legal/x' }), '2')
  assert.equal(tierOf({ url: 'https://unknown.io/x', engine_count: 4 }), '3')   // multi-engine → 3
  assert.equal(tierOf({ url: 'https://unknown.io/x', engine_count: 1 }), '4')   // single-engine → 4
  assert.equal(tierOf({ url: 'https://unknown.io/x' }), '4')                     // no provenance → 4
})

test('isExcluded flags the seed content-farm domain (and not real sources)', () => {
  assert.equal(isExcluded({ url: 'https://example-content-farm.com/x' }), true)
  assert.equal(isExcluded({ url: 'https://sub.example-content-farm.com/x' }), true) // walks host chain
  assert.equal(isExcluded({ url: 'https://arxiv.org/abs/1234' }), false)
})

test('tierRank orders tiers monotonically', () => {
  assert.ok(tierRank('1A') < tierRank('1B'))
  assert.ok(tierRank('1B') < tierRank('2'))
  assert.ok(tierRank('2') < tierRank('4'))
  assert.equal(tierRank('nonsense'), 99)
})

// ── the triangulation gate (the product) ─────────────────────────────────────

test('gateClaim passes with 3 distinct supporting domains + a 1B anchor', () => {
  const v = gateClaim([
    S('https://arxiv.org/abs/1', '1A'),
    S('https://reuters.com/a', '2'),
    S('https://gov.uk/guidance', '1B')
  ])
  assert.equal(v.triangulated, true)
  assert.equal(v.status, 'triangulated')
  assert.equal(v.independentSupporting, 3)
  assert.equal(v.supportingDomains.length, 3)
})

test('gateClaim fails when 3 Supported share ONE domain (independence rule)', () => {
  const v = gateClaim([
    S('https://reuters.com/a', '2'),
    S('https://reuters.com/b', '2'),
    S('https://reuters.com/c', '2')
  ])
  assert.equal(v.triangulated, false)
  assert.equal(v.independentSupporting, 1)
  assert.match(v.reason, /independent supporting domain/)
})

test('gateClaim fails without a high-authority anchor even with 3 distinct domains', () => {
  // three tier-2 press sources: meet the tier-2 floor but none meets the 1B anchor → low-confidence
  const v = gateClaim([
    S('https://reuters.com/a', '2'),
    S('https://bloomberg.com/b', '2'),
    S('https://ft.com/c', '2')
  ])
  assert.equal(v.triangulated, false)
  assert.equal(v.independentSupporting, 3)
  assert.match(v.reason, /authority anchor/)
})

test('gateClaim does NOT count Partial/Fabricated/Error/Unsupported toward the gate', () => {
  const v = gateClaim([
    S('https://arxiv.org/abs/1', '1A'),
    { source_url: 'https://reuters.com/a', verdict: 'Partial', tier: '2' },
    { source_url: 'https://bloomberg.com/b', verdict: 'Fabricated', tier: '2' },
    { source_url: 'https://ft.com/c', verdict: 'Error', tier: '2' },
    { source_url: 'https://gov.uk/x', verdict: 'Unsupported', tier: '1B' }
  ])
  assert.equal(v.independentSupporting, 1) // only the arxiv Supported counts
  assert.equal(v.triangulated, false)
})

test('gateClaim drops sources below the tier floor (community sources do not count)', () => {
  const v = gateClaim([
    S('https://arxiv.org/abs/1', '1A'),
    S('https://reuters.com/a', '2'),
    S('https://reddit.com/r/x', '4') // below tier-2 floor → excluded
  ])
  assert.equal(v.independentSupporting, 2) // reddit dropped → only 2 → fails the ≥3 rule
  assert.equal(v.triangulated, false)
})

test('gateClaim ≥3-independent-sources rule (CLAUDE.md heavy-max gate) holds at the boundary', () => {
  const two = gateClaim([S('https://arxiv.org/1', '1A'), S('https://gov.uk/2', '1B')])
  assert.equal(two.triangulated, false) // 2 < 3
  const three = gateClaim([S('https://arxiv.org/1', '1A'), S('https://gov.uk/2', '1B'), S('https://reuters.com/3', '2')])
  assert.equal(three.triangulated, true) // exactly 3 distinct, anchor present
})

test('gateClaim respects a custom gate config', () => {
  const v = gateClaim(
    [S('https://a.io/1', '3'), S('https://b.io/2', '3')],
    { minIndependent: 2, tierFloor: '3', requireOneAtLeast: '3' }
  )
  assert.equal(v.triangulated, true)
})

test('confidenceSummary computes the triangulated share (drives the <50% tripwire)', () => {
  const s = confidenceSummary([
    { triangulated: true }, { triangulated: false }, { triangulated: true }, { triangulated: true }
  ])
  assert.equal(s.total, 4)
  assert.equal(s.triangulated, 3)
  assert.equal(s.lowConfidence, 1)
  assert.equal(s.triangulatedShare, 0.75)
  assert.equal(confidenceSummary([]).triangulatedShare, 0)
})

// ── gather ────────────────────────────────────────────────────────────────────

test('sweepBody renders label|query|priority lines', () => {
  assert.equal(sweepBody({ id: 'c1', queries: ['a', 'b'], priority: 'focused' }), 'c1_0|a|focused\nc1_1|b|focused\n')
  assert.equal(sweepBody({ id: 'c9', queries: ['x'] }), 'c9_0|x|focused\n') // default priority focused
})

test('parseSweepMarkdown extracts url+title+engine_count and dedupes by url', () => {
  const md = [
    '## c1_0 — "q"',
    '### 🔎 Web (3 results)',
    '**1. Clearbrief Pricing**',
    '- URL: https://www.clearbrief.com/pricing',
    '- Engines: brave, searxng (count=2)',
    '  > snippet text',
    '**2. A review**',
    '- URL: https://legaltechhub.com/review',
    '- Engines: brave (count=1)',
    '**3. Duplicate, richer provenance**',
    '- URL: https://www.clearbrief.com/pricing',
    '- Engines: brave, searxng, yandex (count=3)'
  ].join('\n')
  const got = parseSweepMarkdown(md)
  assert.equal(got.length, 2) // deduped clearbrief
  const cb = got.find(c => c.url === 'https://www.clearbrief.com/pricing')
  assert.equal(cb.engine_count, 3) // kept the richer provenance
  assert.equal(cb.title, 'Clearbrief Pricing') // first title retained
  assert.ok(got.some(c => c.url === 'https://legaltechhub.com/review'))
})

test('parseSweepMarkdown is safe on empty / malformed input', () => {
  assert.deepEqual(parseSweepMarkdown(''), [])
  assert.deepEqual(parseSweepMarkdown('no results here'), [])
  assert.deepEqual(parseSweepMarkdown(null), [])
})

test('loadCandidatesFromFixture reads the offline candidate set', async () => {
  const c1 = await loadCandidatesFromFixture(FIXTURE, 'c1')
  assert.ok(Array.isArray(c1) && c1.length === 3)
  assert.equal(c1[0].url, 'https://www.clearbrief.com/pricing')
  const missing = await loadCandidatesFromFixture(FIXTURE, 'nope')
  assert.deepEqual(missing, [])
})

// ── verify adapter (injected fake verifier — no live judge) ────────────────────

test('verifyClaim returns one tiered verdict per candidate (Fabricated/Error kept, not dropped)', async () => {
  setVerifier(async ({ url }) => {
    if (url.includes('dead')) return { verdict: 'Fabricated', evidence: '', excerpt: '' }
    if (url.includes('timeout')) return { verdict: 'Error', evidence: '', excerpt: '', error: 'judge failed' }
    return { verdict: 'Supported', evidence: 'the page says X', excerpt: 'X is stated here' }
  })
  try {
    const out = await verifyClaim('claim text', [
      { url: 'https://arxiv.org/ok', engine_count: 4 },
      { url: 'https://dead.example/gone' },
      { url: 'https://timeout.example/slow' }
    ])
    assert.equal(out.length, 3) // nothing dropped
    assert.equal(out[0].verdict, 'Supported')
    assert.equal(out[0].tier, '1A')          // tier attached from tierOf
    assert.equal(out[0].evidence, 'the page says X')
    assert.equal(out[1].verdict, 'Fabricated')
    assert.equal(out[2].verdict, 'Error')
  } finally {
    setVerifier(null)
  }
})

// ── end-to-end: runBrief → renderReport / buildAudit (offline, stubbed verifier) ─

test('runBrief → renderReport flags low-confidence + tripwire when sources are weak (default gate)', async () => {
  // Fixture sources are vendor/community (tier 3/4) → none meet the default tier-2 floor → low-confidence.
  setVerifier(async () => ({ verdict: 'Supported', evidence: 'stub', excerpt: 'stub excerpt' }))
  try {
    const brief = {
      question: 'WTP for AI citation tools?',
      candidatesFixture: FIXTURE,
      claims: [
        { id: 'c1', text: 'Clearbrief charges $300/user/mo.', queries: ['x'] },
        { id: 'c2', text: 'Nevada Bar rated it 40.5/50.', queries: ['y'] }
      ]
    }
    const input = await runBrief(brief, { judge: 'stub-judge', now: '2026-06-24T00:00:00Z' })
    assert.equal(input.claims.length, 2)
    assert.equal(input.meta.judge, 'stub-judge')

    const md = renderReport(input)
    assert.match(md, /# WTP for AI citation tools\?/)
    assert.match(md, /NOT ship-ready/)          // <50% triangulated tripwire fired
    assert.match(md, /⚠ low-confidence/)        // both claims flagged
    assert.match(md, /re-check any row in audit\.json/)

    const audit = buildAudit(input)
    assert.equal(audit.claims.length, 2)
    assert.equal(audit.claims[0].status, 'low-confidence')
    assert.ok(audit.claims[0].sources.length >= 2) // sources retained for the receipt
    assert.equal(audit.summary.total, 2)
  } finally {
    setVerifier(null)
  }
})

test('runBrief triangulates when the gate floor admits the available sources', async () => {
  // Lower the floor so the fixture's tier-3/4 vendor+community sources count → claims triangulate.
  setVerifier(async ({ url }) => ({
    verdict: url.includes('reddit') ? 'Unsupported' : 'Supported',
    evidence: 'stub', excerpt: 'stub'
  }))
  try {
    const brief = {
      question: 'q',
      candidatesFixture: FIXTURE,
      claims: [{ id: 'c1', text: 'claim', queries: ['x'] }]
    }
    const input = await runBrief(brief, {
      judge: 'stub', now: '2026-06-24T00:00:00Z',
      gate: { minIndependent: 2, tierFloor: '4', requireOneAtLeast: '4' }
    })
    // c1 fixture: clearbrief(t3,Supported) + legaltechhub(t3,Supported) + reddit(t4,Unsupported)
    // → 2 distinct supporting domains at floor 4, anchor 4 satisfied → triangulated
    assert.equal(input.claims[0].verdict.triangulated, true)
    const md = renderReport(input)
    assert.match(md, /✓ triangulated/)
    assert.doesNotMatch(md, /NOT ship-ready/)
  } finally {
    setVerifier(null)
  }
})

test('renderReport escapes pipe characters so the markdown table never breaks', () => {
  const input = {
    question: 'q | with pipe',
    meta: { judge: 'j', generatedAt: 't' },
    claims: [{
      claim: { id: 'c1', text: 'a | b | c' },
      verdict: { triangulated: false, status: 'low-confidence', independentSupporting: 0, supportingDomains: [], reason: 'r', sources: [{ source_url: 'https://x.io/a?q=1|2', tier: '3', verdict: 'Partial', evidence: 'ev | with | pipes' }] }
    }]
  }
  const md = renderReport(input)
  assert.match(md, /a \\\| b \\\| c/)        // claim text pipes escaped
  assert.match(md, /ev \\\| with \\\| pipes/) // evidence pipes escaped
})
