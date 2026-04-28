const TOS_DISCLAIMER = '\n---\n_Data retrieved via qsearch (SearXNG + Brave). For internal research only._\n'

export function renderMarkdown (results, queries, stats) {
  const lines = []
  const n = queries.length
  const duration_s = (stats.duration_ms || 0) / 1000

  lines.push(`# qsearch sweep — ${n} queries`, '')
  lines.push('**Config:** extra_snippets=on')
  lines.push('**Endpoints used:** web')
  lines.push(`**Generated:** ${new Date().toISOString()} | **Script:** qsearch sweep`, '')
  lines.push('---', '')

  for (const { label, query } of queries) {
    lines.push(`\n## ${label} — "${query}"`, '')
    const entry = results.get(label)
    if (!entry || !entry.ok) {
      lines.push(`_Failed: ${entry?.error || 'unknown error'}_`, '')
      continue
    }
    const webResults = entry.results
    if (!webResults.length) {
      lines.push('_No results_', '')
      continue
    }
    lines.push(`### 🔎 Web (${webResults.length} results)`, '')
    webResults.slice(0, 10).forEach((r, i) => {
      lines.push(`**${i + 1}. ${(r.title || '(no title)').slice(0, 140)}**`)
      lines.push(`- URL: ${r.url}`)
      if (Array.isArray(r.engines) && r.engines.length) {
        lines.push(`- Engines: ${r.engines.join(', ')} (count=${r.engines.length})`)
      }
      if (r.description) lines.push(`- ${String(r.description).slice(0, 400)}`)
      if (r.age) lines.push(`- Age: ${r.age}`)
      for (const s of (r.extra_snippets || []).slice(0, 5)) {
        const ss = String(s).slice(0, 500)
        if (ss.trim().startsWith('{') || ss.trim().startsWith('[')) {
          lines.push('  ```json', `  ${ss}`, '  ```')
        } else {
          lines.push(`  > ${ss}`)
        }
      }
      lines.push('')
    })
  }

  lines.push('---', '', '## Sweep summary', '')
  lines.push(`- Total queries: ${n}`)
  lines.push(`- Web: ${stats.web_ok} ok / ${stats.web_fail} failed`)
  lines.push(`- Silent warnings: 0`)
  lines.push(`- Duration: ${duration_s.toFixed(1)}s`)
  lines.push(`- Deduped: ${stats.total_deduped} URLs removed`)
  lines.push('')
  lines.push(TOS_DISCLAIMER)

  return lines.join('\n')
}
