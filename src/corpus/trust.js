// Single source of truth for the corpus trust formula (2026-06-23).
//
// Before this module the formula lived in three places in meilisearch.js
// (trustScore, topByTrust sort=trust, topByTrust other-sorts) and they had drifted:
// the non-trust sort branch hardcoded topic_diversity=1, so the SAME url returned a
// ~10x lower trust_score depending on ?sort=. This module is the one implementation.
//
//   trust = log(sweep_count + 1) × engine_diversity × topic_diversity × decay
//
// `decay` = exp(-k × days_since_last_seen), enabled only when k > 0
// (QSEARCH_TRUST_DECAY_K, default 0 = off). Decay keeps the corpus responsive to
// topical drift without discarding history. It is OFF by default because k is a
// tuning parameter that should be calibrated against the real corpus age distribution
// before changing a live ranking — see ANALYSIS-2026-06-23.md Tier 2.

export const DECAY_K = Number(process.env.QSEARCH_TRUST_DECAY_K) || 0

// Active trust formula: 'v1' (production default, unchanged) or 'v2' (refined candidate).
// Flip with QSEARCH_TRUST_FORMULA=v2 to roll the candidate into the live ranking — but compare
// first with `node src/corpus/trust_ab.mjs` (this is an A/B switch, never a blind swap).
// Default 'v1' keeps computeTrust byte-identical to the prior implementation.
export const TRUST_VARIANT = (process.env.QSEARCH_TRUST_FORMULA || 'v1').toLowerCase()

function decayFactor (days, k) {
  return (k > 0 && Number.isFinite(days) && days >= 0) ? Math.exp(-k * days) : 1
}

// v1 (production): purely multiplicative. NOTE the collapse property — engineDiversity=0 ⇒ trust=0
// even for a URL seen across many sweeps (e.g. a corpus/academic source with no engines recorded).
// v2 was designed to fix exactly that; A/B before switching.
export function computeTrustV1 (f, opts = {}) {
  const sweepCount = f.sweepCount || 0
  const engineDiversity = f.engineDiversity || 0
  const topicDiversity = f.topicDiversity || 1
  const base = Math.log(sweepCount + 1) * engineDiversity * topicDiversity
  return base * decayFactor(f.daysSinceLastSeen, opts.decayK ?? DECAY_K)
}

// v2 (candidate): same drivers, two deliberate fixes —
//   (1) no zero-collapse: diversity terms become (1 + ln(1+x)), so a missing engine/topic count
//       floors the factor at 1 instead of nuking the whole product to 0;
//   (2) diminishing returns: ln(1+x) compresses the diversity range so one hyper-diverse URL can't
//       dominate the board linearly. sweep_count stays the primary signal.
export function computeTrustV2 (f, opts = {}) {
  const sweepCount = f.sweepCount || 0
  const engineDiversity = Math.max(0, f.engineDiversity || 0)
  const topicDiv = Math.max(0, f.topicDiversity || 0)
  const base = Math.log(sweepCount + 1) * (1 + Math.log1p(engineDiversity)) * (1 + Math.log1p(topicDiv))
  return base * decayFactor(f.daysSinceLastSeen, opts.decayK ?? DECAY_K)
}

/**
 * Dispatch to the active trust formula. Default 'v1' (unchanged production behavior).
 * Pass opts.variant ('v1'|'v2') to force one (the A/B harness does this); otherwise honors TRUST_VARIANT.
 * @param {{sweepCount?:number, engineDiversity?:number, topicDiversity?:number, daysSinceLastSeen?:number|null}} f
 * @param {{decayK?:number, variant?:string}} [opts]
 * @returns {number}
 */
export function computeTrust (f, opts = {}) {
  return (opts.variant || TRUST_VARIANT) === 'v2' ? computeTrustV2(f, opts) : computeTrustV1(f, opts)
}

// Topic is the snake_case prefix of a sweep label ("russia_smb_q1" → "russia").
// Returns null for empty/missing labels so callers can filter them out.
export function topicOf (sweepLabel) {
  if (!sweepLabel) return null
  return String(sweepLabel).split('_')[0] || null
}

// Distinct topics across a set of sweep labels (the topic_diversity term).
export function topicDiversity (sweepLabels) {
  const topics = new Set()
  for (const l of sweepLabels || []) {
    const t = topicOf(l)
    if (t) topics.add(t)
  }
  return topics.size
}

// Whole days between an ISO timestamp and now. null when unknown.
export function daysSince (iso, now = Date.now()) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, (now - t) / 86_400_000)
}

// Most recent crawled_at across a list of {crawled_at} entries (for decay).
export function latestCrawledAt (entries) {
  let latest = null
  for (const e of entries || []) {
    const ts = e?.crawled_at
    if (ts && (!latest || ts > latest)) latest = ts
  }
  return latest
}
