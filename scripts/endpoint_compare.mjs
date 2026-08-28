#!/usr/bin/env node
/**
 * endpoint_compare.mjs — Brave /web/search vs /llm/context, measured on responses
 * that were already paid for.
 *
 * Every `<q>__context.json` on disk sits next to its `<q>.json` web response for the
 * SAME query from the SAME sprint run. That is a paired A/B sample that cost $0 to
 * collect twice — so the comparison needs no new API calls at all.
 *
 * Axes (from the brief): facts extracted · RU-source share · response volume ·
 * cost · latency · survival on JS-heavy pages.
 * Latency is not recoverable from saved payloads and is measured separately.
 *
 * Also splits every metric by the `country` the sprint used, because the canonical
 * brave_sweep.py defaults to country=us / search_lang=en even for Russian queries —
 * so the corpus contains a natural experiment on exactly that.
 *
 * Read-only.
 *
 * Usage:
 *   node scripts/endpoint_compare.mjs [--root D:/Yahia] [--limit N] [--json out.json] [--csv out.csv]
 *   node scripts/endpoint_compare.mjs --selftest
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PRICE_PER_REQUEST = Number(process.env.BRAVE_PRICE_PER_REQUEST) || 0.005
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'data.ms', '.next', 'dist'])

// ── metrics helpers ─────────────────────────────────────────────────────────

const CYRILLIC = /[\u0400-\u04FF]/g

/** Share of letters that are Cyrillic. Language of the *content*, independent of TLD. */
export function cyrillicRatio (text) {
  const s = String(text || '')
  const letters = s.replace(/[^\p{L}]/gu, '').length
  if (!letters) return 0
  const cyr = (s.match(CYRILLIC) || []).length
  return cyr / letters
}

/** RU by registrable suffix. .su and .рф included; punycode form of .рф is xn--p1ai. */
export function isRuHost (url) {
  let h
  try { h = new URL(url).hostname.toLowerCase() } catch { return false }
  return /\.(ru|su|рф|xn--p1ai)$/.test(h)
}

function hostOf (url) {
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

/**
 * What /web/search actually hands the agent per result: one description plus up to
 * five extra_snippets. Nothing else on the page is available without fetching it.
 */
function readWeb (j) {
  const results = j?.web?.results || []
  const urls = []
  let chars = 0
  let snippets = 0
  let ruTld = 0
  let ruText = 0
  for (const r of results) {
    if (!r?.url) continue
    urls.push(r.url)
    const parts = []
    if (r.description) parts.push(String(r.description))
    for (const s of (r.extra_snippets || [])) if (s) parts.push(String(s))
    snippets += parts.length
    const text = parts.join(' ')
    chars += text.length
    if (isRuHost(r.url)) ruTld++
    if (cyrillicRatio(text) > 0.3) ruText++
  }
  return { urls, chars, snippets, ruTld, ruText, country: j?.query?.country || null }
}

/**
 * The documented schema types `snippets` as a plain string array, so structured data is
 * supposedly unavailable. In practice Brave sometimes serializes a table or a titled
 * object INTO one of those strings. Worth counting: it is free structure the pipeline
 * currently throws away as prose. (brave_sweep.py already emits a
 * "N JSON-serialized snippets" warning, so the phenomenon is known but unquantified.)
 */
export function structuredKind (s) {
  const t = String(s || '').trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return null
  let v
  try { v = JSON.parse(t) } catch { return null }
  if (v && typeof v === 'object' && Array.isArray(v.table)) return 'table'
  if (Array.isArray(v)) return 'array'
  if (v && typeof v === 'object') return 'object'
  return null
}

/** What /llm/context hands back: extracted passages, already grounded to a source. */
function readCtx (j) {
  const generic = j?.grounding?.generic || []
  const urls = []
  let chars = 0
  let snippets = 0
  let ruTld = 0
  let ruText = 0
  let structured = 0
  let tables = 0
  for (const g of generic) {
    if (!g?.url) continue
    urls.push(g.url)
    const list = (g.snippets || []).filter(Boolean).map(String)
    const text = list.join(' ')
    snippets += list.length
    chars += text.length
    for (const s of list) {
      const kind = structuredKind(s)
      if (kind) { structured++; if (kind === 'table') tables++ }
    }
    if (isRuHost(g.url)) ruTld++
    if (cyrillicRatio(text) > 0.3) ruText++
  }
  return { urls, chars, snippets, ruTld, ruText, structured, tables }
}

// ── walk ────────────────────────────────────────────────────────────────────

function * walk (dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      yield * walk(join(dir, e.name))
    } else if (e.isFile() && e.name.endsWith('__context.json')) {
      yield join(dir, e.name)
    }
  }
}

// ── aggregation ─────────────────────────────────────────────────────────────

function newAcc () {
  return {
    pairs: 0,
    webUrls: 0, ctxUrls: 0,
    webChars: 0, ctxChars: 0,
    webSnippets: 0, ctxSnippets: 0,
    webRuTld: 0, ctxRuTld: 0,
    webRuText: 0, ctxRuText: 0,
    ctxEmpty: 0,
    ctxStructured: 0, ctxTables: 0, pairsWithStructured: 0,
    ctxOnlyUrls: 0, webOnlyUrls: 0, sharedUrls: 0
  }
}

function fold (acc, w, c) {
  acc.pairs++
  acc.webUrls += w.urls.length; acc.ctxUrls += c.urls.length
  acc.webChars += w.chars; acc.ctxChars += c.chars
  acc.webSnippets += w.snippets; acc.ctxSnippets += c.snippets
  acc.webRuTld += w.ruTld; acc.ctxRuTld += c.ruTld
  acc.webRuText += w.ruText; acc.ctxRuText += c.ruText
  if (c.urls.length === 0) acc.ctxEmpty++
  acc.ctxStructured += c.structured || 0
  acc.ctxTables += c.tables || 0
  if ((c.structured || 0) > 0) acc.pairsWithStructured++

  const wset = new Set(w.urls.map(hostOf).filter(Boolean))
  const cset = new Set(c.urls.map(hostOf).filter(Boolean))
  for (const h of cset) { if (wset.has(h)) acc.sharedUrls++; else acc.ctxOnlyUrls++ }
  for (const h of wset) if (!cset.has(h)) acc.webOnlyUrls++
}

const div = (a, b) => (b ? a / b : 0)
const pct = (a, b) => +(100 * div(a, b)).toFixed(1)
const f1 = n => +n.toFixed(1)

function summarize (acc) {
  return {
    pairs: acc.pairs,
    perQuery: {
      web: { urls: f1(div(acc.webUrls, acc.pairs)), snippets: f1(div(acc.webSnippets, acc.pairs)), chars: Math.round(div(acc.webChars, acc.pairs)) },
      ctx: { urls: f1(div(acc.ctxUrls, acc.pairs)), snippets: f1(div(acc.ctxSnippets, acc.pairs)), chars: Math.round(div(acc.ctxChars, acc.pairs)) }
    },
    charsPerSnippet: { web: Math.round(div(acc.webChars, acc.webSnippets)), ctx: Math.round(div(acc.ctxChars, acc.ctxSnippets)) },
    ruShareByTldPct: { web: pct(acc.webRuTld, acc.webUrls), ctx: pct(acc.ctxRuTld, acc.ctxUrls) },
    ruShareByScriptPct: { web: pct(acc.webRuText, acc.webUrls), ctx: pct(acc.ctxRuText, acc.ctxUrls) },
    contextEmptyPct: pct(acc.ctxEmpty, acc.pairs),
    structured: {
      snippets: acc.ctxStructured,
      tables: acc.ctxTables,
      shareOfCtxSnippetsPct: pct(acc.ctxStructured, acc.ctxSnippets),
      queriesWithAnyPct: pct(acc.pairsWithStructured, acc.pairs)
    },
    hostOverlap: { shared: acc.sharedUrls, ctxOnly: acc.ctxOnlyUrls, webOnly: acc.webOnlyUrls },
    // Both endpoints bill one request, so a `critical` line pays twice for one query.
    costPer1000Queries: { web: 1000 * PRICE_PER_REQUEST, ctx: 1000 * PRICE_PER_REQUEST, both: 2000 * PRICE_PER_REQUEST },
    charsPerDollar: {
      web: Math.round(div(acc.webChars, acc.pairs * PRICE_PER_REQUEST)),
      ctx: Math.round(div(acc.ctxChars, acc.pairs * PRICE_PER_REQUEST))
    }
  }
}

// ── selftest ────────────────────────────────────────────────────────────────

function selftest () {
  const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg) }
  const near = (a, b, msg) => ok(Math.abs(a - b) < 1e-9, `${msg} (${a} vs ${b})`)

  near(cyrillicRatio('привет'), 1, 'all cyrillic')
  near(cyrillicRatio('hello'), 0, 'no cyrillic')
  near(cyrillicRatio('abвг'), 0.5, 'half cyrillic')
  near(cyrillicRatio('!!! 123'), 0, 'no letters at all')

  ok(isRuHost('https://habr.com/ru/x') === false, 'path /ru/ is not a RU domain')
  ok(isRuHost('https://vc.ru/x') === true, '.ru tld')
  ok(isRuHost('https://xn--80ak6aa92e.xn--p1ai/') === true, 'punycode .рф')
  ok(isRuHost('not a url') === false, 'garbage url')

  const w = readWeb({ query: { country: 'ru' }, web: { results: [
    { url: 'https://vc.ru/a', description: 'описание тут', extra_snippets: ['ещё кусок', ''] },
    { url: 'https://example.com/b', description: 'english text here' }
  ] } })
  ok(w.urls.length === 2, 'web urls')
  ok(w.snippets === 3, 'description + non-empty extra_snippets')
  ok(w.ruTld === 1, 'one ru tld')
  ok(w.ruText === 1, 'one cyrillic-dominant result')
  ok(w.country === 'ru', 'country carried through')

  const c = readCtx({ grounding: { generic: [
    { url: 'https://vc.ru/a', snippets: ['длинный русский фрагмент', 'второй'] },
    { url: 'https://other.com/c', snippets: [] }
  ] } })
  ok(c.urls.length === 2, 'ctx urls')
  ok(c.snippets === 2, 'ctx snippets')

  // Coverage is compared per hostname, not per URL: two pages from one publisher are
  // one source, so example.com/b and example.com/c would collapse to a single host.
  const acc = newAcc(); fold(acc, w, c)
  ok(acc.sharedUrls === 1, 'vc.ru shared between both sides')
  ok(acc.ctxOnlyUrls === 1, 'other.com host only in context')
  ok(acc.webOnlyUrls === 1, 'example.com host only in web')

  const sameHost = newAcc()
  fold(sameHost, readWeb({ web: { results: [{ url: 'https://example.com/b', description: 'x' }] } }),
    readCtx({ grounding: { generic: [{ url: 'https://example.com/c', snippets: ['y'] }] } }))
  ok(sameHost.sharedUrls === 1 && sameHost.ctxOnlyUrls === 0, 'different paths on one host count once')

  const empty = newAcc(); fold(empty, w, readCtx({}))
  ok(empty.ctxEmpty === 1, 'empty grounding counted as a context miss')
  ok(summarize(newAcc()).perQuery.web.urls === 0, 'no divide-by-zero on empty input')

  ok(structuredKind('обычный текст') === null, 'prose is not structured')
  ok(structuredKind('{"title":"x","table":[{"a":"b"}]}') === 'table', 'serialized table detected')
  ok(structuredKind('{"title":"x"}') === 'object', 'serialized object detected')
  ok(structuredKind('{ broken json') === null, 'unparseable brace is not structured')
  ok(structuredKind('') === null, 'empty string')
  const st = readCtx({ grounding: { generic: [{ url: 'https://a.ru/1', snippets: ['{"title":"t","table":[{"k":"v"}]}', 'проза'] }] } })
  ok(st.structured === 1 && st.tables === 1, 'counts one table among two passages')

  console.log('selftest: 26 assertions OK')
}

// ── main ────────────────────────────────────────────────────────────────────

function arg (name, dflt) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

function main () {
  if (process.argv.includes('--selftest')) return selftest()

  const root = arg('--root', 'D:/Yahia')
  const limit = Number(arg('--limit', '0')) || Infinity
  const jsonOut = arg('--json', null)
  const csvOut = arg('--csv', null)

  process.stderr.write(`scanning ${root} for paired responses …\n`)

  const all = newAcc()
  const byCountry = new Map()
  const rows = []
  let seen = 0, skipped = 0

  for (const ctxPath of walk(root)) {
    if (seen >= limit) break
    const webPath = ctxPath.replace(/__context\.json$/, '.json')
    let jw, jc
    try {
      jw = JSON.parse(readFileSync(webPath, 'utf8'))
      jc = JSON.parse(readFileSync(ctxPath, 'utf8'))
    } catch { skipped++; continue }

    const w = readWeb(jw)
    const c = readCtx(jc)
    seen++

    fold(all, w, c)
    const cc = w.country || '(none)'
    if (!byCountry.has(cc)) byCountry.set(cc, newAcc())
    fold(byCountry.get(cc), w, c)

    if (csvOut) {
      rows.push([
        JSON.stringify(jw?.query?.original || ''),
        cc,
        w.urls.length, c.urls.length,
        w.snippets, c.snippets,
        w.chars, c.chars,
        pct(w.ruTld, w.urls.length), pct(c.ruTld, c.urls.length)
      ].join(','))
    }

    if (seen % 1000 === 0) process.stderr.write(`  ${seen} pairs …\n`)
  }

  const summary = summarize(all)
  const perCountry = {}
  for (const [k, v] of byCountry) perCountry[k] = summarize(v)

  const L = []
  const line = '='.repeat(72)
  L.push('')
  L.push('/web/search  vs  /llm/context — paired, on already-paid responses')
  L.push(line)
  L.push(`pairs analysed: ${seen}   (unreadable/skipped: ${skipped})`)
  L.push('')
  L.push('PER QUERY                         web/search      llm/context')
  L.push(`  sources returned              ${String(summary.perQuery.web.urls).padStart(12)}${String(summary.perQuery.ctx.urls).padStart(17)}`)
  L.push(`  passages returned             ${String(summary.perQuery.web.snippets).padStart(12)}${String(summary.perQuery.ctx.snippets).padStart(17)}`)
  L.push(`  characters of text            ${String(summary.perQuery.web.chars).padStart(12)}${String(summary.perQuery.ctx.chars).padStart(17)}`)
  L.push(`  chars per passage             ${String(summary.charsPerSnippet.web).padStart(12)}${String(summary.charsPerSnippet.ctx).padStart(17)}`)
  L.push('')
  L.push('RU SOURCE SHARE')
  L.push(`  by TLD (.ru/.su/.рф)        ${String(summary.ruShareByTldPct.web + '%').padStart(14)}${String(summary.ruShareByTldPct.ctx + '%').padStart(17)}`)
  L.push(`  by Cyrillic content         ${String(summary.ruShareByScriptPct.web + '%').padStart(14)}${String(summary.ruShareByScriptPct.ctx + '%').padStart(17)}`)
  L.push('')
  L.push('EXTRACTION FAILURES')
  L.push(`  queries where context returned nothing: ${summary.contextEmptyPct}%`)
  L.push('')
  L.push('STRUCTURED PAYLOADS SMUGGLED INSIDE context snippets (schema says plain strings)')
  L.push(`  JSON snippets: ${summary.structured.snippets} (${summary.structured.shareOfCtxSnippetsPct}% of all context passages), of which tables: ${summary.structured.tables}`)
  L.push(`  queries with at least one: ${summary.structured.queriesWithAnyPct}%`)
  L.push('')
  L.push('HOST COVERAGE (per query, deduped by hostname)')
  L.push(`  in both: ${summary.hostOverlap.shared}   context-only: ${summary.hostOverlap.ctxOnly}   web-only: ${summary.hostOverlap.webOnly}`)
  L.push('')
  L.push('VALUE PER DOLLAR (both endpoints bill $%s per request)'.replace('%s', PRICE_PER_REQUEST))
  L.push(`  characters per $1             ${String(summary.charsPerDollar.web).padStart(12)}${String(summary.charsPerDollar.ctx).padStart(17)}`)
  L.push(`  ratio context:web             ${(div(summary.charsPerDollar.ctx, summary.charsPerDollar.web)).toFixed(1)}x`)
  L.push('')
  L.push('SPLIT BY country PARAMETER SENT')
  L.push(line)
  for (const [cc, s] of Object.entries(perCountry).sort((a, b) => b[1].pairs - a[1].pairs)) {
    L.push(`country=${cc}  (${s.pairs} pairs)`)
    L.push(`   RU by TLD      web ${String(s.ruShareByTldPct.web + '%').padStart(6)}   context ${String(s.ruShareByTldPct.ctx + '%').padStart(6)}`)
    L.push(`   RU by content  web ${String(s.ruShareByScriptPct.web + '%').padStart(6)}   context ${String(s.ruShareByScriptPct.ctx + '%').padStart(6)}`)
    L.push(`   chars/query    web ${String(s.perQuery.web.chars).padStart(6)}   context ${String(s.perQuery.ctx.chars).padStart(6)}`)
  }
  L.push('')
  console.log(L.join('\n'))

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({
      generated: new Date().toISOString(), root, pairs: seen, skipped,
      price_per_request: PRICE_PER_REQUEST, overall: summary, byCountry: perCountry
    }, null, 2))
    process.stderr.write(`wrote ${jsonOut}\n`)
  }
  if (csvOut) {
    writeFileSync(csvOut, 'query,country,web_urls,ctx_urls,web_snippets,ctx_snippets,web_chars,ctx_chars,web_ru_tld_pct,ctx_ru_tld_pct\n' + rows.join('\n'))
    process.stderr.write(`wrote ${csvOut}\n`)
  }
}

main()
