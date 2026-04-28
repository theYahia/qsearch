// qsearch MCP tool wrapper — integrates qsearch into wdk-mcp-toolkit.
//
// OPTIONAL DEPENDENCY — not imported by server.js.
// Install separately: npm install @modelcontextprotocol/sdk zod
//
// Usage:
//   import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
//   import { qsearchTool } from './mcp.js'
//   const mcpServer = new McpServer({ name: 'qsearch', version: '0.2.0' })
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
    country: z.string().optional().describe('Country code, e.g. "us", "ru"')
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
      .describe('Queries in label|query format, one per line. E.g.: "c1_01|self-hosted search\\nc1_02|SearXNG alternatives"'),
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
}
