// Unit coverage for renderMarkdown — the sole export of src/sweep/parsed_snippets.js.
// Pure function, no IO: (results: Map<label, entry>, queries: [{label, query}], stats) -> markdown string.
// We pin deterministic substrings/lines and exercise every branch: warnings block,
// per-query failure/zero/no-result/normal paths, extra_snippets JSON-vs-quote rendering,
// LLM Context grounding, slice() truncation caps, and the summary block (incl. conditional
// web_zero_recovered + by_priority). The only non-deterministic piece is the ISO "Generated"
// timestamp, which we assert structurally (line exists) rather than by exact value.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../../../src/sweep/parsed_snippets.js'

// Minimal stats object with the always-present fields renderMarkdown reads unconditionally.
const baseStats = (over = {}) => ({
  duration_ms: 0,
  web_ok: 0,
  web_fail: 0,
  total_deduped: 0,
  ...over
})

describe('renderMarkdown — header & shell', () => {
  test('empty sweep: header reports 0 queries, fixed config lines, no warnings block', () => {
    const md = renderMarkdown(new Map(), [], baseStats())
    assert.match(md, /^# qsearch sweep — 0 queries\n/)
    assert.ok(md.includes('**Config:** extra_snippets=on'))
    assert.ok(md.includes('**Endpoints used:** web'))
    // Generated line is present and ISO-ish; value itself is time-dependent so just structural.
    assert.match(md, /\*\*Generated:\*\* \d{4}-\d{2}-\d{2}T.*\| \*\*Script:\*\* qsearch sweep/)
    // No queries failed/zero -> the warnings section must not appear.
    assert.ok(!md.includes('## ⚠️ Sweep warnings'))
  })

  test('header n reflects queries.length (not results.size)', () => {
    const queries = [
      { label: 'a', query: 'q a' },
      { label: 'b', query: 'q b' },
      { label: 'c', query: 'q c' }
    ]
    // results map intentionally empty -> n still counts queries
    const md = renderMarkdown(new Map(), queries, baseStats())
    assert.match(md, /^# qsearch sweep — 3 queries\n/)
  })

  test('TOS disclaimer is appended at the very end', () => {
    const md = renderMarkdown(new Map(), [], baseStats())
    assert.ok(md.endsWith('_Data retrieved via qsearch (SearXNG + Brave). For internal research only._\n'))
  })
})

describe('renderMarkdown — warnings block', () => {
  test('zero-result + failed labels are collected into the top warnings section', () => {
    const queries = [
      { label: 'zr', query: 'z' },
      { label: 'boom', query: 'b' },
      { label: 'ok1', query: 'o' }
    ]
    const results = new Map([
      ['zr', { ok: false, reason: 'zero_results' }],
      ['boom', { ok: false, error: 'HTTP 500' }],
      ['ok1', { ok: true, results: [{ title: 'T', url: 'http://x' }] }]
    ])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1, web_fail: 1, web_zero: 1 }))

    assert.ok(md.includes('## ⚠️ Sweep warnings'))
    assert.ok(md.includes('**Zero-result queries (1):** zr'))
    assert.ok(md.includes('**Failed queries (1):**'))
    assert.ok(md.includes('- `boom` — HTTP 500'))
    // ok query must NOT show up in warnings
    assert.ok(!/Zero-result queries.*ok1/.test(md))
  })

  test("failed entry without .error falls back to 'unknown' in warnings list", () => {
    const queries = [{ label: 'mystery', query: 'm' }]
    const results = new Map([['mystery', { ok: false }]]) // no reason, no error
    const md = renderMarkdown(results, queries, baseStats({ web_fail: 1 }))
    assert.ok(md.includes('**Failed queries (1):**'))
    assert.ok(md.includes('- `mystery` — unknown'))
  })

  test('multiple zero-result labels are comma-joined with correct count', () => {
    const queries = [
      { label: 'z1', query: '1' },
      { label: 'z2', query: '2' }
    ]
    const results = new Map([
      ['z1', { ok: false, reason: 'zero_results' }],
      ['z2', { ok: false, reason: 'zero_results' }]
    ])
    const md = renderMarkdown(results, queries, baseStats({ web_zero: 2 }))
    assert.ok(md.includes('**Zero-result queries (2):** z1, z2'))
    // no failed sub-block when there are no non-zero failures
    assert.ok(!md.includes('**Failed queries'))
  })

  test('queries with no map entry are skipped in warnings collection (continue branch)', () => {
    const queries = [{ label: 'ghost', query: 'g' }]
    const md = renderMarkdown(new Map(), queries, baseStats())
    // no entry -> not counted as zero or failed -> no warnings section
    assert.ok(!md.includes('## ⚠️ Sweep warnings'))
  })
})

describe('renderMarkdown — per-query failure / zero / empty paths', () => {
  test('missing entry renders generic "Failed: unknown error" stanza', () => {
    const queries = [{ label: 'missing', query: 'the query' }]
    const md = renderMarkdown(new Map(), queries, baseStats())
    assert.ok(md.includes('## missing — "the query"'))
    assert.ok(md.includes('_Failed: unknown error_'))
  })

  test('entry with reason=zero_results renders the ZERO RESULTS tag', () => {
    const queries = [{ label: 'zq', query: 'qq' }]
    const results = new Map([['zq', { ok: false, reason: 'zero_results' }]])
    const md = renderMarkdown(results, queries, baseStats({ web_zero: 1 }))
    assert.ok(md.includes('_⚠️ ZERO RESULTS (after retry)_'))
  })

  test('failed entry surfaces its .error string in the per-query stanza', () => {
    const queries = [{ label: 'eq', query: 'qq' }]
    const results = new Map([['eq', { ok: false, error: 'timeout after 5s' }]])
    const md = renderMarkdown(results, queries, baseStats({ web_fail: 1 }))
    assert.ok(md.includes('_Failed: timeout after 5s_'))
  })

  test('ok entry with empty results array renders "_No results_"', () => {
    const queries = [{ label: 'empty', query: 'e' }]
    const results = new Map([['empty', { ok: true, results: [] }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('## empty — "e"'))
    assert.ok(md.includes('_No results_'))
    // must NOT render a Web results header for empty
    assert.ok(!md.includes('### 🔎 Web'))
  })
})

describe('renderMarkdown — normal result rendering', () => {
  test('single full result renders title/url/engines/description/age + quoted snippet', () => {
    const queries = [{ label: 'q', query: 'full' }]
    const results = new Map([['q', {
      ok: true,
      results: [{
        title: 'Hello World',
        url: 'https://example.com/a',
        engines: ['brave', 'google'],
        description: 'A description here',
        age: '2 days ago',
        extra_snippets: ['plain text snippet']
      }]
    }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('### 🔎 Web (1 results)'))
    assert.ok(md.includes('**1. Hello World**'))
    assert.ok(md.includes('- URL: https://example.com/a'))
    assert.ok(md.includes('- Engines: brave, google (count=2)'))
    assert.ok(md.includes('- A description here'))
    assert.ok(md.includes('- Age: 2 days ago'))
    assert.ok(md.includes('  > plain text snippet'))
  })

  test('missing/empty optional fields are omitted; (no title) fallback fires', () => {
    const queries = [{ label: 'q', query: 'min' }]
    const results = new Map([['q', {
      ok: true,
      results: [{ url: 'https://min.example' }] // no title/engines/description/age/snippets
    }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('**1. (no title)**'))
    assert.ok(md.includes('- URL: https://min.example'))
    // engines line absent (not an array) ...
    assert.ok(!md.includes('- Engines:'))
    // ... description and age lines absent
    assert.ok(!md.includes('\n- A description'))
    assert.ok(!md.includes('- Age:'))
  })

  test('empty engines array does not emit an Engines line (length guard)', () => {
    const queries = [{ label: 'q', query: 'eng' }]
    const results = new Map([['q', {
      ok: true,
      results: [{ title: 'T', url: 'u', engines: [] }]
    }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(!md.includes('- Engines:'))
  })

  test('only first 10 of >10 results are rendered, header still shows true count', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `R${i}`, url: `https://e/${i}` }))
    const queries = [{ label: 'q', query: 'many' }]
    const results = new Map([['q', { ok: true, results: many }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('### 🔎 Web (12 results)')) // header = real length
    assert.ok(md.includes('**10. R9**')) // 10th item present
    assert.ok(!md.includes('**11. R10**')) // 11th sliced off
    assert.ok(!md.includes('R11'))
  })

  test('title is truncated to 140 chars', () => {
    const longTitle = 'T'.repeat(200)
    const queries = [{ label: 'q', query: 'long' }]
    const results = new Map([['q', { ok: true, results: [{ title: longTitle, url: 'u' }] }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('**1. ' + 'T'.repeat(140) + '**'))
    assert.ok(!md.includes('T'.repeat(141)))
  })

  test('description is truncated to 400 chars', () => {
    const longDesc = 'D'.repeat(500)
    const queries = [{ label: 'q', query: 'd' }]
    const results = new Map([['q', { ok: true, results: [{ title: 'T', url: 'u', description: longDesc }] }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('- ' + 'D'.repeat(400)))
    assert.ok(!md.includes('D'.repeat(401)))
  })

  test('only first 5 extra_snippets rendered, each truncated to 500 chars', () => {
    const snippets = Array.from({ length: 7 }, (_, i) => `snip${i}`)
    snippets[0] = 'X'.repeat(600) // first one long, to check 500 cap
    const queries = [{ label: 'q', query: 's' }]
    const results = new Map([['q', { ok: true, results: [{ title: 'T', url: 'u', extra_snippets: snippets }] }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('  > ' + 'X'.repeat(500)))
    assert.ok(!md.includes('X'.repeat(501)))
    assert.ok(md.includes('  > snip4')) // 5th snippet (index 4) present
    assert.ok(!md.includes('snip5')) // 6th sliced off
    assert.ok(!md.includes('snip6'))
  })

  test('JSON-looking snippet (starts with { or [) renders inside a ```json fence', () => {
    const queries = [{ label: 'q', query: 'json' }]
    const results = new Map([['q', {
      ok: true,
      results: [{ title: 'T', url: 'u', extra_snippets: ['{"k":1}', '[1,2,3]', 'normal'] }]
    }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    // fenced json blocks (note leading two-space indent on fence and content)
    assert.ok(md.includes('  ```json\n  {"k":1}\n  ```'))
    assert.ok(md.includes('  ```json\n  [1,2,3]\n  ```'))
    // plain snippet still quoted, not fenced
    assert.ok(md.includes('  > normal'))
  })

  test('whitespace-leading JSON snippet still detected as JSON (trim before check)', () => {
    const queries = [{ label: 'q', query: 'jsonws' }]
    const results = new Map([['q', {
      ok: true,
      results: [{ title: 'T', url: 'u', extra_snippets: ['   {"a":2}'] }]
    }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    // trim() decides JSON, but the rendered content keeps original (untrimmed) string after the fence line
    assert.ok(md.includes('  ```json\n     {"a":2}\n  ```'))
  })
})

describe('renderMarkdown — LLM Context grounding (critical tier)', () => {
  test('context_grounding renders a 📚 LLM Context section with titles/urls/snippets', () => {
    const queries = [{ label: 'q', query: 'crit' }]
    const results = new Map([['q', {
      ok: true,
      results: [{ title: 'web', url: 'https://web.example' }],
      context_grounding: [
        { title: 'Source A', url: 'https://a.example', snippets: ['excerpt one', 'excerpt two'] },
        { title: 'Source B', url: 'https://b.example', snippets: [] }
      ]
    }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('### 📚 LLM Context (2 sources)'))
    assert.ok(md.includes('**1. Source A**'))
    assert.ok(md.includes('- URL: https://a.example'))
    assert.ok(md.includes('  > excerpt one'))
    assert.ok(md.includes('  > excerpt two'))
    assert.ok(md.includes('**2. Source B**'))
  })

  test('grounding entry without url omits the URL line; (no title) fallback fires', () => {
    const queries = [{ label: 'q', query: 'g' }]
    const results = new Map([['q', {
      ok: true,
      results: [{ title: 'web', url: 'u' }],
      context_grounding: [{ snippets: ['only snippet'] }] // no title, no url
    }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('### 📚 LLM Context (1 sources)'))
    assert.ok(md.includes('**1. (no title)**'))
    assert.ok(md.includes('  > only snippet'))
    // there is no grounding URL line; the only "- URL:" present is the web result's
    const urlLines = md.split('\n').filter(l => l.startsWith('- URL:'))
    assert.equal(urlLines.length, 1)
    assert.equal(urlLines[0], '- URL: u')
  })

  test('grounding snippets capped at 5 and truncated to 500', () => {
    const snippets = Array.from({ length: 7 }, (_, i) => `g${i}`)
    snippets[0] = 'Y'.repeat(600)
    const queries = [{ label: 'q', query: 'gcap' }]
    const results = new Map([['q', {
      ok: true,
      results: [{ title: 'w', url: 'u' }],
      context_grounding: [{ title: 'S', url: 's', snippets }]
    }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(md.includes('  > ' + 'Y'.repeat(500)))
    assert.ok(!md.includes('Y'.repeat(501)))
    assert.ok(md.includes('  > g4')) // 5th present
    assert.ok(!md.includes('  > g5')) // 6th sliced
  })

  test('empty/absent context_grounding produces no LLM Context section', () => {
    const queries = [{ label: 'q', query: 'noctx' }]
    const results = new Map([['q', {
      ok: true,
      results: [{ title: 'w', url: 'u' }],
      context_grounding: [] // empty array -> length guard fails
    }]])
    const md = renderMarkdown(results, queries, baseStats({ web_ok: 1 }))
    assert.ok(!md.includes('### 📚 LLM Context'))
  })
})

describe('renderMarkdown — summary block', () => {
  test('summary reports totals, ok/fail/zero, duration (1 decimal), deduped', () => {
    const queries = [{ label: 'q', query: 'x' }]
    const results = new Map([['q', { ok: true, results: [{ title: 'T', url: 'u' }] }]])
    const stats = baseStats({
      duration_ms: 12340,
      web_ok: 5,
      web_fail: 2,
      web_zero: 3,
      total_deduped: 17
    })
    const md = renderMarkdown(results, queries, stats)
    assert.ok(md.includes('## Sweep summary'))
    assert.ok(md.includes('- Total queries: 1'))
    assert.ok(md.includes('- Web: 5 ok / 2 failed / 3 zero-result'))
    assert.ok(md.includes('- Duration: 12.3s')) // 12340ms -> 12.3s via toFixed(1)
    assert.ok(md.includes('- Deduped: 17 URLs removed'))
  })

  test('web_zero defaults to 0 when absent', () => {
    const md = renderMarkdown(new Map(), [], baseStats({ web_ok: 1, web_fail: 0 }))
    assert.ok(md.includes('- Web: 1 ok / 0 failed / 0 zero-result'))
  })

  test('web_zero_recovered line only appears when truthy', () => {
    const withRecover = renderMarkdown(new Map(), [], baseStats({ web_zero_recovered: 4 }))
    assert.ok(withRecover.includes('- Zero-result recovered after retry: 4'))

    const without = renderMarkdown(new Map(), [], baseStats())
    assert.ok(!without.includes('Zero-result recovered after retry'))
  })

  test('by_priority renders ok/total per tier using ok+fail+zero as the denominator', () => {
    const stats = baseStats({
      by_priority: {
        broad: { ok: 7, fail: 1, zero: 2 }, // total 10
        focused: { ok: 3, fail: 0, zero: 0 }, // total 3
        critical: { ok: 1, fail: 1, zero: 0 } // total 2
      }
    })
    const md = renderMarkdown(new Map(), [], stats)
    assert.ok(md.includes('- Priority: broad=7/10, focused=3/3, critical=1/2'))
  })

  test('by_priority tolerates missing tier objects (treats counts as 0/0)', () => {
    const stats = baseStats({ by_priority: { broad: { ok: 2, fail: 0, zero: 0 } } })
    const md = renderMarkdown(new Map(), [], stats)
    // focused & critical absent from the object -> 0/0
    assert.ok(md.includes('- Priority: broad=2/2, focused=0/0, critical=0/0'))
  })

  test('no by_priority key -> no Priority line at all', () => {
    const md = renderMarkdown(new Map(), [], baseStats())
    assert.ok(!md.includes('- Priority:'))
  })

  test('missing duration_ms is treated as 0 -> "Duration: 0.0s"', () => {
    // baseStats sets duration_ms:0; explicitly drop it to hit the `|| 0` fallback.
    const stats = baseStats()
    delete stats.duration_ms
    const md = renderMarkdown(new Map(), [], stats)
    assert.ok(md.includes('- Duration: 0.0s'))
  })
})
