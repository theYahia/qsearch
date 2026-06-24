#!/usr/bin/env node
// doesitlie — staging cache pruner.
//
// PURPOSE
//   The committed verdict cache (bench/.cache) holds 972 .json files — every (judge,url,claim)
//   verdict ever computed across BOTH judges (ollama qwen2.5:14b AND deepseek:deepseek-chat) and
//   across runs that never made it into the published audit. The PUBLISHED benchmark (the array in
//   bench/out/all/audit.json) contains exactly 273 results, judged by DeepSeek. Shipping all 972
//   .cache files bloats the public repo with stale/foreign verdicts. This script copies ONLY the
//   273 cache files that back the published audit into the staging tree.
//
// HOW (deterministic, NO re-judge — zero API/network calls)
//   The cache key is reconstructed DOSLOVNO from src/verifier/index.js (line ~186):
//     k = sha256(`${CACHE_VERSION}|${judgeLabel()}|${input.url}|${input.claim}`).hex
//   with CACHE_VERSION='v7' (verifier.js line 175) and, for the PUBLISHED run, the DeepSeek judge:
//     judgeLabel() === `deepseek:${DEEPSEEK_MODEL}` === 'deepseek:deepseek-chat'
//     (verifier.js lines 105 + 108-111; DEEPSEEK_MODEL defaults to 'deepseek-chat').
//   The url/claim are used RAW (verbatim) — verifier.js does NOT normalize them before hashing —
//   so we feed result.source_url and result.claim straight from audit.json. (Empirically verified:
//   273/273 reconstruct, and each hit's cached {source_url,claim,verdict} equals the audit record.)
//
//   ⚠️ Published judge = DeepSeek. Under 'v7|deepseek:deepseek-chat' all 273 hit; under the ollama
//   label only ~90 would — pruning to ollama would silently drop 183 verdicts. We prune to DeepSeek.
//
// USAGE
//   node scripts/prune-cache.mjs            # copy into staging (idempotent)
//   node scripts/prune-cache.mjs --dry-run  # report only, copy nothing

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ── Paths (absolute; this script lives in doesitlie/scripts/) ─────────────────
const PROJECT_ROOT = 'D:/Yahia/active/qsearch/doesitlie'
const SRC_CACHE_DIR = path.join(PROJECT_ROOT, 'bench/.cache')
const AUDIT_JSON = path.join(PROJECT_ROOT, '_publish-staging/doesitlie/bench/out/all/audit.json')
const DST_CACHE_DIR = path.join(PROJECT_ROOT, '_publish-staging/doesitlie/bench/.cache')

// ── Cache-key formula — mirrors src/verifier/index.js verbatim ────────────────
const CACHE_VERSION = 'v7'                      // verifier.js:175
const JUDGE_LABEL = 'deepseek:deepseek-chat'    // judgeLabel() for the PUBLISHED DeepSeek run (verifier.js:105,108-111)
const cacheKey = s => crypto.createHash('sha256').update(s).digest('hex') // verifier.js:176

const DRY_RUN = process.argv.includes('--dry-run')

function main () {
  if (!fs.existsSync(AUDIT_JSON)) { console.error(`FATAL: audit.json not found: ${AUDIT_JSON}`); process.exit(2) }
  if (!fs.existsSync(SRC_CACHE_DIR)) { console.error(`FATAL: source cache dir not found: ${SRC_CACHE_DIR}`); process.exit(2) }

  const sourceCacheCount = fs.readdirSync(SRC_CACHE_DIR).filter(f => f.endsWith('.json')).length

  const audit = JSON.parse(fs.readFileSync(AUDIT_JSON, 'utf-8'))
  if (!Array.isArray(audit)) { console.error('FATAL: audit.json is not an array'); process.exit(2) }

  // Collect every published (url, claim), de-dup by reconstructed key.
  const wantedKeys = new Map() // key -> { agent, url, claim, verdict }
  let publishedResults = 0
  for (const ag of audit) {
    for (const r of (ag.results || [])) {
      publishedResults++
      const key = cacheKey(`${CACHE_VERSION}|${JUDGE_LABEL}|${r.source_url}|${r.claim}`)
      if (!wantedKeys.has(key)) wantedKeys.set(key, { agent: ag.agent, url: r.source_url, claim: r.claim, verdict: r.verdict })
    }
  }

  // Match against the source cache; copy hits.
  if (!DRY_RUN) fs.mkdirSync(DST_CACHE_DIR, { recursive: true })
  let copied = 0
  const missing = []
  for (const [key, meta] of wantedKeys) {
    const src = path.join(SRC_CACHE_DIR, `${key}.json`)
    if (fs.existsSync(src)) {
      if (!DRY_RUN) fs.copyFileSync(src, path.join(DST_CACHE_DIR, `${key}.json`))
      copied++
    } else {
      missing.push({ key, ...meta, claim: String(meta.claim || '').slice(0, 80) })
    }
  }

  const dstCount = fs.existsSync(DST_CACHE_DIR) ? fs.readdirSync(DST_CACHE_DIR).filter(f => f.endsWith('.json')).length : 0

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log('doesitlie cache prune' + (DRY_RUN ? ' (DRY-RUN)' : ''))
  console.log('─'.repeat(56))
  console.log(`CACHE_VERSION       : ${CACHE_VERSION}`)
  console.log(`judgeLabel          : ${JUDGE_LABEL}`)
  console.log(`source cache (all)  : ${sourceCacheCount} files`)
  console.log(`published results   : ${publishedResults}`)
  console.log(`unique cache keys   : ${wantedKeys.size}`)
  console.log(`matched & ${DRY_RUN ? 'would copy' : 'copied   '} : ${copied}`)
  console.log(`missing (no .cache) : ${missing.length}`)
  console.log(`staging .cache now  : ${dstCount} files`)
  console.log('─'.repeat(56))
  if (missing.length) {
    console.log(`[GAP] ${missing.length} published result(s) had NO matching cache file under '${CACHE_VERSION}|${JUDGE_LABEL}'.`)
    console.log('Examples (reconstruction may need adjustment — check url/claim normalization):')
    for (const m of missing.slice(0, 5)) console.log('  ' + JSON.stringify(m))
  } else {
    console.log(`OK: every published verdict (${wantedKeys.size}/${wantedKeys.size}) has a matching cache file — no verdicts lost.`)
  }

  process.exit(missing.length ? 1 : 0)
}

main()
