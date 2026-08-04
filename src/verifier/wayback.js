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

const AVAILABILITY = 'https://archive.org/wayback/available'

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
  let json
  try {
    const res = await fetch(`${AVAILABILITY}?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'doesitlie/1.0 (citation-honesty benchmark)' },
      signal: AbortSignal.timeout(12000)
    })
    if (!res.ok) return { capture: null, known: false }
    json = await res.json()
  } catch { return { capture: null, known: false } }

  // A body we cannot parse is also "don't know": archive.org serves HTML error pages under load,
  // and `{}` from an error page must not read as "this URL was never archived".
  if (!json || typeof json !== 'object' || !json.archived_snapshots) return { capture: null, known: false }

  const snap = json.archived_snapshots.closest
  if (!snap?.available || !snap.url) return { capture: null, known: true }
  // Rule 1: a capture of a 404 proves nothing.
  const status = Number.parseInt(snap.status, 10)
  if (!Number.isFinite(status) || status < 200 || status >= 400) return { capture: null, known: true }

  return { capture: { url: String(snap.url), timestamp: String(snap.timestamp || '') }, known: true }
}

/** "20240115030405" → "2024-01-15", for the receipt. Returns '' when unparseable. */
export function snapshotDate (timestamp) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(timestamp || ''))
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}
