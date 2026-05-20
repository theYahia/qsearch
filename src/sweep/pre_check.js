// rd275: /pre_sweep_check — Lever C.
//
// Reads queries.txt-style payload, asks: "is the corpus already covered for
// these queries?" Returns per-query verdict (covered / partial / miss) + an
// overall verdict (skip_sweep / partial_sweep / run_sweep). The caller —
// brave_sweep.py with --use-pre-check — drops covered queries before paying
// Brave-API cents, or aborts the whole sprint when coverage is high enough.
//
// Conservative defaults: overlap_threshold 0.6 (not 0.5) — false-positive
// "covered" verdict is worse than a wasted sweep. Per-query "covered" requires
// >5 fresh high-trust hits, not just topical match.

const DEFAULT_FRESHNESS_DAYS = 7
const DEFAULT_OVERLAP_THRESHOLD = 0.6
const DEFAULT_LIMIT_PER_QUERY = 20
const HIGH_TRUST_ENGINE_COUNT = 3
const COVERED_MIN_FRESH_HIGH_TRUST = 5
const PARTIAL_MIN_FRESH_HIGH_TRUST = 1

/**
 * @param {Object} args
 * @param {string[]} args.queries          — flat query strings (label stripped by caller)
 * @param {number}   [args.freshness_days] — TTL window in days (default 7)
 * @param {number}   [args.overlap_threshold] — overall coverage gate (default 0.6)
 * @param {number}   [args.limit_per_query]   — Meilisearch limit per query (default 20)
 * @param {Object}   meiliIndex             — Meilisearch index handle (meili._client.index(...))
 */
export async function runPreSweepCheck (args, meiliIndex) {
  const queries = (args.queries || []).map(q => String(q || '').trim()).filter(Boolean)
  if (!queries.length) {
    return { skip_sweep: false, coverage: [], overall_coverage: 0, recommendation: 'no_queries', skip_queries: [] }
  }

  const freshnessDays = Number(args.freshness_days) || DEFAULT_FRESHNESS_DAYS
  const threshold = Number(args.overlap_threshold) || DEFAULT_OVERLAP_THRESHOLD
  const limit = Number(args.limit_per_query) || DEFAULT_LIMIT_PER_QUERY
  const freshCutoffMs = Date.now() - freshnessDays * 86_400_000
  const freshCutoffIso = new Date(freshCutoffMs).toISOString()

  const coverage = []
  for (const query of queries) {
    let hits = []
    try {
      const r = await meiliIndex.search(query, {
        limit,
        attributesToRetrieve: ['url', 'title', 'engine_count', 'crawled_at', 'appeared_in_sweeps']
      })
      hits = r.hits || []
    } catch (e) {
      coverage.push({ query, corpus_hits: 0, high_trust: 0, fresh_hits: 0, fresh_ratio: 0, verdict: 'miss', error: e.message })
      continue
    }

    const corpusHits = hits.length
    const fresh = hits.filter(h => h.crawled_at && h.crawled_at >= freshCutoffIso)
    const freshHighTrust = fresh.filter(h => (h.engine_count || 0) >= HIGH_TRUST_ENGINE_COUNT)

    let verdict
    if (freshHighTrust.length >= COVERED_MIN_FRESH_HIGH_TRUST) verdict = 'covered'
    else if (freshHighTrust.length >= PARTIAL_MIN_FRESH_HIGH_TRUST) verdict = 'partial'
    else verdict = 'miss'

    coverage.push({
      query,
      corpus_hits: corpusHits,
      high_trust: hits.filter(h => (h.engine_count || 0) >= HIGH_TRUST_ENGINE_COUNT).length,
      fresh_hits: fresh.length,
      fresh_high_trust: freshHighTrust.length,
      fresh_ratio: corpusHits > 0 ? Number((fresh.length / corpusHits).toFixed(3)) : 0,
      verdict
    })
  }

  const coveredCount = coverage.filter(c => c.verdict === 'covered').length
  const overallCoverage = Number((coveredCount / queries.length).toFixed(3))
  const skipQueries = coverage.filter(c => c.verdict === 'covered').map(c => c.query)

  let recommendation
  if (overallCoverage >= threshold) recommendation = 'skip_sweep'
  else if (skipQueries.length > 0) recommendation = 'partial_sweep'
  else recommendation = 'run_sweep'

  return {
    skip_sweep: overallCoverage >= threshold,
    coverage,
    overall_coverage: overallCoverage,
    recommendation,
    skip_queries: skipQueries,
    params: { freshness_days: freshnessDays, overlap_threshold: threshold, limit_per_query: limit }
  }
}
