// qsearch RaaS — source-tier classification.
//
// Assigns each candidate source a quality tier so the triangulation gate (triangulate.js)
// can enforce a tier floor on load-bearing claims. Tiers follow the CLAUDE.md heavy-max
// "Source priority tiers":
//   1A — peer-review / financial filings / Tadviser PRO / IDC-class
//   1B — regulatory / government registries / official guidelines
//   2  — mainstream press
//   3  — industry references / vendor docs
//   4  — community (forums, Reddit, Q&A)
//   excluded — content farms, known SEO-spam — dropped before verify
//
// The domain→tier mapping is a curated SEED that the operator MUST review/expand before the
// first paid report (build-spec §f open-question 3). It is intentionally conservative: an
// unmapped domain falls back to a provenance heuristic (multi-engine agreement → tier 3, else 4),
// never silently to "authoritative".

/** @typedef {'1A'|'1B'|'2'|'3'|'4'|'excluded'} Tier */

/**
 * Seed mapping (host or eTLD+1 → tier). Entries may be a full hostname (pubmed.ncbi.nlm.nih.gov)
 * OR a registrable domain (arxiv.org); tierOf walks the host chain so both forms match.
 * @type {Record<string, Tier>}
 */
export const TIER_BY_DOMAIN = {
  // 1A — peer-review / primary data
  'arxiv.org': '1A',
  'pubmed.ncbi.nlm.nih.gov': '1A',
  'ncbi.nlm.nih.gov': '1A',
  'semanticscholar.org': '1A',
  'sec.gov': '1A',
  'nature.com': '1A',
  'sciencedirect.com': '1A',
  // 1B — regulatory / government
  'europa.eu': '1B',
  'gov.uk': '1B',
  'courtlistener.com': '1B',
  'consultant.ru': '1B',
  'pravo.gov.ru': '1B',
  // 2 — mainstream press
  'reuters.com': '2',
  'bloomberg.com': '2',
  'ft.com': '2',
  'nytimes.com': '2',
  'wsj.com': '2',
  // 4 — community
  'reddit.com': '4',
  'news.ycombinator.com': '4',
  'quora.com': '4',
  'medium.com': '4',
  // excluded
  'example-content-farm.com': 'excluded'
}

/** Tier rank for floor comparisons (lower = more authoritative). */
const TIER_RANK = { '1A': 0, '1B': 1, 2: 2, 3: 3, 4: 4, excluded: 99 }

/** Numeric rank of a tier (99 for unknown). Exported so the gate can pick the best tier per domain. */
export function tierRank (tier) { return TIER_RANK[tier] ?? 99 }

// Public-suffixes with two labels, so eTLD+1 (the independence key) is computed correctly:
// legislation.gov.uk and parliament.gov.uk are DISTINCT registrable domains, not both "gov.uk".
const MULTI_SUFFIX = new Set([
  'co.uk', 'gov.uk', 'org.uk', 'ac.uk', 'net.uk', 'sch.uk', 'nhs.uk', 'police.uk', 'mod.uk', 'parliament.uk',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au', 'co.nz', 'govt.nz', 'org.nz',
  'co.jp', 'or.jp', 'ne.jp', 'go.jp', 'ac.jp', 'co.kr', 'or.kr', 'go.kr',
  'com.br', 'gov.br', 'org.br', 'com.cn', 'gov.cn', 'org.cn', 'edu.cn',
  'co.in', 'gov.in', 'org.in', 'co.za', 'org.za', 'gov.za', 'com.sg', 'gov.sg',
  'com.tr', 'gov.tr', 'com.mx', 'gob.mx', 'com.ar', 'gob.ar',
  'com.ua', 'gov.ua', 'org.ua', 'com.ru', 'net.ru', 'org.ru', 'gov.ru'
])

/**
 * Extract the registrable domain (eTLD+1) used as the independence/tier key.
 * Handles common two-label public suffixes (.co.uk, .gov.uk, .com.br, …); falls back to the
 * last two labels otherwise. Not a full PSL — swap for `tldts`/`psl` before high-stakes production.
 * @param {string} url
 * @returns {string} registrable domain, or '' if unparseable
 */
export function registrableDomain (url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    const parts = host.split('.')
    if (parts.length <= 2) return host
    const lastTwo = parts.slice(-2).join('.')
    if (MULTI_SUFFIX.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.')
    return lastTwo
  } catch {
    return ''
  }
}

/** Host chain from most-specific host down to the registrable domain (for tier-map lookup). */
function hostChain (url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    const reg = registrableDomain(url)
    const parts = host.split('.')
    const out = []
    for (let i = 0; i < parts.length; i++) {
      const cand = parts.slice(i).join('.')
      out.push(cand)
      if (cand === reg) break
    }
    if (reg && !out.includes(reg)) out.push(reg)
    return out
  } catch {
    return []
  }
}

/**
 * Classify a candidate source into a tier.
 * Order: explicit domain/host map (most-specific match wins) → provenance fallback
 * (multi-engine agreement nudges an unknown domain up to tier 3, single-engine stays tier 4).
 * @param {{ url: string, engine_count?: number }} source
 * @returns {Tier}
 */
export function tierOf (source) {
  for (const key of hostChain(source.url)) {
    if (TIER_BY_DOMAIN[key]) return TIER_BY_DOMAIN[key]
  }
  return (source.engine_count ?? 1) >= 3 ? '3' : '4'
}

/**
 * True if `tier` is at least as authoritative as `floor` (e.g. meetsFloor('1B','2') === true).
 * @param {Tier} tier
 * @param {Tier} floor
 * @returns {boolean}
 */
export function meetsFloor (tier, floor) {
  return tierRank(tier) <= tierRank(floor)
}

/** Convenience: is this source excluded (drop before verify)? Walks the host chain. */
export function isExcluded (source) {
  for (const key of hostChain(source.url)) {
    if (TIER_BY_DOMAIN[key] === 'excluded') return true
  }
  return false
}
