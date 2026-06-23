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
 * Convenience: given a ranked list of result URLs and a relevance map (url → grade),
 * compute NDCG@k. Unknown URLs grade 0.
 */
export function ndcgForRanking (rankedUrls, relevance, k = rankedUrls.length) {
  const gains = rankedUrls.map(u => relevance[u] || 0)
  return ndcg(gains, k)
}
