// Did this URL ever exist? — the difference between link rot and invention.
//
// A citation that 404s today looks exactly like a citation that was never real. Scoring both as
// Fabricated punishes an agent for the web decaying after it wrote, and "Fabricated" is the harshest
// verdict this benchmark can hand out — the one advertised as mechanical. So before calling a dead
// link invented, ask the Internet Archive whether it ever answered.
//
// Rules this file obeys:
//   1. Only a capture whose OWN status was 2xx/3xx counts. archive.org happily stores captures of
//      404 pages; treating `available: true` as proof would launder every hallucinated URL that a
//      crawler once touched. This is the whole trick, and it is easy to get wrong.
//   2. A missing or malformed answer means "don't know", never "never existed" — archive.org serves
//      HTML error pages under load, and an outage must not silently manufacture Fabricated verdicts.
//   3. Keyless and read-only: one GET to the public Availability API.
//
// Technique adapted from gianlucasb/hallucinator (AGPL-3.0) `db/wayback.rs`, which documents the
// same failure mode. No code copied — the API is three fields wide.

import fs from 'node:fs'

const AVAILABILITY = 'https://archive.org/wayback/available'

// The availability API rate-limits per client, not per request: at the harness's concurrency of 4
// it answers 429 to nearly everything, and every 429 is a "don't know" that costs a citation its
// coverage. So the whole process asks in single file, at a polite interval, with two backoff
// retries. Measured 2026-08-04: parallel → 0 of 64 answered; serial with backoff → 12 of 15.
// ponytail: a promise chain and a timestamp, no queue library; the only shared resource is the API.
const MIN_INTERVAL_MS = 1200
let chain = Promise.resolve()
let lastAt = 0

// Whether archive.org holds a capture of a URL does not change between citations, and a corpus
// cites the same URL repeatedly (273 citations over 183 URLs here). Serialized + backed off, an
// uncached lookup costs up to ~40s, which made the archive — not the judge — the slowest part of a
// re-run. So answers persist, exactly like verdicts. Only ANSWERS are stored: a failed lookup must
// never be frozen, or one bad afternoon would follow the corpus forever.
// Path mirrors CACHE_DIR in index.js; `_`-prefixed so prune-cache's key-named files stay distinct.
// Read at call time, not at import: tests set DOESITLIE_NO_CACHE/DOESITLIE_CACHE_DIR and ESM would
// have frozen the value before they ran.
const cachePath = () => `${process.env.DOESITLIE_CACHE_DIR || 'doesitlie/bench/.cache'}/_archive.json`
const cacheOff = () => !!process.env.DOESITLIE_NO_CACHE
// Unlike the verdict cache, nothing about this file's key changes when the lookup logic does — so
// the logic version is stored IN it. Bump on any change to what an answer means. Already earned:
// entries written before the http→https rewrite kept serving capture URLs that fail, and the only
// reason it was caught is that the same person had just written the bug.
const SCHEMA = 2
let memo = null
function loadMemo () {
  if (cacheOff()) return {}
  if (memo) return memo
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf-8'))
    memo = raw && raw.schema === SCHEMA && raw.answers ? raw.answers : {}
  } catch { memo = {} }
  return memo
}
function remember (url, answer) {
  if (cacheOff()) return
  const m = loadMemo()
  m[url] = answer
  // tmp + rename: several processes can share a cache dir (a CLI spot-check beside a bench run), and
  // a half-written JSON file reads as "no cache at all" — silently, because the reader swallows it.
  try {
    const dir = cachePath().replace(/\/[^/]+$/, '')
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${cachePath()}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ schema: SCHEMA, answers: m }))
    fs.renameSync(tmp, cachePath())
  } catch { /* a cache that cannot be written is a slow run, not a wrong one */ }
}
function serialize (fn) {
  const run = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastAt)
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    try { return await fn() } finally { lastAt = Date.now() }
  })
  chain = run.then(() => undefined, () => undefined)   // a failure must not poison the queue
  return run
}

/**
 * Rule 2 lives in the RETURN TYPE, because a boolean cannot carry it. "The archive has no capture"
 * and "the archive did not answer" are opposite facts that both used to come back as `null`, and the
 * caller turned `null` into `Fabricated` — so an archive.org outage silently produced this
 * benchmark's harshest verdict. Measured 2026-08-04: the availability API answers 429 under any
 * concurrency worth using, so this is the normal case, not the rare one.
 *
 * @param {string} url
 * @returns {Promise<{capture: {url: string, timestamp: string} | null, known: boolean}>}
 *   `known:false` means we could not ask — the caller must not conclude anything from it.
 */
export async function archivedSnapshot (url) {
  const cached = loadMemo()[url]
  if (cached) return cached

  let json
  try {
    json = await serialize(async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${AVAILABILITY}?url=${encodeURIComponent(url)}`, {
          headers: { 'User-Agent': 'doesitlie/1.0 (citation-honesty benchmark)' },
          signal: AbortSignal.timeout(12000)
        })
        if (res.status === 429 && attempt < 2) { await new Promise(r => setTimeout(r, 4000 * (attempt + 1))); continue }
        if (!res.ok) return null                          // null here = "could not ask"
        return await res.json()
      }
    })
    if (json === null) return { capture: null, known: false }
  } catch { return { capture: null, known: false } }

  // A body we cannot parse is also "don't know": archive.org serves HTML error pages under load,
  // and `{}` from an error page must not read as "this URL was never archived".
  if (!json || typeof json !== 'object' || !json.archived_snapshots) return { capture: null, known: false }

  const answered = a => { remember(url, a); return a }   // only real answers are ever remembered

  const snap = json.archived_snapshots.closest
  if (!snap?.available || !snap.url) return answered({ capture: null, known: true })
  // Rule 1: a capture of a 404 proves nothing.
  const status = Number.parseInt(snap.status, 10)
  if (!Number.isFinite(status) || status < 200 || status >= 400) return answered({ capture: null, known: true })

  // The API hands back http:// URLs. Over http the capture fetch fails and falls through to the
  // headless renderer, which returns the Wayback toolbar and the site's menu as "content" — 4 487
  // characters of chrome where https gives 27 946 of the actual document. One scheme, whole page.
  return answered({ capture: { url: String(snap.url).replace(/^http:\/\//, 'https://'), timestamp: String(snap.timestamp || '') }, known: true })
}

/** "20240115030405" → "2024-01-15", for the receipt. Returns '' when unparseable. */
export function snapshotDate (timestamp) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(timestamp || ''))
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}
