// Unit coverage for src/sweep/findings_renderer.js — renderFindings().
//
// renderFindings constructs a Meilisearch client internally from module-level
// env (MEILISEARCH_URL/_KEY, read at import time) and, for each unique URL,
// queries the corpus index to build "cross-topic alerts". That search is
// wrapped in try/catch: on failure it logs to console.error and continues with
// NO alerts. We exploit that here — by pointing MEILISEARCH_URL at a dead port
// BEFORE importing the module, every corpus lookup fails fast, the cross-topic
// section is omitted, and the rest of the markdown (header, aggregation,
// TL;DR sort, per-query summary, stats footer) is fully deterministic.
//
// The only non-deterministic line is `Generated: <ISO timestamp>`, which we
// never pin. The live-Meilisearch success path + the cross-topic alert
// rendering branch (lines 112-122) cannot be exercised without an injectable
// client — see the structured-output "limitations" note.

// Point Meilisearch at a dead port BEFORE the module is loaded. findings_renderer
// reads `const MEILI_URL = process.env.MEILISEARCH_URL || ...` at module-eval
// time, so we MUST set the env first and then load it via dynamic import() —
// a static `import` is hoisted above this line and would evaluate the module
// (capturing the real localhost:7700) before the assignment runs. Using the
// dead port makes the test hermetic: every corpus lookup fails fast and is
// caught, so cross-topic alerts never render and we don't depend on whatever
// happens to be sitting in a live corpus.
process.env.MEILISEARCH_URL = 'http://127.0.0.1:1'
process.env.MEILISEARCH_KEY = 'test-not-used' // never reached (connection refused first)

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Loaded in before() (see env note above), not via a top-level static import.
let renderFindings

// renderFindings logs one console.error per unique URL when the corpus lookup
// fails (the dead-port path). Silence + count that noise so test output stays
// clean and we can assert the catch branch actually ran.
let errSpy = []
const origError = console.error
before(async () => {
  ;({ renderFindings } = await import('../../../src/sweep/findings_renderer.js'))
  console.error = (...args) => { errSpy.push(args) }
})
after(() => {
  console.error = origError
})

// Convenience: build a results Map the way runSweep would.
function resultsMap (obj) {
  return new Map(Object.entries(obj))
}

const baseStats = { web_ok: 0, web_fail: 0, total_deduped: 0, duration_ms: 0 }

describe('renderFindings — header', () => {
  test('renders topic name, query count, and success ratio', async () => {
    errSpy = []
    const md = await renderFindings(resultsMap({}), [{ label: 'a', query: 'q' }], { ...baseStats, web_ok: 1 }, 'my-topic')
    assert.match(md, /^# Findings: my-topic$/m)
    assert.match(md, /^Queries: 1 \| Success: 1\/1$/m)
  })

  test('defaults topicName to "sweep" when omitted', async () => {
    errSpy = []
    const md = await renderFindings(resultsMap({}), [], baseStats)
    assert.match(md, /^# Findings: sweep$/m)
  })

  test('always emits a Generated: ISO-8601 line', async () => {
    errSpy = []
    const md = await renderFindings(resultsMap({}), [], baseStats)
    assert.match(md, /^Generated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m)
  })
})

describe('renderFindings — empty / no-results input', () => {
  test('empty queries + empty results still produces a well-formed skeleton', async () => {
    errSpy = []
    const md = await renderFindings(resultsMap({}), [], baseStats)
    assert.match(md, /## TL;DR — Top 5 URLs/)
    assert.match(md, /## Per-query summary/)
    assert.match(md, /## Sweep stats/)
    // No URLs aggregated → footer reports zero unique URLs.
    assert.match(md, /^- Unique URLs found: 0$/m)
    // Nothing to look up → no corpus queries fired → no console.error noise.
    assert.equal(errSpy.length, 0)
  })

  test('failed query renders a _Failed:_ line with its error message', async () => {
    errSpy = []
    const results = resultsMap({ c1: { ok: false, error: 'timeout' } })
    const md = await renderFindings(results, [{ label: 'c1', query: 'broken q' }], { ...baseStats, web_fail: 1 }, 't')
    assert.match(md, /### c1 — "broken q"/)
    assert.match(md, /_Failed: timeout_/)
  })

  test('failed query with no error message falls back to "unknown"', async () => {
    errSpy = []
    const results = resultsMap({ c1: { ok: false } })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], baseStats, 't')
    assert.match(md, /_Failed: unknown_/)
  })

  test('a query label entirely absent from the results Map is treated as failed', async () => {
    errSpy = []
    // results Map has no 'ghost' entry at all → entry is undefined → !entry?.ok
    const md = await renderFindings(resultsMap({}), [{ label: 'ghost', query: 'q' }], baseStats, 't')
    assert.match(md, /### ghost — "q"/)
    assert.match(md, /_Failed: unknown_/)
  })
})

describe('renderFindings — URL aggregation + TL;DR sort', () => {
  test('dedups the same URL across queries and unions engines', async () => {
    errSpy = []
    const results = resultsMap({
      c1: { ok: true, results: [{ url: 'https://x.com', title: 'X', engines: ['brave'] }] },
      c2: { ok: true, results: [{ url: 'https://x.com', title: 'X dup', engines: ['searxng', 'brave'] }] }
    })
    const queries = [{ label: 'c1', query: 'q1' }, { label: 'c2', query: 'q2' }]
    const md = await renderFindings(results, queries, { ...baseStats, web_ok: 2 }, 't')
    // Unique URLs = 1 (deduped).
    assert.match(md, /^- Unique URLs found: 1$/m)
    // Engine union = {brave, searxng} → count 2; first-seen title 'X' is kept.
    assert.match(md, /### 1\. X\n- URL: https:\/\/x\.com\n- Engines: brave, searxng \(count=2\)/)
    // Both query labels recorded as hits.
    assert.match(md, /- Queries hit: c1, c2/)
    // One unique URL → exactly one corpus lookup attempted (and failed → 1 error logged).
    assert.equal(errSpy.length, 1)
  })

  test('TL;DR sorts by engine-count desc, then appearance-count desc', async () => {
    errSpy = []
    // url-hi: 3 engines, seen once. url-mid: 2 engines, seen twice. url-lo: 1 engine, seen 3x.
    const results = resultsMap({
      c1: {
        ok: true,
        results: [
          { url: 'https://lo.com', title: 'LO', engines: ['brave'] },
          { url: 'https://mid.com', title: 'MID', engines: ['brave', 'searxng'] },
          { url: 'https://hi.com', title: 'HI', engines: ['brave', 'searxng', 'yandex'] }
        ]
      },
      c2: {
        ok: true,
        results: [
          { url: 'https://lo.com', title: 'LO', engines: ['brave'] },
          { url: 'https://mid.com', title: 'MID', engines: ['searxng'] }
        ]
      },
      c3: { ok: true, results: [{ url: 'https://lo.com', title: 'LO', engines: ['brave'] }] }
    })
    const queries = [{ label: 'c1', query: 'q' }, { label: 'c2', query: 'q' }, { label: 'c3', query: 'q' }]
    const md = await renderFindings(results, queries, { ...baseStats, web_ok: 3 }, 't')
    // Order must be HI (3 engines) → MID (2 engines) → LO (1 engine).
    const hiIdx = md.indexOf('### 1. HI')
    const midIdx = md.indexOf('### 2. MID')
    const loIdx = md.indexOf('### 3. LO')
    assert.ok(hiIdx >= 0 && midIdx >= 0 && loIdx >= 0, 'all three URLs present in TL;DR')
    assert.ok(hiIdx < midIdx && midIdx < loIdx, 'sorted by engine-count desc')
  })

  test('appearance-count breaks ties when engine-count is equal', async () => {
    errSpy = []
    // Both have a single engine; "twice" appears in 2 queries, "once" in 1.
    const results = resultsMap({
      c1: {
        ok: true,
        results: [
          { url: 'https://once.com', title: 'ONCE', engines: ['brave'] },
          { url: 'https://twice.com', title: 'TWICE', engines: ['brave'] }
        ]
      },
      c2: { ok: true, results: [{ url: 'https://twice.com', title: 'TWICE', engines: ['brave'] }] }
    })
    const queries = [{ label: 'c1', query: 'q' }, { label: 'c2', query: 'q' }]
    const md = await renderFindings(results, queries, { ...baseStats, web_ok: 2 }, 't')
    const twiceIdx = md.indexOf('### 1. TWICE')
    const onceIdx = md.indexOf('### 2. ONCE')
    assert.ok(twiceIdx >= 0 && onceIdx >= 0)
    assert.ok(twiceIdx < onceIdx, 'higher appearance count ranks first on engine-count tie')
  })

  test('TL;DR is capped at 5 URLs even when more exist', async () => {
    errSpy = []
    const r = []
    for (let i = 0; i < 8; i++) r.push({ url: `https://u${i}.com`, title: `U${i}`, engines: ['brave'] })
    const results = resultsMap({ c1: { ok: true, results: r } })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], { ...baseStats, web_ok: 1 }, 't')
    // Headings ### 1..5 present, ### 6 absent in the TL;DR.
    assert.match(md, /### 5\. U/)
    assert.doesNotMatch(md, /### 6\. /)
    // But all 8 are still counted as unique URLs in the footer.
    assert.match(md, /^- Unique URLs found: 8$/m)
  })

  test('results without a url are skipped during aggregation', async () => {
    errSpy = []
    const results = resultsMap({
      c1: {
        ok: true,
        results: [
          { title: 'no url here', engines: ['brave'] }, // no .url → skipped
          { url: 'https://real.com', title: 'real', engines: ['brave'] }
        ]
      }
    })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], { ...baseStats, web_ok: 1 }, 't')
    assert.match(md, /^- Unique URLs found: 1$/m)
    assert.equal(errSpy.length, 1) // only the one real URL triggered a lookup
  })

  test('an ok:false entry contributes no URLs to aggregation', async () => {
    errSpy = []
    const results = resultsMap({
      good: { ok: true, results: [{ url: 'https://g.com', title: 'G', engines: ['brave'] }] },
      bad: { ok: false, error: 'nope', results: [{ url: 'https://should-not-count.com', engines: ['brave'] }] }
    })
    const queries = [{ label: 'good', query: 'q' }, { label: 'bad', query: 'q' }]
    const md = await renderFindings(results, queries, { ...baseStats, web_ok: 1, web_fail: 1 }, 't')
    // Only the URL from the ok entry is aggregated.
    assert.match(md, /^- Unique URLs found: 1$/m)
    assert.doesNotMatch(md, /should-not-count\.com/)
    // The failed entry still shows up in the per-query summary as failed.
    assert.match(md, /### bad — "q"[\s\S]*_Failed: nope_/)
  })
})

describe('renderFindings — TL;DR field rendering', () => {
  test('missing title renders "(no title)" in TL;DR heading', async () => {
    errSpy = []
    const results = resultsMap({ c1: { ok: true, results: [{ url: 'https://x.com', engines: ['brave'] }] } })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], { ...baseStats, web_ok: 1 }, 't')
    assert.match(md, /### 1\. \(no title\)/)
  })

  test('title is truncated to 100 chars in the TL;DR heading', async () => {
    errSpy = []
    const longTitle = 'T'.repeat(150)
    const results = resultsMap({ c1: { ok: true, results: [{ url: 'https://x.com', title: longTitle, engines: ['brave'] }] } })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], { ...baseStats, web_ok: 1 }, 't')
    assert.match(md, new RegExp('### 1\\. T{100}\\n')) // exactly 100 Ts then newline
    assert.doesNotMatch(md, new RegExp('T{101}'))
  })

  test('description is truncated to 200 chars and omitted when empty', async () => {
    errSpy = []
    const longDesc = 'D'.repeat(250)
    const results = resultsMap({
      withDesc: { ok: true, results: [{ url: 'https://a.com', title: 'A', description: longDesc, engines: ['brave'] }] },
      noDesc: { ok: true, results: [{ url: 'https://b.com', title: 'B', engines: ['brave'] }] }
    })
    const queries = [{ label: 'withDesc', query: 'q' }, { label: 'noDesc', query: 'q' }]
    const md = await renderFindings(results, queries, { ...baseStats, web_ok: 2 }, 't')
    // 'A' description present, truncated to 200 D's (not 250).
    assert.match(md, new RegExp('- D{200}\\n'))
    assert.doesNotMatch(md, new RegExp('D{201}'))
    // 'B' has no description → there should be no bullet line of D's, and B's
    // block contains only URL/Engines/Queries lines.
    const bBlock = md.slice(md.indexOf('### 2. B'), md.indexOf('---'))
    assert.doesNotMatch(bBlock, /^- [^UEQ]/m) // no stray description bullet
  })
})

describe('renderFindings — per-query summary', () => {
  test('shows top-3 results only, with engine brackets', async () => {
    errSpy = []
    const results = resultsMap({
      c1: {
        ok: true,
        results: [
          { url: 'https://1.com', title: 'First', engines: ['brave', 'searxng'] },
          { url: 'https://2.com', title: 'Second', engines: ['brave'] },
          { url: 'https://3.com', title: 'Third', engines: ['yandex'] },
          { url: 'https://4.com', title: 'Fourth', engines: ['brave'] }
        ]
      }
    })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], { ...baseStats, web_ok: 1 }, 't')
    const summaryBlock = md.slice(md.indexOf('## Per-query summary'))
    // First three render with bold title + bracketed engines.
    assert.match(summaryBlock, /- \*\*First\*\* \[brave, searxng\]\n {2}https:\/\/1\.com/)
    assert.match(summaryBlock, /- \*\*Second\*\* \[brave\]/)
    assert.match(summaryBlock, /- \*\*Third\*\* \[yandex\]/)
    // Fourth result is dropped (slice(0,3)).
    assert.doesNotMatch(summaryBlock, /Fourth/)
  })

  test('no engines → no bracket suffix in per-query summary', async () => {
    errSpy = []
    const results = resultsMap({ c1: { ok: true, results: [{ url: 'https://x.com', title: 'Plain' }] } })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], { ...baseStats, web_ok: 1 }, 't')
    const summaryBlock = md.slice(md.indexOf('## Per-query summary'))
    // Title with no trailing bracket: "**Plain**" directly followed by newline.
    assert.match(summaryBlock, /- \*\*Plain\*\*\n/)
  })

  test('per-query title falls back to "(no title)" and truncates to 80 chars', async () => {
    errSpy = []
    const longTitle = 'P'.repeat(120)
    const results = resultsMap({
      c1: {
        ok: true,
        results: [
          { url: 'https://x.com', engines: ['brave'] }, // no title
          { url: 'https://y.com', title: longTitle, engines: ['brave'] }
        ]
      }
    })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], { ...baseStats, web_ok: 1 }, 't')
    const summaryBlock = md.slice(md.indexOf('## Per-query summary'))
    assert.match(summaryBlock, /- \*\*\(no title\)\*\*/)
    assert.match(summaryBlock, new RegExp('\\*\\*P{80}\\*\\*')) // exactly 80 Ps
    assert.doesNotMatch(summaryBlock, new RegExp('P{81}'))
  })

  test('ok entry with empty results array yields a heading but no bullets', async () => {
    errSpy = []
    const results = resultsMap({ c1: { ok: true, results: [] } })
    const md = await renderFindings(results, [{ label: 'c1', query: 'empty q' }], { ...baseStats, web_ok: 1 }, 't')
    assert.match(md, /### c1 — "empty q"/)
    // Not marked as failed (it's ok), just no result bullets following it.
    assert.doesNotMatch(md, /_Failed:/)
  })
})

describe('renderFindings — cross-topic alerts (dead-port catch path)', () => {
  test('when every corpus lookup fails, the alerts section is omitted', async () => {
    errSpy = []
    const results = resultsMap({ c1: { ok: true, results: [{ url: 'https://x.com', title: 'X', engines: ['brave'] }] } })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], { ...baseStats, web_ok: 1 }, 't')
    assert.doesNotMatch(md, /Cross-topic alerts/)
    // The failure was caught and logged (one per unique URL), not thrown.
    assert.equal(errSpy.length, 1)
    assert.match(String(errSpy[0][0]), /\[findings\] cross-topic query failed/)
  })

  test('a corpus-lookup failure does not abort the render', async () => {
    errSpy = []
    // Two unique URLs → two failed lookups, but render still completes fully.
    const results = resultsMap({
      c1: {
        ok: true,
        results: [
          { url: 'https://a.com', title: 'A', engines: ['brave'] },
          { url: 'https://b.com', title: 'B', engines: ['brave'] }
        ]
      }
    })
    const md = await renderFindings(results, [{ label: 'c1', query: 'q' }], { ...baseStats, web_ok: 1 }, 't')
    assert.match(md, /## Sweep stats/) // reached the very end of the function
    assert.equal(errSpy.length, 2)
  })
})

describe('renderFindings — stats footer', () => {
  test('formats duration as seconds with one decimal', async () => {
    errSpy = []
    const md = await renderFindings(resultsMap({}), [], { ...baseStats, duration_ms: 1234 }, 't')
    assert.match(md, /^- Duration: 1\.2s$/m)
  })

  test('missing duration_ms defaults to 0.0s', async () => {
    errSpy = []
    const md = await renderFindings(resultsMap({}), [], { web_ok: 0, web_fail: 0, total_deduped: 0 }, 't')
    assert.match(md, /^- Duration: 0\.0s$/m)
  })

  test('reports web ok/fail, deduped, totals, and the engine_count>=3 tally', async () => {
    errSpy = []
    const results = resultsMap({
      c1: {
        ok: true,
        results: [
          { url: 'https://strong.com', title: 'S', engines: ['brave', 'searxng', 'yandex'] }, // 3 engines
          { url: 'https://weak.com', title: 'W', engines: ['brave'] } // 1 engine
        ]
      }
    })
    const queries = [{ label: 'c1', query: 'q' }]
    const stats = { web_ok: 4, web_fail: 2, total_deduped: 9, duration_ms: 5000 }
    const md = await renderFindings(results, queries, stats, 't')
    assert.match(md, /^- Total queries: 1$/m)
    assert.match(md, /^- Web ok\/fail: 4\/2$/m)
    assert.match(md, /^- Deduped URLs: 9$/m)
    assert.match(md, /^- Unique URLs found: 2$/m)
    // Only the 3-engine URL clears the >=3 threshold.
    assert.match(md, /^- URLs with engine_count >= 3: 1$/m)
  })
})
