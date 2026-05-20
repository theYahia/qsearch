// rd277: unit coverage for brief_gen pure helpers. Ollama is NOT touched here —
// runBriefScaffold() itself talks to Ollama (covered by Tier 4 smoke test);
// here we only test the JSON parser, priority distribution, queries.txt
// serialiser, and markdown scaffold builder.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseClusters,
  priorityFor,
  floorFor,
  buildQueriesTxt,
  buildScaffoldMd
} from '../../../src/sweep/brief_gen.js'

describe('floorFor — tier → minimum cluster count', () => {
  test('heavy = 25', () => assert.equal(floorFor('heavy'), 25))
  test('standard = 12', () => assert.equal(floorFor('standard'), 12))
  test('light = 5', () => assert.equal(floorFor('light'), 5))
  test('unknown tier defaults to light floor', () => assert.equal(floorFor('???'), 5))
})

describe('parseClusters — Ollama JSON tolerance', () => {
  test('plain JSON parses', () => {
    const raw = '{"clusters":[{"name":"foo","title":"Foo","angle":"A"}]}'
    const out = parseClusters(raw)
    assert.equal(out.length, 1)
    assert.equal(out[0].name, 'foo')
    assert.equal(out[0].title, 'Foo')
  })

  test('JSON wrapped in code fences parses', () => {
    const raw = '```json\n{"clusters":[{"name":"bar","title":"Bar"}]}\n```'
    const out = parseClusters(raw)
    assert.equal(out.length, 1)
    assert.equal(out[0].name, 'bar')
  })

  test('JSON with <think> block parses (qwen quirk)', () => {
    const raw = '<think>let me consider</think>\n{"clusters":[{"name":"baz","title":"Baz"}]}'
    const out = parseClusters(raw)
    assert.equal(out.length, 1)
    assert.equal(out[0].name, 'baz')
  })

  test('cluster name slugified to kebab-case', () => {
    const raw = '{"clusters":[{"name":"Foo Bar BAZ!","title":"Foo Bar"}]}'
    const out = parseClusters(raw)
    assert.equal(out[0].name, 'foo-bar-baz')
  })

  test('clusters missing name or title are filtered', () => {
    const raw = '{"clusters":[{"name":"a","title":"A"},{"name":""},{"title":"no name"}]}'
    const out = parseClusters(raw)
    assert.equal(out.length, 1)
    assert.equal(out[0].name, 'a')
  })

  test('garbage returns null', () => {
    assert.equal(parseClusters('not json at all'), null)
    assert.equal(parseClusters(''), null)
    assert.equal(parseClusters(null), null)
  })

  test('missing clusters array returns null', () => {
    assert.equal(parseClusters('{"foo":"bar"}'), null)
  })
})

describe('priorityFor — distribution across clusters', () => {
  test('light tier — all broad', () => {
    for (let i = 0; i < 10; i++) {
      assert.equal(priorityFor(i, 10, 'light'), 'broad')
    }
  })

  test('standard tier — broad until last 20%, then focused', () => {
    // total=10, broad until idx<8, focused 8-9
    assert.equal(priorityFor(0, 10, 'standard'), 'broad')
    assert.equal(priorityFor(7, 10, 'standard'), 'broad')
    assert.equal(priorityFor(8, 10, 'standard'), 'focused')
    assert.equal(priorityFor(9, 10, 'standard'), 'focused')
  })

  test('heavy tier — 70/25/5 distribution boundaries', () => {
    // total=20, broad <14 (70%), focused 14-18 (25%), critical 19+ (5%)
    assert.equal(priorityFor(0, 20, 'heavy'), 'broad')
    assert.equal(priorityFor(13, 20, 'heavy'), 'broad')
    assert.equal(priorityFor(14, 20, 'heavy'), 'focused')
    assert.equal(priorityFor(18, 20, 'heavy'), 'focused')
    assert.equal(priorityFor(19, 20, 'heavy'), 'critical')
  })

  test('heavy tier — count of each priority in 25-cluster set roughly matches 70/25/5', () => {
    const counts = { broad: 0, focused: 0, critical: 0 }
    for (let i = 0; i < 25; i++) counts[priorityFor(i, 25, 'heavy')]++
    // 25 * 0.7 = 17.5 broad; 25 * 0.25 = 6.25 focused; 25 * 0.05 = 1.25 critical
    assert.ok(counts.broad >= 15 && counts.broad <= 19, `broad count ${counts.broad} out of band`)
    assert.ok(counts.focused >= 4 && counts.focused <= 8, `focused count ${counts.focused} out of band`)
    assert.ok(counts.critical >= 1, `critical count ${counts.critical} below floor`)
  })
})

describe('buildQueriesTxt — serialiser', () => {
  test('produces 3-field lines: name|query|priority', () => {
    const clusters = [{ name: 'vector-db', title: 'Vector DB', angle: 'A' }]
    const txt = buildQueriesTxt(clusters, 'self-hosted vector DBs', 'standard')
    const lines = txt.split('\n').filter(Boolean)
    assert.ok(lines.length > 0)
    for (const line of lines) {
      const parts = line.split('|')
      assert.equal(parts.length, 3, `expected 3 parts in "${line}"`)
      assert.equal(parts[0], 'vector-db')
      assert.match(parts[2], /^(broad|focused|critical)$/)
    }
  })

  test('heavy tier produces ≥ floor*queries_per_cluster lines', () => {
    const clusters = Array.from({ length: 25 }, (_, i) => ({
      name: `c-${i}`, title: `Cluster ${i}`, angle: ''
    }))
    const txt = buildQueriesTxt(clusters, 'topic', 'heavy')
    const lines = txt.split('\n').filter(Boolean)
    // heavy uses 7 queries per cluster → 25 * 7 = 175 lines minimum
    assert.ok(lines.length >= 150, `expected ≥150 lines, got ${lines.length}`)
  })

  test('first query variant matches cluster title verbatim', () => {
    const clusters = [{ name: 'qdrant', title: 'Qdrant', angle: '' }]
    const txt = buildQueriesTxt(clusters, 'vector DBs', 'light')
    const firstLine = txt.split('\n')[0]
    assert.equal(firstLine.split('|')[1], 'Qdrant')
  })
})

describe('buildScaffoldMd — markdown skeleton', () => {
  const sampleClusters = [
    { name: 'foo', title: 'Foo', angle: 'Investigates foo' },
    { name: 'bar', title: 'Bar', angle: '' }
  ]

  test('frontmatter declares status=SCAFFOLD', () => {
    const md = buildScaffoldMd('topic X', 'heavy', null, sampleClusters)
    assert.match(md, /status:\s*SCAFFOLD/)
  })

  test('contains TODO markers for load-bearing sections', () => {
    const md = buildScaffoldMd('topic X', 'heavy', null, sampleClusters)
    assert.match(md, /TODO[^<]*Claude finalize/)
    // Verify each load-bearing section is marked TODO
    assert.match(md, /## Killer questions[\s\S]*TODO/)
    assert.match(md, /## Brier priors[\s\S]*TODO/)
    assert.match(md, /## Decision criteria[\s\S]*TODO/)
  })

  test('cluster outline lists all provided clusters', () => {
    const md = buildScaffoldMd('topic X', 'standard', null, sampleClusters)
    assert.match(md, /Foo.*foo/)
    assert.match(md, /Bar.*bar/)
  })

  test('heavy tier with below-floor count flags warning', () => {
    const small = [{ name: 'a', title: 'A', angle: '' }]
    const md = buildScaffoldMd('topic', 'heavy', null, small)
    assert.match(md, /below floor of 25/)
  })

  test('heavy tier with floor-met count does NOT flag warning', () => {
    const enough = Array.from({ length: 25 }, (_, i) => ({ name: `c${i}`, title: `C${i}`, angle: '' }))
    const md = buildScaffoldMd('topic', 'heavy', null, enough)
    assert.doesNotMatch(md, /below floor/)
  })

  test('aperture is rendered when provided', () => {
    const md = buildScaffoldMd('topic', 'standard', 'focus on EU market', sampleClusters)
    assert.match(md, /## Aperture[\s\S]*focus on EU market/)
  })

  test('heavy tier mentions all 4 sub-engines for brave sweep plan', () => {
    const md = buildScaffoldMd('topic', 'heavy', null, sampleClusters)
    assert.match(md, /brave \+ brave\/cross_lang \+ brave\/citation_chase \+ qsearch/)
    assert.match(md, /--engines all/)
  })
})
