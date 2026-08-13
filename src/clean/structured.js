// Structured payloads hidden inside Brave LLM Context snippets.
//
// The documented schema types `snippets` as a plain string array, so the pipeline treated
// every element as prose. In practice Brave serializes JSON-LD and tables INTO those
// strings. Measured 2026-08-04 over 1200 saved response pairs (30 928 snippets):
//
//   {title, table:[…]}                1706   row-level tables
//   JSON-LD Article                    833   headline + datePublished/dateModified
//   JSON-LD FAQ (mainEntity)           575   ready-made question→answer pairs
//   @graph container                   266   wrapper, recurse into it
//   JSON-like but unparseable          179   MUST NOT throw
//
// ~92% of structured payloads are the first four shapes, and at least one arrives on
// 81.5% of queries. Rendering them as prose loses the row structure, the Q→A pairing and
// — most wastefully — the publication dates, which are the freshness signal research
// needs and which would otherwise cost a separate page fetch to recover.
//
// One module, two consumers: markdown rendering (src/sweep/parsed_snippets.js) and corpus
// text (src/server.js sweep indexing). Same parse for both, so they can never disagree.
//
// ⚠️ Parse BEFORE sanitizeText. src/clean/sanitize.js strips prompt-injection patterns and
// deletes up to 500 characters after a key like "prompt": / "instruction": — which is
// exactly what a JSON payload looks like. Sanitize the extracted TEXT, never the raw JSON.

const MAX_TABLE_ROWS = 12
const MAX_FAQ_ITEMS = 8

/**
 * Detect and parse a structured payload. Returns null for ordinary prose or anything
 * unparseable — the caller then treats the snippet exactly as before.
 * @param {string} snippet
 * @returns {{kind: string, data: object}|null}
 */
export function parseStructured (snippet) {
  const t = String(snippet ?? '').trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return null
  let v
  try { v = JSON.parse(t) } catch { return null }
  return classify(v)
}

function classify (v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 3) return null

  // @graph is a container: the useful node is inside it.
  if (Array.isArray(v['@graph'])) {
    for (const node of v['@graph']) {
      const inner = classify(node, depth + 1)
      if (inner) return inner
    }
    return null
  }

  if (Array.isArray(v.table)) return { kind: 'table', data: v }
  if (Array.isArray(v.mainEntity)) return { kind: 'faq', data: v }
  if (v.headline || v.datePublished || v.dateModified) return { kind: 'article', data: v }

  if (Array.isArray(v)) {
    for (const node of v.slice(0, 5)) {
      const inner = classify(node, depth + 1)
      if (inner) return inner
    }
    return null
  }
  return null
}

const str = x => (x == null ? '' : String(x))

/** Publication dates, when the payload carries them. The freshness signal. */
export function structuredDates (parsed) {
  const d = parsed?.data
  if (!d) return null
  const published = str(d.datePublished).slice(0, 10)
  const modified = str(d.dateModified).slice(0, 10)
  if (!published && !modified) return null
  return { published: published || null, modified: modified || null }
}

/** Question→answer pairs from a JSON-LD FAQ payload. */
function faqPairs (data) {
  const out = []
  for (const item of (data.mainEntity || []).slice(0, MAX_FAQ_ITEMS)) {
    const q = str(item?.name).trim()
    const a = str(item?.acceptedAnswer?.text ?? item?.acceptedAnswer).trim()
    if (q || a) out.push({ q, a })
  }
  return out
}

/** Column order for a table payload: first-seen key order across the sampled rows. */
function tableColumns (rows) {
  const cols = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k)
  }
  return cols
}

const cell = x => str(x).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

/**
 * Markdown rendering — what a human reads in parsed_snippets.md.
 * Returns null when there is nothing worth rendering as structure.
 */
export function renderStructured (parsed) {
  if (!parsed) return null
  const { kind, data } = parsed
  const lines = []
  const title = cell(data.title || data.headline || data.name)

  if (kind === 'table') {
    const rows = data.table.filter(r => r && typeof r === 'object').slice(0, MAX_TABLE_ROWS)
    const cols = tableColumns(rows)
    if (!cols.length) return null
    if (title) lines.push(`  **${title}**`, '')
    lines.push(`  | ${cols.map(cell).join(' | ')} |`)
    lines.push(`  |${cols.map(() => '---').join('|')}|`)
    for (const r of rows) lines.push(`  | ${cols.map(c => cell(r[c])).join(' | ')} |`)
    if (data.table.length > rows.length) lines.push(`  _…${data.table.length - rows.length} more rows_`)
    return lines.join('\n')
  }

  if (kind === 'faq') {
    const pairs = faqPairs(data)
    if (!pairs.length) return null
    if (title) lines.push(`  **${title}**`, '')
    for (const { q, a } of pairs) {
      lines.push(`  - **${cell(q)}**`)
      if (a) lines.push(`    ${cell(a).slice(0, 400)}`)
    }
    const total = (data.mainEntity || []).length
    if (total > pairs.length) lines.push(`  _…${total - pairs.length} more Q&A_`)
    return lines.join('\n')
  }

  if (kind === 'article') {
    const dates = structuredDates(parsed)
    if (title) lines.push(`  **${title}**`)
    if (dates) {
      const parts = []
      if (dates.published) parts.push(`published ${dates.published}`)
      if (dates.modified && dates.modified !== dates.published) parts.push(`updated ${dates.modified}`)
      if (parts.length) lines.push(`  _${parts.join(' · ')}_`)
    }
    const body = cell(data.text || data.description || data.articleBody)
    if (body) lines.push(`  > ${body.slice(0, 600)}`)
    return lines.length ? lines.join('\n') : null
  }

  return null
}

/**
 * Plain text for the corpus — no markup, just the words a search should match.
 * Returns '' when there is nothing to contribute.
 */
export function flattenStructured (parsed) {
  if (!parsed) return ''
  const { kind, data } = parsed
  const parts = []
  const title = str(data.title || data.headline || data.name).trim()
  if (title) parts.push(title)

  if (kind === 'table') {
    for (const row of data.table.slice(0, MAX_TABLE_ROWS)) {
      if (!row || typeof row !== 'object') continue
      // Key and value both carry meaning ("Как нельзя" / "Перепродажа чужих товаров").
      parts.push(Object.entries(row).map(([k, v]) => `${k}: ${str(v)}`).join('. '))
    }
  } else if (kind === 'faq') {
    for (const { q, a } of faqPairs(data)) parts.push([q, a].filter(Boolean).join(' — '))
  } else if (kind === 'article') {
    const dates = structuredDates(parsed)
    if (dates?.published) parts.push(`published ${dates.published}`)
    const body = str(data.text || data.description || data.articleBody).trim()
    if (body) parts.push(body)
  }

  return parts.filter(Boolean).join('\n').trim()
}

/**
 * Convenience for callers holding a raw snippet: returns the text a search index should
 * see. Structured payloads are flattened; prose passes through untouched.
 */
export function snippetToText (snippet) {
  const parsed = parseStructured(snippet)
  if (!parsed) return String(snippet ?? '')
  const flat = flattenStructured(parsed)
  // A payload we recognised but could not flatten is still better kept than dropped.
  return flat || String(snippet ?? '')
}
