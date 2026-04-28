import { Meilisearch } from 'meilisearch'

const MEILI_URL = process.env.MEILISEARCH_URL || 'http://localhost:7700'
const MEILI_KEY = process.env.MEILISEARCH_KEY || 'masterKey'

/**
 * Render findings.md content as a string.
 *
 * @param {Map<string, {query, results, ok}>} results - from runSweep
 * @param {Array<{label, query}>} queries - input queries
 * @param {Object} stats - { web_ok, web_fail, total_deduped, duration_ms }
 * @param {string} topicName - sanitized topic name for header
 * @returns {Promise<string>} markdown content
 */
export async function renderFindings (results, queries, stats, topicName = 'sweep') {
  const client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY })
  const idx = client.index('qsearch_corpus')

  const lines = []
  lines.push(`# Findings: ${topicName}`)
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Queries: ${queries.length} | Success: ${stats.web_ok}/${queries.length}`)
  lines.push('')

  // Aggregate: URL → { count, engines: Set, queries: Set, title, description }
  const urlMap = new Map()
  for (const { label } of queries) {
    const entry = results.get(label)
    if (!entry?.ok) continue
    for (const r of entry.results || []) {
      if (!r.url) continue
      let u = urlMap.get(r.url)
      if (!u) {
        u = {
          url: r.url,
          title: r.title || '',
          description: r.description || '',
          engines: new Set(r.engines || []),
          queries: new Set(),
          appearance_count: 0
        }
        urlMap.set(r.url, u)
      }
      for (const e of r.engines || []) u.engines.add(e)
      u.queries.add(label)
      u.appearance_count++
    }
  }

  // Cross-topic alerts: URLs already in corpus from earlier sweeps
  const crossTopicAlerts = []
  const sweepLabelsThisRun = new Set(queries.map((q) => q.label))
  for (const [url, info] of urlMap) {
    try {
      const { hits } = await idx.search('', {
        filter: `url = '${url.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
        limit: 5,
        attributesToRetrieve: ['sweep_label', 'crawled_at', 'namespace']
      })
      const otherLabels = hits
        .map((h) => h.sweep_label)
        .filter((l) => l && !sweepLabelsThisRun.has(l))
      if (otherLabels.length) {
        crossTopicAlerts.push({ url, title: info.title, otherLabels })
      }
    } catch {}
  }

  // Top 5 URLs by engine_count, then appearance_count
  const topUrls = [...urlMap.values()]
    .sort((a, b) => {
      if (b.engines.size !== a.engines.size) return b.engines.size - a.engines.size
      return b.appearance_count - a.appearance_count
    })
    .slice(0, 5)

  lines.push('## TL;DR — Top 5 URLs')
  lines.push('')
  topUrls.forEach((u, i) => {
    lines.push(`### ${i + 1}. ${u.title.slice(0, 100) || '(no title)'}`)
    lines.push(`- URL: ${u.url}`)
    lines.push(`- Engines: ${[...u.engines].join(', ')} (count=${u.engines.size})`)
    lines.push(`- Queries hit: ${[...u.queries].join(', ')}`)
    if (u.description) lines.push(`- ${u.description.slice(0, 200)}`)
    lines.push('')
  })

  // Per-query summary
  lines.push('---', '', '## Per-query summary', '')
  for (const { label, query } of queries) {
    const entry = results.get(label)
    lines.push(`### ${label} — "${query}"`)
    if (!entry?.ok) {
      lines.push(`_Failed: ${entry?.error || 'unknown'}_`, '')
      continue
    }
    const top3 = (entry.results || []).slice(0, 3)
    top3.forEach((r) => {
      const enginesStr = (r.engines || []).length
        ? ` [${r.engines.join(', ')}]`
        : ''
      lines.push(`- **${(r.title || '(no title)').slice(0, 80)}**${enginesStr}`)
      lines.push(`  ${r.url}`)
    })
    lines.push('')
  }

  // Cross-topic alerts
  if (crossTopicAlerts.length) {
    lines.push('---', '', '## ⚠️ Cross-topic alerts', '')
    lines.push('URLs that already appeared in earlier sweeps:')
    lines.push('')
    crossTopicAlerts.slice(0, 10).forEach((a) => {
      lines.push(`- **${a.title.slice(0, 80) || a.url}**`)
      lines.push(`  ${a.url}`)
      lines.push(`  Earlier sweeps: ${a.otherLabels.slice(0, 5).join(', ')}`)
      lines.push('')
    })
  }

  // Stats footer
  lines.push('---', '', '## Sweep stats', '')
  lines.push(`- Duration: ${((stats.duration_ms || 0) / 1000).toFixed(1)}s`)
  lines.push(`- Total queries: ${queries.length}`)
  lines.push(`- Web ok/fail: ${stats.web_ok}/${stats.web_fail}`)
  lines.push(`- Deduped URLs: ${stats.total_deduped}`)
  lines.push(`- Unique URLs found: ${urlMap.size}`)
  lines.push(`- URLs with engine_count >= 3: ${[...urlMap.values()].filter((u) => u.engines.size >= 3).length}`)
  lines.push('')

  return lines.join('\n')
}
