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

export function qsearchTool (server) {
  // --- web_search ---
  const webSearchSchema = z.object({
    query: z.string().describe('Search query'),
    n_results: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().min(1).max(3)).optional().default(2)
      .describe('Number of results (1-3). Default 2.'),
    clean: z.boolean().optional().default(false)
      .describe('Run on-device QVAC LLM cleaning over results (Qwen3-0.6B Q4). Adds ~25s per result on CPU; seconds on mobile with QVAC acceleration. Default false — returns raw Brave snippets (title, description, extra snippets) immediately.'),
    freshness: z.string().optional()
      .describe('Time filter: pd (past day), pw (past week), pm (past month), py (past year), or YYYY-MM-DDtoYYYY-MM-DD'),
    search_lang: z.string().optional().describe('Language code, e.g. "en", "ru"'),
    country: z.string().optional().describe('Country code, e.g. "us", "ru"')
  })

  server.registerTool(
    'web_search',
    {
      title: 'Web Search (qsearch)',
      description: 'Search the web via Brave Search API with local QVAC LLM cleaning. Returns cleaned markdown summaries. Use for general web research, factual lookups, and topic exploration.',
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
      description: 'Search recent news via Brave News API with local QVAC LLM cleaning. Defaults to past week. Use for current events, market news, and time-sensitive queries.',
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
      description: 'Retrieve enriched page content via Brave LLM Context API with local QVAC cleaning. Returns 2-28 text snippets per source (vs 1 snippet in web_search). Use when depth matters over breadth.',
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
