#!/usr/bin/env node
/**
 * brave_locale_probe.mjs — the two things the saved corpus cannot answer.
 *
 * 1. LATENCY. Saved payloads carry no timing, so p50/p95 per endpoint must be measured live.
 * 2. A CONFOUND-FREE country A/B. The corpus shows country=ru sprints returning far more
 *    RU sources than country=us sprints — but those are DIFFERENT queries, so the gap could
 *    be topic, not locale. This runs the SAME query both ways and removes the confound.
 *
 * Deliberately small: default 5 queries x 3 calls = 15 paid requests (~$0.08), well under
 * the session ceiling. Paced at 1 request/second because the lower Brave plans throttle
 * around there. Prints a running counter so the spend is never a surprise.
 *
 * The API key is read from .env.local and never printed, logged, or echoed — not even in
 * error paths, which report status codes only.
 *
 * Usage:
 *   node scripts/brave_locale_probe.mjs [--n 5] [--out bench/ru/locale_probe.json] [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BASE = process.env.BRAVE_BASE_URL || 'https://api.search.brave.com'
const PRICE_PER_REQUEST = 0.005
// 0.4 rps (2.5s spacing) — conservative; the lower plans throttle near 1 rps and no 429
// was ever observed at this rate.
//
// Historical note, kept because it cost an hour: a run of `422 SUBSCRIPTION_TOKEN_INVALID`
// here was NOT throttling and NOT a revoked key. It was a stale BRAVE_API_KEY in the Windows
// *User* environment shadowing the valid one in .env.local, back when loadKey() preferred
// process.env. Slowing down appeared to help only by coincidence. See loadKey().
const RPS = 0.4

/**
 * .env.local WINS over the ambient environment — same precedence as the server
 * (src/server.js:14 assigns into process.env unconditionally).
 *
 * This order is not cosmetic. This machine carries a stale BRAVE_API_KEY in the Windows
 * *User* environment that Brave rejects, while the key in .env.local is valid. Preferring
 * process.env made every request fail with `422 SUBSCRIPTION_TOKEN_INVALID` — which reads
 * exactly like a revoked key and sent this audit chasing a phantom.
 */
function loadKey () {
  try {
    const txt = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && m[1] === 'BRAVE_API_KEY') return m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* fall through to ambient env */ }
  return process.env.BRAVE_API_KEY || null
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function isRuHost (url) {
  try { return /\.(ru|su|рф|xn--p1ai)$/.test(new URL(url).hostname.toLowerCase()) } catch { return false }
}

async function call (endpoint, params, key) {
  const suffix = endpoint === 'llm/context' ? '' : '/search'
  const url = new URL(`${BASE}/res/v1/${endpoint}${suffix}`)
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v))

  const t0 = performance.now()
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  })
  const ms = Math.round(performance.now() - t0)

  if (!res.ok) {
    // Surface Brave's own error code — without it, 422 is indistinguishable between
    // "bad parameter" and "token rejected", which are very different problems.
    // The body is scrubbed of the token before anything is read out of it.
    let code = null
    try {
      const body = (await res.text()).replaceAll(key, '<KEY>')
      code = JSON.parse(body)?.error?.code || body.slice(0, 200)
    } catch { /* leave null */ }
    const err = new Error(`brave ${endpoint} HTTP ${res.status}`)
    err.status = res.status
    err.code = code
    err.ms = ms
    throw err
  }
  return { data: await res.json(), ms }
}

function scoreWeb (d) {
  const rs = d?.web?.results || []
  const ru = rs.filter(r => r?.url && isRuHost(r.url)).length
  const chars = rs.reduce((s, r) => s + String(r.description || '').length +
    (r.extra_snippets || []).reduce((a, x) => a + String(x || '').length, 0), 0)
  return { sources: rs.length, ruSources: ru, ruPct: rs.length ? +(100 * ru / rs.length).toFixed(1) : 0, chars }
}

function scoreCtx (d) {
  const gs = d?.grounding?.generic || []
  const ru = gs.filter(g => g?.url && isRuHost(g.url)).length
  const chars = gs.reduce((s, g) => s + (g.snippets || []).reduce((a, x) => a + String(x || '').length, 0), 0)
  return { sources: gs.length, ruSources: ru, ruPct: gs.length ? +(100 * ru / gs.length).toFixed(1) : 0, chars }
}

function explain (status, code) {
  // Brave returns 422 for BOTH a malformed parameter and a rejected token, so the error
  // code decides which. Before concluding a key is revoked, check that the key being SENT
  // is the one you think: a stale BRAVE_API_KEY in the ambient environment shadowing
  // .env.local produces exactly this error on every single request.
  if (code === 'SUBSCRIPTION_TOKEN_INVALID') return 'token rejected — verify WHICH key is being sent (ambient env can shadow .env.local) before assuming revocation'
  if (status === 401) return 'key rejected — stop and ask the operator, do not retry'
  if (status === 403) return 'plan does not include this endpoint (legacy plan needs migration, not upgrade)'
  if (status === 404) return 'endpoint absent at this path — fall back to /web/search with extra_snippets=1'
  if (status === 429) return 'rate limited — slow down'
  if (status === 422) return 'parameter rejected — check count/country/result_filter ranges'
  return 'unexpected status'
}

function arg (name, dflt) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

async function main () {
  const n = Number(arg('--n', '5'))
  const outPath = arg('--out', 'bench/ru/locale_probe.json')
  const dry = process.argv.includes('--dry-run')

  const questions = readFileSync(arg('--questions', 'bench/ru/questions.jsonl'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).slice(0, n)

  const plan = questions.length * 3
  console.log(`plan: ${questions.length} queries × 3 calls = ${plan} paid requests ≈ $${(plan * PRICE_PER_REQUEST).toFixed(3)}`)
  if (dry) { console.log('--dry-run: nothing sent'); return }

  const key = loadKey()
  if (!key) { console.error('BRAVE_API_KEY not found in env or .env.local — stopping, nothing sent.'); process.exit(1) }

  const rows = []
  let spent = 0

  for (const q of questions) {
    const row = { id: q.id, question: q.question }
    // Same query, three ways: web@us (today's default), web@ru, context@ru.
    const variants = [
      ['web_us', 'web', { q: q.question, count: 20, country: 'us', search_lang: 'en', extra_snippets: 1, result_filter: 'web,news,discussions,faq' }],
      ['web_ru', 'web', { q: q.question, count: 20, country: 'ru', search_lang: 'ru', extra_snippets: 1, result_filter: 'web,news,discussions,faq' }],
      ['ctx_ru', 'llm/context', { q: q.question, count: 20, country: 'ru', search_lang: 'ru', context_threshold_mode: 'strict' }]
    ]

    for (const [label, endpoint, params] of variants) {
      await sleep(1000 / RPS)
      try {
        const { data, ms } = await call(endpoint, params, key)
        spent++
        const sc = endpoint === 'web' ? scoreWeb(data) : scoreCtx(data)
        row[label] = { ms, ...sc }
        console.log(`  [${spent}/${plan}] ${q.id} ${label}: ${ms}ms  sources=${sc.sources}  ru=${sc.ruPct}%  chars=${sc.chars}`)
      } catch (e) {
        spent++
        row[label] = { error: e.status || String(e.message), code: e.code || null, note: explain(e.status, e.code), ms: e.ms || null }
        console.log(`  [${spent}/${plan}] ${q.id} ${label}: HTTP ${e.status} ${e.code || ''} — ${explain(e.status, e.code)}`)
        if (e.status === 401 || e.status === 403) {
          console.error('\nSTOPPING: key/plan problem. Nothing further sent.')
          writeFileSync('bench/ru/locale_probe_partial.json', JSON.stringify(rows, null, 2))
          process.exit(2)
        }
        // Back off hard on throttling and on a token rejection that may be throttling in
        // disguise; two in a row on the same variant means stop rather than burn the budget.
        if (e.status === 429 || e.code === 'SUBSCRIPTION_TOKEN_INVALID') await sleep(5000)
      }
    }
    rows.push(row)
  }

  const avg = (key1, field) => {
    const v = rows.map(r => r[key1]?.[field]).filter(x => typeof x === 'number')
    return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null
  }
  const p = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length * 0.95)] : null }
  const lat = k => rows.map(r => r[k]?.ms).filter(x => typeof x === 'number')

  const summary = {
    queries: rows.length, paidRequests: spent, usd: +(spent * PRICE_PER_REQUEST).toFixed(3),
    latencyMs: {
      web_us: { mean: avg('web_us', 'ms'), p95: p(lat('web_us')) },
      web_ru: { mean: avg('web_ru', 'ms'), p95: p(lat('web_ru')) },
      ctx_ru: { mean: avg('ctx_ru', 'ms'), p95: p(lat('ctx_ru')) }
    },
    ruSharePct: { web_us: avg('web_us', 'ruPct'), web_ru: avg('web_ru', 'ruPct'), ctx_ru: avg('ctx_ru', 'ruPct') },
    sources: { web_us: avg('web_us', 'sources'), web_ru: avg('web_ru', 'sources'), ctx_ru: avg('ctx_ru', 'sources') },
    chars: { web_us: avg('web_us', 'chars'), web_ru: avg('web_ru', 'chars'), ctx_ru: avg('ctx_ru', 'chars') }
  }

  console.log('\nPAIRED LOCALE A/B + LATENCY (same query, three ways)')
  console.log('='.repeat(64))
  console.log(`paid requests: ${summary.paidRequests}  ≈ $${summary.usd}`)
  console.log('')
  console.log('                    web@us      web@ru      context@ru')
  const row3 = (name, o) => console.log(`  ${name.padEnd(16)}${String(o.web_us ?? '-').padStart(10)}${String(o.web_ru ?? '-').padStart(12)}${String(o.ctx_ru ?? '-').padStart(14)}`)
  row3('latency mean ms', { web_us: summary.latencyMs.web_us.mean, web_ru: summary.latencyMs.web_ru.mean, ctx_ru: summary.latencyMs.ctx_ru.mean })
  row3('latency p95 ms', { web_us: summary.latencyMs.web_us.p95, web_ru: summary.latencyMs.web_ru.p95, ctx_ru: summary.latencyMs.ctx_ru.p95 })
  row3('RU sources %', summary.ruSharePct)
  row3('sources', summary.sources)
  row3('chars', summary.chars)

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), summary, rows }, null, 2))
  console.log(`\nwrote ${outPath}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
