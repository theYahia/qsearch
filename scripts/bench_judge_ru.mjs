#!/usr/bin/env node
/**
 * bench_judge_ru.mjs — score EXTRACTION quality per endpoint, separately from synthesis.
 *
 * The volume comparison (endpoint_compare.mjs) says /llm/context returns ~1.8x more text.
 * More text is not the same as more answer. This asks the harder question: given only what
 * each endpoint returned for a query, can the reference answer be supported?
 *
 * Both sides are judged by the SHIPPED judge — `judgePassages` from src/verifier/index.js —
 * so the number measures the same thing the doesitlie leaderboard measures, not a lookalike.
 * Same claim, same ranker, same prompt, temperature 0; only the passages differ.
 *
 * Costs nothing: passages come from responses already on disk, and the judge runs locally
 * (DOESITLIE_JUDGE_PROVIDER=ollama, qwen2.5:14b-instruct).
 *
 * Known limitation, stated rather than hidden: each reference answer is judged as ONE
 * compound claim, so a partially-covered answer scores `Partial` rather than decomposing
 * into atomic facts. That penalty applies identically to both sides, so the COMPARISON
 * holds even though the absolute rate is pessimistic.
 *
 * Usage:
 *   node scripts/bench_judge_ru.mjs [--questions bench/ru/questions.jsonl] [--out bench/ru/results.json]
 *   node scripts/bench_judge_ru.mjs --selftest
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { judgePassages, rankParagraphs } from '../src/verifier/index.js'

/**
 * Equal-budget guard — without it this benchmark measures the harness, not the endpoints.
 *
 * selectExcerpt() hands the judge up to 22 000 characters, while ollamaJudge pins
 * num_ctx to 8192 tokens. Russian tokenizes at roughly 2-2.5 chars/token, so 22 000
 * Cyrillic characters is ~9-10k tokens — past the window. English (~4 chars/token) fits,
 * which is why the mismatch has never shown up on the legal corpus.
 *
 * The bias is not symmetric: /web/search passages average 261 chars, so 40 of them stay
 * under budget, while /llm/context passages average 1077 chars and blow straight through
 * it. Measured on the first run: web scored Supported every time; context returned two
 * aborts and two unparseable replies — an artifact of overflow, not worse extraction.
 *
 * Fix: rank with the SHIPPED ranker, then cap BOTH sides at the same character budget so
 * neither overflows. Same judge, same ranker, same budget; only the passages differ.
 */
const CHAR_BUDGET = Number(process.env.BENCH_CHAR_BUDGET) || 8000

export function cappedParagraphs (claim, paragraphs, budget = CHAR_BUDGET) {
  const ranked = rankParagraphs(claim, paragraphs, 50)
  const out = []
  let used = 0
  for (const p of ranked) {
    if (used + p.length > budget) continue
    out.push(p)
    used += p.length
  }
  // A single passage longer than the whole budget would otherwise yield an empty set.
  if (!out.length && ranked.length) out.push(ranked[0].slice(0, budget))
  return out
}

// Passages exactly as each endpoint hands them to an agent — no cleaning, no enrichment.
export function webParagraphs (j) {
  const out = []
  for (const r of (j?.web?.results || [])) {
    if (r?.description) out.push(String(r.description))
    for (const s of (r?.extra_snippets || [])) if (s) out.push(String(s))
  }
  return out
}

export function ctxParagraphs (j) {
  const out = []
  for (const g of (j?.grounding?.generic || [])) {
    for (const s of (g?.snippets || [])) if (s) out.push(String(s))
  }
  return out
}

const VERDICTS = ['Supported', 'Partial', 'Unsupported', 'Fabricated', 'Error']

function tally (rows, side) {
  const t = Object.fromEntries(VERDICTS.map(v => [v, 0]))
  for (const r of rows) {
    const v = r[side]?.verdict
    if (v in t) t[v]++; else t.Error++
  }
  const n = rows.length || 1
  return { ...t, supportedPct: +(100 * t.Supported / n).toFixed(1), supportedOrPartialPct: +(100 * (t.Supported + t.Partial) / n).toFixed(1) }
}

function arg (name, dflt) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

function selftest () {
  const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m) }
  const w = webParagraphs({ web: { results: [
    { description: 'd1', extra_snippets: ['s1', '', 's2'] },
    { description: '', extra_snippets: ['s3'] }
  ] } })
  ok(w.length === 4, `web paragraphs flattened, got ${w.length}`)
  ok(w[0] === 'd1' && w[3] === 's3', 'order preserved')
  const c = ctxParagraphs({ grounding: { generic: [
    { snippets: ['a', 'b'] }, { snippets: [] }, { snippets: ['c'] }
  ] } })
  ok(c.length === 3, `ctx paragraphs flattened, got ${c.length}`)
  ok(webParagraphs({}).length === 0 && ctxParagraphs({}).length === 0, 'empty input safe')

  const t = tally([
    { web: { verdict: 'Supported' } }, { web: { verdict: 'Partial' } },
    { web: { verdict: 'Unsupported' } }, { web: { verdict: 'weird' } }
  ], 'web')
  ok(t.Supported === 1 && t.Partial === 1 && t.Unsupported === 1, 'verdict counts')
  ok(t.Error === 1, 'unknown verdict falls into Error, never silently dropped')
  ok(t.supportedPct === 25 && t.supportedOrPartialPct === 50, 'rates')

  // The equal-budget guard is the whole reason this comparison is trustworthy — test it.
  const long = ['лимит дохода самозанятого составляет 2,4 млн рублей '.repeat(60), 'короткий нерелевантный кусок']
  const capped = cappedParagraphs('лимит самозанятого 2,4 млн', long, 500)
  ok(capped.reduce((s, x) => s + x.length, 0) <= 500, 'budget respected')
  ok(capped.length >= 1, 'never returns empty when input is non-empty')
  const both = cappedParagraphs('x', ['a'.repeat(900)], 500)
  ok(both.length === 1 && both[0].length === 500, 'oversized single passage is truncated, not dropped')
  ok(cappedParagraphs('x', [], 500).length === 0, 'empty input stays empty')

  console.log('selftest: 12 assertions OK')
}

async function main () {
  if (process.argv.includes('--selftest')) return selftest()

  // Force the free local judge unless the caller explicitly overrides it — this harness
  // should never quietly spend DeepSeek credit.
  if (!process.env.DOESITLIE_JUDGE_PROVIDER) process.env.DOESITLIE_JUDGE_PROVIDER = 'ollama'

  const qPath = arg('--questions', 'bench/ru/questions.jsonl')
  const outPath = arg('--out', 'bench/ru/results.json')

  // Strip a UTF-8 BOM: Windows PowerShell's `Set-Content -Encoding utf8` writes one, and it
  // turns the first line into invalid JSON with a thoroughly unhelpful error.
  const questions = readFileSync(qPath, 'utf8').replace(/^﻿/, '')
    .split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l))
  process.stderr.write(`judging ${questions.length} questions × 2 endpoints (provider=${process.env.DOESITLIE_JUDGE_PROVIDER})\n`)

  const rows = []
  for (const q of questions) {
    const webPath = q.pair_web
    const ctxPath = webPath.replace(/\.json$/, '__context.json')
    let jw, jc
    try {
      jw = JSON.parse(readFileSync(webPath, 'utf8'))
      jc = JSON.parse(readFileSync(ctxPath, 'utf8'))
    } catch (e) {
      process.stderr.write(`  ${q.id}: SKIP (${e.message})\n`)
      continue
    }

    const wpAll = webParagraphs(jw)
    const cpAll = ctxParagraphs(jc)
    const wp = cappedParagraphs(q.reference_answer, wpAll)
    const cp = cappedParagraphs(q.reference_answer, cpAll)
    const chars = a => a.reduce((s, x) => s + x.length, 0)
    process.stderr.write(`  ${q.id}: web ${wp.length}/${wpAll.length} passages (${chars(wp)} ch) / context ${cp.length}/${cpAll.length} (${chars(cp)} ch) …\n`)

    // Sequential on purpose. Judging both sides concurrently puts two 14B generations on
    // one GPU at once; Ollama returns an error rather than queueing, and every verdict comes
    // back `Error`. One at a time is slower (~2 min per call) and actually works.
    const web = await judgePassages({ claim: q.reference_answer, paragraphs: wp })
    const context = await judgePassages({ claim: q.reference_answer, paragraphs: cp })
    for (const [side, r] of [['web', web], ['context', context]]) {
      if (r.error) process.stderr.write(`     ! ${side} judge error: ${r.error}\n`)
    }

    rows.push({
      id: q.id, form: q.form, type: q.type, country: q.country,
      // Which side the reference was written from. The whole comparison hinges on this:
      // a context win inside the `web` group means real density; a win only inside the
      // `context` group means the result was an artefact of how the reference was authored.
      reference_from: q.reference_from || 'unknown',
      webPassages: wp.length, ctxPassages: cp.length,
      webPassagesAvailable: wpAll.length, ctxPassagesAvailable: cpAll.length,
      webChars: chars(wp), ctxChars: chars(cp),
      web: { verdict: web.verdict, confidence: web.confidence, error: web.error, evidence: (web.evidence || '').slice(0, 300) },
      context: { verdict: context.verdict, confidence: context.confidence, error: context.error, evidence: (context.evidence || '').slice(0, 300) }
    })
    process.stderr.write(`     web=${web.verdict}  context=${context.verdict}\n`)
  }

  const summary = { n: rows.length, web: tally(rows, 'web'), context: tally(rows, 'context') }

  console.log('\nEXTRACTION QUALITY — same claim, same judge, different passages')
  console.log('='.repeat(66))
  console.log(`questions judged: ${summary.n}`)
  console.log('')
  console.log('verdict           /web/search    /llm/context')
  for (const v of VERDICTS) {
    console.log(`  ${v.padEnd(14)}${String(summary.web[v]).padStart(9)}${String(summary.context[v]).padStart(16)}`)
  }
  console.log('')
  console.log(`  Supported %   ${String(summary.web.supportedPct).padStart(9)}${String(summary.context.supportedPct).padStart(16)}`)
  console.log(`  +Partial %    ${String(summary.web.supportedOrPartialPct).padStart(9)}${String(summary.context.supportedOrPartialPct).padStart(16)}`)
  console.log('')
  console.log('BY REFERENCE PROVENANCE — this is the discriminating cut, not the total')
  console.log('group        n   web Supported%   context Supported%   Δ')
  const byGroup = {}
  for (const g of ['web', 'context', 'independent', 'unknown']) {
    const sub = rows.filter(r => r.reference_from === g)
    if (!sub.length) continue
    const w = tally(sub, 'web')
    const c = tally(sub, 'context')
    byGroup[g] = { n: sub.length, web: w, context: c, deltaPp: +(c.supportedPct - w.supportedPct).toFixed(1) }
    console.log(`  ${g.padEnd(12)}${String(sub.length).padStart(2)}   ${String(w.supportedPct).padStart(11)}   ${String(c.supportedPct).padStart(18)}   ${byGroup[g].deltaPp >= 0 ? '+' : ''}${byGroup[g].deltaPp}`)
  }
  console.log('')
  console.log('  web group        → reference written from web snippets only.')
  console.log('                     context winning HERE means genuine density.')
  console.log('  context group    → reference written from context passages only.')
  console.log('                     a win only HERE means the 90-vs-70 result was authoring bias.')
  console.log('  independent group→ reference from the primary legal text, neither side.')
  console.log('                     the unbiased read; the only group where Unsupported is possible.')
  console.log('')
  console.log('per question:')
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(28)} ${String(r.reference_from).padEnd(12)} ${String(r.web.verdict).padEnd(12)} ${String(r.context.verdict).padEnd(12)} (${r.webPassages} vs ${r.ctxPassages})`)
  }
  summary.byGroup = byGroup

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify({
    generated: new Date().toISOString(),
    judge: process.env.DOESITLIE_JUDGE_MODEL || 'qwen2.5:14b-instruct',
    provider: process.env.DOESITLIE_JUDGE_PROVIDER,
    summary, rows
  }, null, 2))
  process.stderr.write(`\nwrote ${outPath}\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
