// Layer 8 quality gate — composite score + rejection threshold.
// Target rejection rate ~60-75% per ARCHITECTURE.md (~72% target).
//
// Composite score combines four signals each normalized to [0, 1]:
//   embedding   — cosine sim from Stage 1 rerank (already 0-1)
//   llm         — Stage 2 score (1-5 → (x-1)/4)
//   authority   — static table from URL host (peer-review > .gov/.edu > news > blogs)
//   trust       — corpus-history trust score from src/search/rerank.js (log-normalized)
//
// Weights tunable via QSEARCH_QUALITY_WEIGHTS (JSON: {emb:0.4,auth:0.3,llm:0.2,trust:0.1}).
// Threshold via QSEARCH_QUALITY_THRESHOLD (default 0.4).

const DEFAULT_WEIGHTS = { emb: 0.4, auth: 0.3, llm: 0.2, trust: 0.1 }
const DEFAULT_THRESHOLD = parseFloat(process.env.QSEARCH_QUALITY_THRESHOLD || '0.4')

function loadWeights () {
  const raw = process.env.QSEARCH_QUALITY_WEIGHTS
  if (!raw) return DEFAULT_WEIGHTS
  try {
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_WEIGHTS, ...parsed }
  } catch { return DEFAULT_WEIGHTS }
}

// Static authority table — keyed by source field or URL host suffix match.
// Override individual values via JSON in QSEARCH_QUALITY_AUTHORITY env.
const DEFAULT_AUTHORITY = {
  // by source field
  arxiv: 1.0,
  pubmed: 1.0,
  semanticscholar: 1.0,
  yandex: 0.6,
  searxng: 0.5,
  // by URL host suffix
  '.gov': 0.95,
  '.edu': 0.9,
  '.org': 0.65,
  // by content type / domain heuristics
  'nature.com': 1.0,
  'science.org': 1.0,
  'nih.gov': 1.0,
  'doi.org': 0.95,
  'wikipedia.org': 0.7,
  'github.com': 0.65,
  'reddit.com': 0.3,
  'stackoverflow.com': 0.55,
  'medium.com': 0.35,
  'substack.com': 0.4
}

function loadAuthority () {
  const raw = process.env.QSEARCH_QUALITY_AUTHORITY
  if (!raw) return DEFAULT_AUTHORITY
  try {
    return { ...DEFAULT_AUTHORITY, ...JSON.parse(raw) }
  } catch { return DEFAULT_AUTHORITY }
}

// Backends that directly indicate content authority (vs general-web routers).
const CONTENT_SOURCES = new Set(['arxiv', 'pubmed', 'semanticscholar'])

function authorityFor (result, table) {
  // For academic backends, source field IS the authority signal (paper repository).
  if (result.source && CONTENT_SOURCES.has(result.source) && table[result.source] != null) {
    return table[result.source]
  }
  // For general-web backends (searxng, brave, yandex), authority comes from URL host.
  let host = ''
  try { host = new URL(result.url).hostname.toLowerCase() } catch { return 0.4 }
  if (table[host] != null) return table[host]
  const stripped = host.replace(/^www\./, '')
  if (table[stripped] != null) return table[stripped]
  for (const key of Object.keys(table)) {
    if (key.startsWith('.') && host.endsWith(key)) return table[key]
  }
  // Fallback for unknown host: source-level signal (yandex=0.6, searxng=0.5) if set,
  // else default below threshold so unrecognized hosts need other signals to survive.
  if (result.source && table[result.source] != null) return table[result.source]
  return 0.35
}

function normalizeTrust (trustScore) {
  if (!trustScore || trustScore <= 0) return 0
  // rerankByTrust returns log(sweep_count+1) × diversity → typically 0..3-ish.
  // Saturate at 2 for our 0-1 normalization.
  return Math.min(1, trustScore / 2)
}

function normalizeLlm (score) {
  if (!score) return 0
  return Math.max(0, Math.min(1, (score - 1) / 4))
}

export function compositeScore (result, opts = {}) {
  const w = opts.weights || loadWeights()
  const auth = opts.authority || loadAuthority()
  const emb = result._rerank_score || 0
  const llm = normalizeLlm(result._rerank_score_llm)
  const trust = normalizeTrust(result.trust_score)
  const authority = authorityFor(result, auth)
  return {
    composite: (w.emb * emb) + (w.auth * authority) + (w.llm * llm) + (w.trust * trust),
    parts: { emb, llm, authority, trust }
  }
}

export function applyQualityGate (results, opts = {}) {
  if (!Array.isArray(results) || !results.length) {
    return { kept: results || [], rejected: [], rejection_rate: 0 }
  }
  const threshold = opts.threshold != null ? opts.threshold : DEFAULT_THRESHOLD
  const kept = []
  const rejected = []
  for (const r of results) {
    const { composite, parts } = compositeScore(r, opts)
    const annotated = { ...r, _quality_composite: Number(composite.toFixed(3)), _quality_parts: parts }
    if (composite >= threshold) kept.push(annotated)
    else rejected.push(annotated)
  }
  return {
    kept,
    rejected,
    rejection_rate: Number((rejected.length / results.length).toFixed(3)),
    threshold
  }
}
