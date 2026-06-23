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

/**
 * @param {{sweepCount?:number, engineDiversity?:number, topicDiversity?:number, daysSinceLastSeen?:number|null}} f
 * @param {{decayK?:number}} [opts]
 * @returns {number}
 */
export function computeTrust (f, opts = {}) {
  const sweepCount = f.sweepCount || 0
  const engineDiversity = f.engineDiversity || 0
  const topicDiversity = f.topicDiversity || 1
  const base = Math.log(sweepCount + 1) * engineDiversity * topicDiversity
  const k = opts.decayK ?? DECAY_K
  const days = f.daysSinceLastSeen
  if (k > 0 && Number.isFinite(days) && days >= 0) {
    return base * Math.exp(-k * days)
  }
  return base
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
