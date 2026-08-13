// NDCG — Normalized Discounted Cumulative Gain (Tier 4 quality validation, 2026-06-23).
//
// Pure, dependency-free ranking-quality metric. Used by scripts/rerank_benchmark.js to
// answer "does embedding rerank actually improve ordering, or just shuffle?" — the
// question the rerank pipeline ships without an answer to (ANALYSIS-2026-06-23.md T4).
//
// gains: array of relevance grades in the RANKED order produced by the system
//        (e.g. [3, 0, 2, 1] = top result graded 3, second 0, …). Higher = more relevant.
// k:     cutoff rank (NDCG@k).

export function dcg (gains, k = gains.length) {
  let sum = 0
  const n = Math.min(k, gains.length)
  for (let i = 0; i < n; i++) {
    const g = gains[i] || 0
    // log2(i+2): position 0 → /log2(2)=1, position 1 → /log2(3), …
    sum += (Math.pow(2, g) - 1) / Math.log2(i + 2)
  }
  return sum
}

// idcg = DCG of the ideal ordering (gains sorted descending).
export function idcg (gains, k = gains.length) {
  return dcg([...gains].sort((a, b) => b - a), k)
}

// NDCG@k ∈ [0, 1]. 1 = perfect ordering; returns 0 when no relevant items exist.
export function ndcg (gains, k = gains.length) {
  const ideal = idcg(gains, k)
  if (ideal === 0) return 0
  return dcg(gains, k) / ideal
}

/**
 * URL keys have to match exactly for a grade to be found, and they routinely do not:
 * the golden set is hand-written with trailing slashes while the corpus stores URLs
 * through canonicalizeUrl. Every mismatch silently becomes grade 0 — a false miss that
 * looks like a ranking failure.
 */
export function normalizeUrlKey (url) {
  try {
    const u = new URL(String(url))
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    u.protocol = 'https:'
    let s = u.toString()
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1)
    return s
  } catch { return String(url).trim().toLowerCase() }
}

/**
 * Given a ranked list of result URLs and a relevance map (url → grade), compute NDCG@k.
 * Unknown URLs grade 0.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.idealFromGolden=false]
 *   false → legacy behaviour: the ideal is the best ordering of WHAT WAS RETRIEVED.
 *           That is not standard NDCG and it is blind to recall: a system that returns
 *           one relevant document out of three, at rank 1, scores a perfect 1.000. It
 *           therefore REWARDS dropping results — which is exactly what the rerank pipeline
 *           does (topN 10, then topOut 5), so the legacy metric cannot be used to judge it.
 *   true  → the ideal is the best ordering of the whole golden set. Standard NDCG,
 *           recall-aware, and the only version that can honestly compare a pipeline that
 *           truncates against one that does not.
 * @param {boolean} [opts.normalizeUrls=false] — canonicalise both sides before matching.
 */
export function ndcgForRanking (rankedUrls, relevance, k = rankedUrls.length, opts = {}) {
  let grades = relevance
  let ranked = rankedUrls
  if (opts.normalizeUrls) {
    grades = {}
    for (const [u, g] of Object.entries(relevance || {})) grades[normalizeUrlKey(u)] = g
    ranked = rankedUrls.map(normalizeUrlKey)
  }

  const gains = ranked.map(u => grades[u] || 0)
  if (!opts.idealFromGolden) return ndcg(gains, k)

  const idealGains = Object.values(grades).map(Number).filter(Number.isFinite).sort((a, b) => b - a)
  const ideal = dcg(idealGains, k)
  if (ideal === 0) return 0
  return dcg(gains, k) / ideal
}
