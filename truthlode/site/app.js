// Truthlode leaderboard — vanilla renderer. Reads data.json (built by build_site.mjs).
// SECURITY: claim/excerpt/evidence/url come from scraped web sources — ALWAYS escape before innerHTML.
'use strict'

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const pc = x => (x * 100).toFixed(1) + '%'
const VORDER = { Fabricated: 0, Unsupported: 1, Partial: 2, Supported: 3, Error: 4 }
const METRICS = {
  fabricatedRate: { label: 'fabricated', dir: 1 },   // dir 1 = ascending (lower is better)
  unsupportedRate: { label: 'unsupported', dir: 1 },
  supportedOfTotal: { label: 'supported', dir: -1 }  // dir -1 = descending (higher is better)
}
const STAT = { fabricatedRate: 'fab', unsupportedRate: 'uns', supportedOfTotal: 'sup' }
const DEFAULT_SORT = 'fabricatedRate'
let DATA = null; let RECBY = {}; let CURRENT = []; let SORT = DEFAULT_SORT

const challengeURL = (agent, c) =>
  `${DATA.meta.repo}/issues/new?template=verdict-challenge.yml&title=${encodeURIComponent(`[verdict] ${c.verdict} — ${agent} — ${c.url.slice(0, 70)}`)}`

function citeHTML (c, agent) {
  const short = c.claim.length > 160 ? c.claim.slice(0, 160) + '…' : c.claim
  const rows = []
  rows.push(`<dt>Source</dt><dd><a class="src" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.url)} ↗</a></dd>`)
  if (c.evidence) rows.push(`<dt>Judge quote</dt><dd class="evidence">${esc(c.evidence)}</dd>`)
  if (c.excerpt) rows.push(`<dt>Source excerpt</dt><dd class="excerpt">${esc(c.excerpt)}</dd>`)
  if (c.error) rows.push(`<dt>Note</dt><dd class="errline">${esc(c.error)}</dd>`)
  if (c.confidence != null) rows.push(`<dt>Confidence</dt><dd class="secondary">${esc(c.confidence)}</dd>`)
  rows.push(`<dt>Disagree?</dt><dd><a class="src" href="${esc(challengeURL(agent, c))}" target="_blank" rel="noopener noreferrer">challenge this verdict ↗</a></dd>`)
  return `<li class="cite" aria-expanded="false" data-v="${esc(c.verdict)}">
    <div class="cite-head" role="button" tabindex="0">
      <span class="badge ${esc(c.verdict)}">${esc(c.verdict)}</span>
      <div><span class="cite-claim short">${esc(short)}</span><span class="cite-claim full">${esc(c.claim)}</span></div>
    </div>
    <div class="receipt"><dl>${rows.join('')}</dl></div>
  </li>`
}

function buildDrawer (el, rec) {
  const verdicts = [...new Set(rec.cites.map(c => c.verdict))].sort((a, b) => (VORDER[a] ?? 9) - (VORDER[b] ?? 9))
  const cites = rec.cites.slice().sort((a, b) => (VORDER[a.verdict] ?? 9) - (VORDER[b.verdict] ?? 9))
  el.innerHTML = `<div class="drawer-in">
    <h4>Exhibit — ${esc(rec.agent)} · every citation filed, with its source (click to open)</h4>
    <div class="filterbar" role="group" aria-label="Filter by verdict">
      <button data-f="all" aria-pressed="true">all · ${rec.cites.length}</button>
      ${verdicts.map(v => `<button data-f="${esc(v)}" aria-pressed="false">${esc(v)} · ${rec.cites.filter(c => c.verdict === v).length}</button>`).join('')}
    </div>
    <ul class="cites capped">${cites.map(c => citeHTML(c, rec.agent)).join('')}</ul>
    ${rec.cites.length > 8 ? `<button class="show-all">show all ${rec.cites.length} citations</button>` : ''}
  </div>`
}

// ── panes (tabs + hash router share this) ──
function showPane (name) {
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name))
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-current', String(t.dataset.pane === name)))
}

function setHash (h) { history.replaceState(null, '', h || location.pathname + location.search) }

function toggleRow (row, force) {
  const body = document.getElementById('board-body')
  const i = +row.dataset.i
  const dr = body.querySelector(`.lb-drawer[data-drawer="${i}"]`)
  if (!dr) return
  const open = row.getAttribute('aria-expanded') === 'true'
  const next = force == null ? !open : force
  if (next === open) return
  row.setAttribute('aria-expanded', String(next))
  row.querySelector('.disclosure').textContent = next ? '▾' : '▸'
  dr.hidden = !next
  if (next) {
    const d = dr.querySelector('.drawer')
    if (!d.dataset.built) { buildDrawer(d, RECBY[CURRENT[i].agent]); d.dataset.built = '1' }
  }
  setHash(next ? '#agent/' + row.dataset.slug : '')
}

function route () {
  const hash = location.hash.slice(1)
  if (!hash) return
  if (hash === 'method' || hash === 'trust') { showPane(hash); window.scrollTo(0, 0); return }
  const am = hash.match(/^agent\/([a-z0-9-]+)$/)
  if (am && DATA) {
    showPane('leaderboard')
    const row = document.querySelector(`.lb-row[data-slug="${am[1]}"]`)
    if (row) { toggleRow(row, true); row.scrollIntoView({ block: 'start' }) }
    return
  }
  const rm = hash.match(/^rank\/(\w+)$/)
  if (rm && METRICS[rm[1]] && DATA) {
    SORT = rm[1]
    document.querySelectorAll('.rankby [data-sort]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sort === SORT)))
    renderBoard()
    showPane('leaderboard')
  }
}

function init (data) {
  DATA = data
  RECBY = Object.fromEntries(data.receipts.map(r => [r.agent, r]))
  const m = data.meta

  document.getElementById('stamp').textContent =
    `Filed ${m.generated}  ·  ${data.board.length} agents · ${m.totals.total} citations checked · judge vs humans ${m.agreement.binary_pct}% (κ ${m.agreement.binary_kappa}) on ${m.gold_n} hand-labeled`

  // hero: always rendered from data — the build also bakes the same values into static HTML for crawlers
  const h = m.headline
  const big = document.getElementById('vl-big')
  if (big && h) big.textContent = h.oneIn ? `1 in ${h.oneIn}` : `${h.pct}%`
  const vn = document.getElementById('vl-n-data')
  if (vn && h) vn.textContent = `${h.notFully} of ${h.scorable} checkable · ${m.totals.total} filed · ${data.board.length} agents · ${m.topics} legal briefs`

  const ag = m.agreement
  const agreeText = `${ag.binary_pct}% of the time (Cohen's κ=${ag.binary_kappa}) on n=${ag.n} hand-labeled citations`
  const inline = document.getElementById('agree-inline')
  if (inline) inline.textContent = agreeText
  const block = document.getElementById('agree-block')
  if (block) block.textContent = `On ${ag.n} citations labeled by hand, the judge's verdict matched the human's ${ag.binary_pct}% of the time on the binary question "did the source support it?" (Cohen's κ=${ag.binary_kappa} — substantial), and ${ag.exact_pct}% on the full four-way verdict (κ=${ag.exact_kappa}).`

  const conf = document.getElementById('conflicts')
  if (conf) {
    conf.innerHTML = m.conflicts.length
      ? m.conflicts.map(c => `<div><span class="g">human=${esc(c.gold)}</span> · <span class="j">judge=${esc(c.judge)}</span> — ${esc(c.claim)}…</div>`).join('')
      : '<div>no disagreements</div>'
  }

  const ed = document.getElementById('errdomains')
  if (ed && m.error_domains) {
    ed.innerHTML = m.error_domains
      .map(d => `<div><span class="ed-n">${d.n}×</span> ${esc(d.domain)}${d.note ? ` <span class="ed-note">— ${esc(d.note)}</span>` : ''}</div>`)
      .join('') + (m.error_domains_more > 0 ? `<div class="ed-note">+ ${m.error_domains_more} more domains, 1–2 cites each — full list in audit.json</div>` : '')
  }

  renderBoard()

  // Rank-by toggle: prominent number AND row order both follow the active metric (no rank↔number conflict).
  document.querySelectorAll('.rankby [data-sort]').forEach(btn => btn.addEventListener('click', () => {
    SORT = btn.dataset.sort
    document.querySelectorAll('.rankby [data-sort]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)))
    renderBoard()
    setHash(SORT === DEFAULT_SORT ? '' : '#rank/' + SORT)
  }))

  const body = document.getElementById('board-body')
  body.addEventListener('click', e => {
    const sa = e.target.closest('.show-all')
    if (sa) { const ul = sa.parentElement.querySelector('ul.cites'); if (ul) ul.classList.remove('capped'); sa.remove(); return }
    const fbtn = e.target.closest('.filterbar button')
    if (fbtn) {
      const bar = fbtn.parentElement
      bar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === fbtn)))
      const f = fbtn.dataset.f
      bar.parentElement.querySelectorAll('li.cite').forEach(li => { li.style.display = (f === 'all' || li.dataset.v === f) ? '' : 'none' })
      return
    }
    if (e.target.closest('a')) return // receipt links work as links
    const head = e.target.closest('.cite-head')
    if (head) { const li = head.closest('li.cite'); li.setAttribute('aria-expanded', li.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'); return }
    const row = e.target.closest('.lb-row')
    if (row && !row.classList.contains('pending')) toggleRow(row)
  })
  // rows/cite-heads advertise role="button" — make Enter/Space actually work
  body.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (e.target.closest('button, a')) return // native elements handle themselves
    const t = e.target.closest('.lb-row:not(.pending), .cite-head')
    if (!t) return
    e.preventDefault()
    t.click()
  })

  route()
  window.addEventListener('hashchange', route)
}

const segs = (c, t) => {
  // Honesty verdicts only — the unfetched share is the EMPTY remainder of the track
  // (absence of ink = absence of data, not a judgment). Denominator stays total: anti-gaming.
  const w = n => (t ? (n / t * 100).toFixed(2) : 0)
  const lbl = { sup: 'supported', par: 'partial', uns: 'unsupported', fab: 'fabricated' }
  const s = (cls, n) => n ? `<span class="seg ${cls}" style="width:${w(n)}%" title="${lbl[cls]}: ${n} of ${t} citations"></span>` : ''
  return s('sup', c.Supported) + s('par', c.Partial) + s('uns', c.Unsupported) + s('fab', c.Fabricated)
}

function renderBoard () {
  const m = METRICS[SORT]
  CURRENT = DATA.board.slice().sort((a, b) => {
    const d = (a[SORT] - b[SORT]) * m.dir
    if (Math.abs(d) > 1e-9) return d
    return a.fabricatedRate - b.fabricatedRate || a.unsupportedRate - b.unsupportedRate || b.supportedOfTotal - a.supportedOfTotal
  })
  const body = document.getElementById('board-body')
  const ranked = CURRENT.map((b, i) => {
    const stats = ['fabricatedRate', 'unsupportedRate', 'supportedOfTotal']
      .filter(k => k !== SORT).map(k => `${pc(b[k])} ${STAT[k]}`).join(' · ')
    const prov = b.provider ? esc(b.provider) + ' · ' : ''
    return `
    <div class="lb-row" data-i="${i}" data-slug="${esc(b.slug)}" role="button" tabindex="0" aria-expanded="false">
      <div class="lb-rank">${String(i + 1).padStart(2, '0')}</div>
      <div class="lb-main">
        <div class="lb-name">${esc(b.agent)} <span class="disclosure">▸</span></div>
        <div class="lb-sub">${prov}${b.total} cites · ${b.scorable} checkable · ${b.total - b.scorable} unreachable (paywall / bot-block)</div>
        <div class="stackbar">${segs(b.counts, b.total)}</div>
      </div>
      <div class="lb-metrics">
        <div class="lb-score"><b>${pc(b[SORT])}</b><span>${m.label}</span></div>
        <div class="lb-stats">${stats}</div>
      </div>
    </div>
    <div class="lb-drawer" data-drawer="${i}" hidden><div class="drawer"></div></div>`
  }).join('')
  const docket = (DATA.pending || []).map(p => `
    <div class="lb-row pending" aria-disabled="true">
      <div class="lb-rank">—</div>
      <div class="lb-main">
        <div class="lb-name">${esc(p.agent)} <span class="chip-docket">${esc(p.status)}</span></div>
        <div class="lb-sub">${esc(p.provider)} · same three briefs, same judge · results filed when the run completes</div>
        <div class="stackbar stackbar-empty"></div>
      </div>
    </div>`).join('')
  body.innerHTML = ranked + docket
}

fetch('data.json').then(r => r.json()).then(init).catch(e => {
  document.getElementById('board-body').innerHTML = `<div class="meta">Could not load data.json — serve over http (not file://): <code>python -m http.server</code> in this folder. (${esc(e.message)})</div>`
})

// ── tabs: Leaderboard / Method / Trust (single static page, hide/show panes) ──
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  showPane(t.dataset.pane)
  window.scrollTo(0, 0)
  setHash(t.dataset.pane === 'leaderboard' ? '' : '#' + t.dataset.pane)
}))
document.addEventListener('click', e => {
  const l = e.target.closest('.linklike[data-pane]')
  if (l) { showPane(l.dataset.pane); window.scrollTo(0, 0); setHash(l.dataset.pane === 'leaderboard' ? '' : '#' + l.dataset.pane) }
})
