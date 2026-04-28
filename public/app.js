// Corpus viewer for qsearch — calls /search, /corpus/top, /corpus/stats, /trust/:url

const $ = (sel) => document.querySelector(sel)

async function loadStats () {
  try {
    const r = await fetch('/corpus/stats')
    const data = await r.json()
    $('#statTotal').textContent = data.total || 0
    if (data.size_mb) $('#statSizeMb').textContent = data.size_mb
    const top = await fetch('/corpus/top?limit=1000&min_engines=3').then((r) => r.json())
    const hightrust = top.top?.length || 0
    $('#statHighTrust').textContent = hightrust
    if (data.total) $('#statRatio').textContent = ((hightrust / data.total) * 100).toFixed(1) + '%'
  } catch (e) {
    console.error('stats error:', e)
  }
}

async function loadTop () {
  const minEngines = $('#minEngines').value || 1
  const limit = $('#limitInput').value || 20
  try {
    const r = await fetch(`/corpus/top?limit=${limit}&min_engines=${minEngines}`)
    const data = await r.json()
    renderResults(data.top || [])
  } catch (e) {
    $('#results').innerHTML = '<p style="color:#f85149">Failed to load corpus top</p>'
  }
}

async function doSearch (query) {
  try {
    const r = await fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, n_results: 20, corpus_first: true, corpus_only: true })
    })
    const data = await r.json()
    renderResults(data.results || [])
  } catch (e) {
    $('#results').innerHTML = '<p style="color:#f85149">Search failed</p>'
  }
}

function renderResults (urls) {
  const html = urls.map((u) => `
    <div class="url-card">
      <div class="title" onclick="showTrust('${encodeURIComponent(u.url)}')">${escapeHtml(u.title || '(no title)')}</div>
      <div class="url"><a href="${escapeHtml(u.url)}" target="_blank" rel="noopener">${escapeHtml(u.url)}</a></div>
      <div class="meta">
        ${u.engine_count !== undefined ? `<span class="badge ${u.engine_count >= 3 ? 'high' : ''}">engines=${u.engine_count}</span>` : ''}
        ${u.trust_score !== undefined ? `<span class="badge">trust=${u.trust_score}</span>` : ''}
        ${u.sweep_count !== undefined ? `<span class="badge">sweeps=${u.sweep_count}</span>` : ''}
        ${u.rerank_score !== undefined ? `<span class="badge">rerank=${u.rerank_score}</span>` : ''}
      </div>
    </div>
  `).join('')
  $('#results').innerHTML = html || '<p style="color:#8b949e">No results</p>'
}

async function showTrust (encodedUrl) {
  const r = await fetch(`/trust/${encodedUrl}`)
  if (!r.ok) {
    alert('URL not found in corpus')
    return
  }
  const data = await r.json()
  const sweepsHtml = (data.appeared_in_sweeps || []).map((s) => `
    <li>${escapeHtml(s.sweep_label)} — ${escapeHtml(s.crawled_at || '')}<br>
        engines: ${escapeHtml((s.engines || []).join(', '))}</li>
  `).join('')
  $('#modalContent').innerHTML = `
    <h2>${escapeHtml(data.title || 'URL provenance')}</h2>
    <p><a href="${escapeHtml(data.url)}" target="_blank" rel="noopener">${escapeHtml(data.url)}</a></p>
    <ul>
      <li><strong>Trust score:</strong> ${escapeHtml(String(data.trust_score ?? ''))}</li>
      <li><strong>Sweep count:</strong> ${escapeHtml(String(data.sweep_count ?? ''))}</li>
      <li><strong>Engines:</strong> ${escapeHtml((data.engines || []).join(', '))} (${escapeHtml(String(data.engine_count ?? ''))})</li>
      <li><strong>Topics:</strong> ${escapeHtml(String(data.topic_diversity ?? ''))}</li>
      <li><strong>First seen:</strong> ${escapeHtml(data.first_seen || 'unknown')}</li>
    </ul>
    <h3>Appeared in sweeps:</h3>
    <ul>${sweepsHtml || '<li>none</li>'}</ul>
  `
  $('#modal').classList.add('show')
  $('#backdrop').classList.add('show')
}

function closeModal () {
  $('#modal').classList.remove('show')
  $('#backdrop').classList.remove('show')
}

function escapeHtml (s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

// Wire up events
$('#searchBox').addEventListener('input', (e) => {
  const q = e.target.value.trim()
  if (q.length >= 2) doSearch(q)
  else loadTop()
})
$('#refresh').addEventListener('click', loadTop)
$('#minEngines').addEventListener('change', loadTop)
$('#limitInput').addEventListener('change', loadTop)
$('#backdrop').addEventListener('click', closeModal)

// Initial load
loadStats()
loadTop()
window.showTrust = showTrust
window.closeModal = closeModal
