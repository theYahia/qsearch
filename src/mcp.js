// qsearch MCP tool wrapper — integrates qsearch into wdk-mcp-toolkit.
//
// OPTIONAL DEPENDENCY — not imported by server.js.
// Install separately: npm install @modelcontextprotocol/sdk zod
//
// Usage:
//   import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
//   import { qsearchTool } from './mcp.js'
//   const mcpServer = new McpServer({ name: 'qsearch', version: '0.4.0' })
//   qsearchTool(mcpServer)
//
// qsearch HTTP server must be running on localhost:8080 before calling these tools.

import { z } from 'zod'

const QSEARCH_BASE = process.env.QSEARCH_URL || 'http://localhost:8080'

async function callQsearch (path, body) {
  const r = await fetch(`${QSEARCH_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(`qsearch error ${r.status}: ${err.detail || err.error || 'unknown'}`)
  }
  return r.json()
}

async function callQsearchText (path, body) {
  const r = await fetch(`${QSEARCH_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) {
    const err = await r.text().catch(() => '')
    throw new Error(`qsearch error ${r.status}: ${err.slice(0, 200)}`)
  }
  return r.text()
}

export function qsearchTool (server) {
  // --- web_search ---
  const webSearchSchema = z.object({
    query: z.string().describe('Search query'),
    n_results: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(1).max(3)).optional().default(2)
      .describe('Number of results (1-3). Default 2.'),
    clean: z.boolean().optional().default(false)
      .describe('Enable optional result cleaning (requires local LLM). Default false — returns raw multi-engine results immediately.'),
    freshness: z.string().optional()
      .describe('Time filter: pd (past day), pw (past week), pm (past month), py (past year), or YYYY-MM-DDtoYYYY-MM-DD'),
    search_lang: z.string().optional().describe('Language code, e.g. "en", "ru"'),
    country: z.string().optional().describe('Country code, e.g. "us", "ru"'),
    corpus_first: z.boolean().optional()
      .describe('Search the local trust corpus before the web (default true). Set false to skip corpus and go straight to the web.'),
    corpus_only: z.boolean().optional()
      .describe('Return only corpus hits, never call the web (default false). Use for $0 repeat lookups on already-swept topics.')
  })

  server.registerTool(
    'web_search',
    {
      title: 'Web Search (qsearch)',
      description: 'Search the web via Brave + SearXNG with multi-engine provenance. Returns results with engines[] field showing which search engines agreed — higher engine_count = higher trust signal.',
      inputSchema: webSearchSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (params) => {
      const data = await callQsearch('/search', params)
      return {
        content: (data.results || []).map((r) => ({
          type: 'text',
          text: `## ${r.title}\n${r.url}${r.age ? ` (${r.age})` : ''}\n${r.cleaned_markdown || r.description || ''}`
        }))
      }
    }
  )

  // --- news_search ---
  const newsSearchSchema = z.object({
    query: z.string().describe('News search query'),
    n_results: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(1).max(3)).optional().default(1)
      .describe('Number of results (1-3 max — cleaning is CPU-bound, each result adds ~25s. Default 1.)'),
    freshness: z.string().optional().default('pw')
      .describe('Time filter: pd (past day), pw (past week, default), pm (past month)')
  })

  server.registerTool(
    'news_search',
    {
      title: 'News Search (qsearch)',
      description: 'Search recent news with multi-engine attribution. Returns engines[] per result. Defaults to past week.',
      inputSchema: newsSearchSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (params) => {
      const data = await callQsearch('/news', params)
      return {
        content: (data.results || []).map((r) => ({
          type: 'text',
          text: `## ${r.title}\n${r.url}${r.source ? ` — ${r.source}` : ''}${r.age ? ` (${r.age})` : ''}\n${r.cleaned_markdown || r.description || ''}`
        }))
      }
    }
  )

  // --- sweep ---
  const sweepSchema = z.object({
    queries: z.string()
      .describe('Queries in label|query[|priority][|domain] format, one per line. ' +
        'priority ∈ ultra-broad (corpus-only, $0) | broad (SearXNG, $0, default) | focused (Brave web) | critical (Brave + LLM Context). ' +
        'domain ∈ general (default) | scholarly (arxiv+PubMed+S2) | ru (Yandex/SearXNG ru-RU). ' +
        'E.g.: "c1_01|self-hosted search\\nc2_01|qdrant latency 2026|focused\\nsch_01|crispr off-target|broad|scholarly"'),
    save: z.boolean().optional().default(false)
      .describe('Save parsed_snippets.md to ./data/sweeps/<timestamp>/ on the server')
  })

  server.registerTool(
    'sweep',
    {
      title: 'Research Sweep (qsearch)',
      description: 'Run a batch search sweep — accepts label|query lines (same format as brave_sweep.py), fans out queries in parallel, deduplicates results, indexes into corpus, and returns parsed_snippets.md markdown. Free via SearXNG when no Brave key.',
      inputSchema: sweepSchema.shape,
      annotations: { readOnlyHint: false, openWorldHint: true }
    },
    async (params) => {
      const md = await callQsearchText('/sweep', { queries: params.queries, save: params.save })
      return { content: [{ type: 'text', text: md }] }
    }
  )

  // --- index_research ---
  const indexResearchSchema = z.object({
    glob: z.string()
      .describe('Glob pattern matching markdown research files to index. E.g.: "D:/Yahia/active/*/research/*.md"')
  })

  server.registerTool(
    'index_research',
    {
      title: 'Index Research Files (qsearch)',
      description: 'Index local markdown research files into the qsearch corpus by glob pattern. After indexing, files are searchable via web_search with corpus_first=true. Use to make past research sessions available for cross-project semantic search.',
      inputSchema: indexResearchSchema.shape,
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async (params) => {
      const data = await callQsearch('/index', { glob: params.glob })
      return {
        content: [{
          type: 'text',
          text: `Indexing job queued: ${data.job_id}\nPath: ${data.path}\nStatus: ${data.status}\nCheck: GET /index/${data.job_id}`
        }]
      }
    }
  )

  // --- context_search ---
  const contextSearchSchema = z.object({
    query: z.string().describe('Search query for deep page content extraction'),
    n_results: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(1).max(2)).optional().default(1)
      .describe('Number of sources (1-2 max — each source has 2-28 snippets, all get cleaned. CPU-bound, ~25s/source. Default 1.)')
  })

  server.registerTool(
    'context_search',
    {
      title: 'Context Search (qsearch)',
      description: 'Retrieve full page content for deep RAG. Returns 2-28 text snippets per source with provenance. Use when depth matters over breadth.',
      inputSchema: contextSearchSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (params) => {
      const data = await callQsearch('/context', params)
      return {
        content: (data.results || []).map((r) => ({
          type: 'text',
          text: `## ${r.title}\n${r.url} (${r.snippet_count} snippets)\n${r.cleaned_markdown || ''}`
        }))
      }
    }
  )

  // --- sweep_context (Phase 3 — local LLM Context analogue, $0) ---
  const sweepContextSchema = z.object({
    urls: z.array(z.string().url()).min(1).max(20).describe('1-20 URLs to fetch + extract'),
    focus_query: z.string().min(2).describe('Question used to filter relevant facts/quotes'),
    snippets_per_url: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(1).max(20)).optional().default(5),
    max_chars_per_url: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(1000).max(200000)).optional().default(50000),
    timeout_ms: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(1000).max(120000)).optional().default(30000)
  })

  server.registerTool(
    'sweep_context',
    {
      title: 'Local LLM Context (qsearch)',
      description: 'Brave LLM Context endpoint analogue using local Qwen3-600M ($0 cost, GPU only). Fetches HTML, strips boilerplate, extracts facts/numbers/quotes per URL. Use for Phase 4 deep read when Brave Context quota is tight.',
      inputSchema: sweepContextSchema.shape,
      annotations: { readOnlyHint: false, openWorldHint: true }
    },
    async (params) => {
      const data = await callQsearch('/sweep_context', params)
      return {
        content: (data.results || []).map((r) => ({
          type: 'text',
          text: r.error
            ? `## ⚠️ ${r.url}\n${r.error}`
            : `## ${r.title}\n${r.url} (${r.snippet_count} snippets)\n${r.cleaned_markdown || ''}`
        }))
      }
    }
  )

  // --- academic_search (Phase A — arxiv + PubMed + Semantic Scholar) ---
  const academicSearchSchema = z.object({
    query: z.string().describe('Academic search query (e.g. paper topic, methodology, author + concept)'),
    n_results: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(1).max(20)).optional().default(5)
      .describe('Number of papers to return (1-20, default 5). Deduplicated by DOI/title.'),
    sources: z.array(z.enum(['arxiv', 'pubmed', 'semanticscholar'])).optional()
      .describe('Restrict to specific sources. Default: all three. Use [\"pubmed\"] for medical, [\"arxiv\"] for CS/physics/math.')
  })

  server.registerTool(
    'academic_search',
    {
      title: 'Academic Papers Search (qsearch)',
      description: 'Search peer-reviewed papers via arXiv + PubMed + Semantic Scholar in parallel. Free, no auth required. Use for medical research, technical papers, citation chase. Returns deduplicated results across all three sources.',
      inputSchema: academicSearchSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (params) => {
      const data = await callQsearch('/academic_search', params)
      return {
        content: (data.results || []).map((r) => ({
          type: 'text',
          text: `## [${r.source}] ${r.title}\n${r.url}${r.page_age ? ` (${r.page_age})` : ''}\n${r.description || ''}${r.extra_snippets?.length ? `\n${r.extra_snippets.join('\n')}` : ''}`
        }))
      }
    }
  )

  // --- economy_report (Phase 5 — sprint cost tracking) ---
  const economyReportSchema = z.object({
    from: z.string().optional().describe('ISO date — start of report window'),
    to: z.string().optional().describe('ISO date — end of report window'),
    sprint_id: z.string().optional().describe('Filter to one sprint_id'),
    topic: z.string().optional().describe('Filter to one topic'),
    format: z.enum(['markdown', 'json']).optional().default('markdown')
  })

  server.registerTool(
    'economy_report',
    {
      title: 'qsearch Economy Report',
      description: 'Markdown/JSON report of qsearch costs vs all-Brave baseline. Shows by-backend, by-priority breakdown plus total savings. Filter via from/to ISO dates, sprint_id, topic.',
      inputSchema: economyReportSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (params) => {
      const url = new URL(`${QSEARCH_BASE}/economy_report`)
      for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v)
      const r = await fetch(url.toString())
      if (!r.ok) {
        const err = await r.text().catch(() => '')
        throw new Error(`qsearch /economy_report ${r.status}: ${err.slice(0, 200)}`)
      }
      const text = await r.text()
      return { content: [{ type: 'text', text }] }
    }
  )

  // --- verify_citation (the trust layer: does the cited source actually support the claim?) ---
  const verifyCitationSchema = z.object({
    claim: z.string().min(3).max(4000).describe('The exact claim/assertion the source is cited for'),
    url: z.string().url().describe('The single source URL cited for the claim')
  })

  server.registerTool(
    'verify_citation',
    {
      title: 'Verify Citation (qsearch)',
      description: 'Check whether a cited source actually SUPPORTS a claim — the doesitlie citation-honesty method, live. Fetches the URL (PDF/HTML/headless render, SSRF-guarded), selects the most relevant passages, and an LLM-as-judge at temperature 0 returns a verdict: Supported | Partial | Unsupported | Fabricated (URL dead/bogus) | Error (could not fetch). Returns the verbatim supporting excerpt so you can audit it. Use before trusting a citation an agent produced.',
      inputSchema: verifyCitationSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (params) => {
      const v = await callQsearch('/verify', params)
      const conf = v.confidence != null ? ` (confidence ${v.confidence})` : ''
      const ev = v.evidence ? `\n\n> ${v.evidence}` : ''
      const note = v.error ? `\n\n_note: ${v.error}_` : ''
      return { content: [{ type: 'text', text: `**${v.verdict}**${conf} — ${v.source_url || params.url}${ev}${note}` }] }
    }
  )
}
