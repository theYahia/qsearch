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

  // Collect zero-result/failed labels for top-of-file warnings block.
  // This makes silent failures (e.g. distribution_channels_2026-04-28) visible at a glance,
  // so synthesis-time consumers can spot data gaps before treating empty queries as "no signal".
  const zeroResultLabels = []
  const failedLabels = []
  for (const { label } of queries) {
    const entry = results.get(label)
    if (!entry) continue
    if (!entry.ok && entry.reason === 'zero_results') zeroResultLabels.push(label)
    else if (!entry.ok) failedLabels.push({ label, error: entry.error || 'unknown' })
  }
  if (zeroResultLabels.length || failedLabels.length) {
    lines.push('## ⚠️ Sweep warnings', '')
    if (zeroResultLabels.length) {
      lines.push(`**Zero-result queries (${zeroResultLabels.length}):** ${zeroResultLabels.join(', ')}`)
      lines.push('_These queries returned no results after one retry. Investigate before relying on synthesis._', '')
    }
    if (failedLabels.length) {
      lines.push(`**Failed queries (${failedLabels.length}):**`)
      for (const { label, error } of failedLabels) lines.push(`- \`${label}\` — ${error}`)
      lines.push('')
    }
    lines.push('---', '')
  }

  for (const { label, query } of queries) {
    lines.push(`\n## ${label} — "${query}"`, '')
    const entry = results.get(label)
    if (!entry || !entry.ok) {
      const tag = entry?.reason === 'zero_results' ? '⚠️ ZERO RESULTS (after retry)' : `Failed: ${entry?.error || 'unknown error'}`
      lines.push(`_${tag}_`, '')
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
  lines.push(`- Web: ${stats.web_ok} ok / ${stats.web_fail} failed / ${stats.web_zero || 0} zero-result`)
  if (stats.web_zero_recovered) lines.push(`- Zero-result recovered after retry: ${stats.web_zero_recovered}`)
  if (stats.by_priority) {
    const fmt = (p) => {
      const c = stats.by_priority[p]
      const total = (c?.ok || 0) + (c?.fail || 0) + (c?.zero || 0)
      return `${p}=${c?.ok || 0}/${total}`
    }
    lines.push(`- Priority: ${fmt('broad')}, ${fmt('focused')}, ${fmt('critical')}`)
  }
  lines.push(`- Duration: ${duration_s.toFixed(1)}s`)
  lines.push(`- Deduped: ${stats.total_deduped} URLs removed`)
  lines.push('')
  lines.push(TOS_DISCLAIMER)

  return lines.join('\n')
}
